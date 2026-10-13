"""Outbox-Worker (Plan 6.3, ADR-004): DB-Outbox + asyncio-Loop, kein Broker.

Harte Betriebsbedingung: genau EIN Prozess (uvicorn --workers 1, im Dockerfile
verankert). Semantik ist at-least-once: Crash zwischen SMTP-250 und DB-Update
kann eine einzelne Mail doppelt senden — bewusst akzeptiert (RUNBOOK).

Stale-Recovery läuft über den Fortschritts-Heartbeat (last_progress_at), der bei
JEDEM Tick für alle eigenen 'sending'-Aufträge aufgefrischt wird — auch wenn nur
auf Retry-Backoff gewartet wird. Ein aktiver Großversand oder eine Backoff-
Wartephase wird dadurch nie fälschlich als verwaist eingestuft; nur ein
abgestürzter Prozess hinterlässt einen stehengebliebenen Heartbeat.
"""

import asyncio
import contextlib
import logging
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.clock import utcnow
from app.core.config import Settings
from app.db.models import (
    AuditLog,
    Dispatch,
    DispatchRecipient,
    DispatchStatus,
    RecipientStatus,
    Topic,
)
from app.mail.mailer import Mailer
from app.mail.render import render_mail

log = logging.getLogger(__name__)


# Kontingent-Meldungen, die als 5xx kommen, aber vorübergehend sind. Ohne diese
# Ausnahme würde ein erreichtes Tageslimit (Gmail: "550 5.4.5 Daily user sending
# limit exceeded") alle restlichen Empfänger endgültig als 'failed' abschreiben —
# die Mails wären verloren, obwohl sie am nächsten Tag zustellbar wären.
# Gemeint ist das Limit des ANBIETERS. Beim eigenen Tageslimit (SMTP_MAX_PER_DAY,
# ADR-0032) ist 'failed' dagegen gewollt, siehe _fail_open_over_limit.
_QUOTA_HINTS = (
    "5.4.5",  # Gmail: Daily user sending limit exceeded
    "4.5.3",  # zu viele Empfänger, später erneut
    "sending limit",
    "quota exceeded",
    "rate limited",
    "try again later",
    "too many messages",
)


def classify_smtp_error(exc: Exception) -> str:
    """'transient' (4xx, Timeout, Verbindungsabbruch, Kontingent) oder 'permanent' (5xx)."""
    code = getattr(exc, "code", None)
    if code is None:
        recipients = getattr(exc, "recipients", None)  # SMTPRecipientsRefused
        if recipients:
            first = recipients[0] if isinstance(recipients, list) else None
            code = getattr(first, "code", None)
    if isinstance(code, int) and 500 <= code < 600:
        text = str(exc).lower()
        if any(hint in text for hint in _QUOTA_HINTS):
            return "transient"
        return "permanent"
    return "transient"


def _due(now: datetime) -> ColumnElement[bool]:
    """Fällige Empfänger: 'pending' oder 'retry_wait' mit abgelaufenem Backoff."""
    return or_(
        DispatchRecipient.status == RecipientStatus.pending,
        (DispatchRecipient.status == RecipientStatus.retry_wait)
        & (DispatchRecipient.next_attempt_at <= now),
    )


class OutboxWorker:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        settings: Settings,
        mailer: Mailer | None = None,
    ) -> None:
        self._sm = sessionmaker
        self._s = settings
        self.mailer = mailer or Mailer(settings)
        self._stop = asyncio.Event()

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        # Das Limit steht in der Startzeile, damit ein still fehlendes auffällt: Die
        # Voreinstellung ist 0, und ein vertippter Variablenname ändert daran nichts.
        limit = self._s.smtp_max_per_day
        log.info(
            "Outbox-Worker gestartet (Poll-Intervall %ss, %s)",
            self._s.worker_poll_interval_s,
            f"Tageslimit: {limit} Mails in 24 Stunden" if limit > 0 else "kein Tageslimit",
        )
        while not self._stop.is_set():
            try:
                await self.tick()
            except Exception:
                log.exception("Worker-Tick fehlgeschlagen — nächster Tick läuft regulär")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stop.wait(), timeout=self._s.worker_poll_interval_s)
        log.info("Outbox-Worker gestoppt")

    async def tick(self) -> None:
        await self.recover_stale()
        # 1) Eigene 'sending'-Aufträge fortsetzen (z. B. Backoff-Wartephasen).
        #    Single-Process-Garantie: alles in 'sending' mit frischem Heartbeat gehört uns.
        async with self._sm() as session:
            own_ids = list(
                (
                    await session.execute(
                        select(Dispatch.id)
                        .where(Dispatch.status == DispatchStatus.sending)
                        .order_by(Dispatch.id)
                    )
                ).scalars()
            )
        for dispatch_id in own_ids:
            await self._process_isolated(dispatch_id)
        # 2) Neue Aufträge claimen und sofort verarbeiten.
        while (claimed_id := await self.claim_next()) is not None:
            await self._process_isolated(claimed_id)

    async def _process_isolated(self, dispatch_id: int) -> None:
        """Fehlerisolation pro Auftrag: Ein defekter Dispatch darf weder die übrigen
        'sending'-Aufträge noch das Claiming neuer Aufträge blockieren. Sonst käme es zu
        Starvation, weil own_ids sortiert ist und derselbe Auftrag immer zuerst kommt."""
        try:
            await self.process_dispatch(dispatch_id)
        except Exception:
            log.exception("Versand %s fehlgeschlagen — übrige Aufträge laufen weiter", dispatch_id)

    async def recover_stale(self) -> None:
        threshold = utcnow() - timedelta(seconds=self._s.worker_stale_after_s)
        async with self._sm() as session:
            result = await session.execute(
                update(Dispatch)
                .where(
                    Dispatch.status == DispatchStatus.sending,
                    or_(
                        Dispatch.last_progress_at.is_(None),
                        Dispatch.last_progress_at < threshold,
                    ),
                )
                .values(status=DispatchStatus.pending)
            )
            await session.commit()
        recovered = result.rowcount  # type: ignore[attr-defined]
        if recovered:
            log.warning("%s verwaiste Versandaufträge auf 'pending' zurückgesetzt", recovered)

    async def claim_next(self) -> int | None:
        """Atomares Claiming: UPDATE ... WHERE status='pending' (Plan 6.3)."""
        async with self._sm() as session:
            dispatch_id = (
                await session.execute(
                    select(Dispatch.id)
                    .where(Dispatch.status == DispatchStatus.pending)
                    .order_by(Dispatch.id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if dispatch_id is None:
                return None
            result = await session.execute(
                update(Dispatch)
                .where(Dispatch.id == dispatch_id, Dispatch.status == DispatchStatus.pending)
                .values(
                    status=DispatchStatus.sending,
                    started_at=func.coalesce(Dispatch.started_at, utcnow()),
                    last_progress_at=utcnow(),
                )
            )
            await session.commit()
            claimed: int = result.rowcount  # type: ignore[attr-defined]
            return dispatch_id if claimed == 1 else None

    async def process_dispatch(self, dispatch_id: int) -> None:
        async with self._sm() as session:
            dispatch = (
                await session.execute(select(Dispatch).where(Dispatch.id == dispatch_id))
            ).scalar_one_or_none()
            if dispatch is None or dispatch.status != DispatchStatus.sending:
                return
            topic = (
                await session.execute(select(Topic).where(Topic.id == dispatch.topic_id))
            ).scalar_one()
            html, text = render_mail(
                self._s,
                dispatch.severity,
                topic.name,
                _title_from_subject(dispatch.subject, topic.name),
                dispatch.body,
            )
            subject = dispatch.subject

        while True:
            due = await self._due_recipients(dispatch_id)
            await self._heartbeat(dispatch_id)
            if not due:
                await self._finalize_if_done(dispatch_id)
                return
            await self._send_batch(dispatch_id, due, subject, html, text)

    async def _due_recipients(self, dispatch_id: int) -> list[int]:
        async with self._sm() as session:
            rows = await session.execute(
                select(DispatchRecipient.id)
                .where(DispatchRecipient.dispatch_id == dispatch_id, _due(utcnow()))
                .order_by(DispatchRecipient.id)
                .limit(self._s.smtp_batch_size)
            )
            return list(rows.scalars())

    async def _heartbeat(self, dispatch_id: int) -> None:
        async with self._sm() as session:
            await session.execute(
                update(Dispatch).where(Dispatch.id == dispatch_id).values(last_progress_at=utcnow())
            )
            await session.commit()

    async def _send_batch(
        self, dispatch_id: int, recipient_ids: list[int], subject: str, html: str, text: str
    ) -> None:
        # Tageslimit (SMTP_MAX_PER_DAY, ADR-0032): Der Stand kommt je Batch neu aus der
        # DB und wird im Batch mitgezählt; geprüft wird vor JEDER Mail. Ist das Limit
        # schon zu Beginn erreicht, wird gar keine SMTP-Verbindung geöffnet.
        limit = self._s.smtp_max_per_day
        sent_24h = await self._sent_last_24h() if limit > 0 else 0
        if 0 < limit <= sent_24h:
            await self._fail_open_over_limit(dispatch_id)
            return
        try:
            smtp = await self.mailer.open()
        except Exception as exc:
            # Verbindungsfehler zählt als transienter Fehlversuch für alle fälligen
            # Empfänger — so erschöpft ein dauerhaft toter Relay die Retries und der
            # Auftrag endet in 'failed' statt ewig in 'sending' (Plan 6.3).
            log.warning("SMTP-Verbindung fehlgeschlagen: %s", exc)
            for recipient_id in recipient_ids:
                await self._record_failure(recipient_id, f"Verbindungsfehler: {exc}", "transient")
            return
        try:
            min_interval = (
                60.0 / self._s.smtp_max_per_minute if self._s.smtp_max_per_minute > 0 else 0.0
            )
            for recipient_id in recipient_ids:
                if 0 < limit <= sent_24h:
                    # Der mitgezählte Stand kann zu hoch sein: Während der Batch läuft
                    # (Pause der Drossel, langsamer Server), fallen ältere Mails aus dem
                    # 24-Stunden-Fenster. Abschreiben ist endgültig — deshalb vorher
                    # einmal neu aus der DB lesen und mit diesem Stand weitermachen.
                    sent_24h = await self._sent_last_24h()
                    if limit <= sent_24h:
                        await self._fail_open_over_limit(dispatch_id)
                        break
                # Nachladen + Nachrichtenbau gehören MIT ins Fehlerhandling: Eine
                # deterministisch kaputte Adresse (z. B. Headerzeichen aus dem IdP)
                # würde sonst nie auf failed laufen und den Auftrag ewig in
                # 'sending' halten.
                try:
                    async with self._sm() as session:
                        recipient = (
                            await session.execute(
                                select(DispatchRecipient).where(
                                    DispatchRecipient.id == recipient_id
                                )
                            )
                        ).scalar_one()
                        email = recipient.email
                    # Testbetrieb (MAIL_REDIRECT_TO): alle Mails an die Umleitungs-
                    # adresse; der Originalempfänger bleibt im Header und in der
                    # Historie nachvollziehbar. 'sent' heißt dann: an die Umleitung
                    # übergeben.
                    deliver_to = self._s.mail_redirect_to or email
                    message = self.mailer.build_message(deliver_to, subject, html, text)
                    if self._s.mail_redirect_to:
                        message["X-Original-Recipient"] = email
                except Exception as exc:
                    await self._record_failure(
                        recipient_id, f"Nachricht nicht erstellbar: {exc}"[:500], "permanent"
                    )
                    await self._heartbeat(dispatch_id)
                    continue
                try:
                    await self.mailer.send(smtp, message)
                except Exception as exc:
                    await self._record_failure(
                        recipient_id, str(exc)[:500], classify_smtp_error(exc)
                    )
                else:
                    await self._record_sent(recipient_id)
                    sent_24h += 1  # nur Übergebenes zählt, Fehlversuche nicht
                await self._heartbeat(dispatch_id)
                if min_interval:
                    await asyncio.sleep(min_interval)
        finally:
            await self.mailer.close(smtp)

    async def _sent_last_24h(self) -> int:
        """Stand fürs Tageslimit: 'sent'-Zeilen der letzten 24 Stunden über ALLE Aufträge,
        aus der DB — ein Neustart setzt ihn nicht zurück. Umgeleitete Mails
        (MAIL_REDIRECT_TO) zählen mit, weil auch sie 'sent' werden.

        Gezählt ist damit, was der Worker als übergeben VERMERKEN konnte — nicht, was der
        Server angenommen hat. Geht nach der Annahme die Bestätigung verloren (die Antwort
        kommt nicht vor dem Timeout, die Verbindung bricht nach DATA ab, das DB-Update
        scheitert, der Prozess stirbt), ist die Mail zugestellt, aber nicht gezählt. Für
        den Worker gilt ihr Empfänger als nicht beliefert: Er wird nach den üblichen Regeln
        erneut versucht (Retry mit Backoff, nächster Tick, Wiederanlauf nach einem
        Absturz), solange das Limit nicht erreicht ist."""
        since = utcnow() - timedelta(hours=24)
        async with self._sm() as session:
            count: int = (
                await session.execute(
                    select(func.count())
                    .select_from(DispatchRecipient)
                    .where(
                        DispatchRecipient.status == RecipientStatus.sent,
                        DispatchRecipient.sent_at >= since,
                    )
                )
            ).scalar_one()
            return count

    async def _fail_open_over_limit(self, dispatch_id: int) -> None:
        """Tageslimit erreicht: ALLE noch offenen Empfänger des Auftrags endgültig auf
        'failed' — 'pending' wie 'retry_wait', fällig oder nicht. Kein Retry, kein
        Nachholen am Folgetag. Danach ist nichts mehr offen: Der Auftrag schließt im
        selben Tick ab, und es bleibt bei einer Warnung je Auftrag. attempts bleibt
        unverändert, denn das Abschreiben ist kein Sendeversuch."""
        limit = self._s.smtp_max_per_day
        async with self._sm() as session:
            result = await session.execute(
                update(DispatchRecipient)
                .where(
                    DispatchRecipient.dispatch_id == dispatch_id,
                    DispatchRecipient.status.in_(
                        (RecipientStatus.pending, RecipientStatus.retry_wait)
                    ),
                )
                .values(
                    status=RecipientStatus.failed,
                    next_attempt_at=None,
                    last_error=f"Tageslimit erreicht (SMTP_MAX_PER_DAY={limit}): nicht gesendet",
                )
            )
            await session.commit()
        # Nur Zahlen: Empfängeradressen gehören nicht ins Log (ADR-0014).
        log.warning(
            "Versand %s: Tageslimit erreicht (SMTP_MAX_PER_DAY=%s) — %s Empfänger nicht gesendet",
            dispatch_id,
            limit,
            result.rowcount,  # type: ignore[attr-defined]
        )

    async def _record_sent(self, recipient_id: int) -> None:
        async with self._sm() as session:
            await session.execute(
                update(DispatchRecipient)
                .where(DispatchRecipient.id == recipient_id)
                .values(status=RecipientStatus.sent, sent_at=utcnow(), last_error=None)
            )
            await session.commit()

    async def _record_failure(self, recipient_id: int, error: str, kind: str) -> None:
        backoff = self._s.retry_backoff
        async with self._sm() as session:
            recipient = (
                await session.execute(
                    select(DispatchRecipient).where(DispatchRecipient.id == recipient_id)
                )
            ).scalar_one()
            recipient.attempts += 1
            recipient.last_error = error[:500]
            if kind == "permanent" or recipient.attempts > len(backoff):
                recipient.status = RecipientStatus.failed
                recipient.next_attempt_at = None
            else:
                recipient.status = RecipientStatus.retry_wait
                delay = backoff[recipient.attempts - 1]
                recipient.next_attempt_at = utcnow() + timedelta(seconds=delay)
            await session.commit()

    async def _finalize_if_done(self, dispatch_id: int) -> None:
        """Abschlussstatus erst, wenn keine pending/retry_wait-Zeilen mehr existieren (Plan 6.3)."""
        async with self._sm() as session:
            rows = (
                await session.execute(
                    select(DispatchRecipient.status, func.count())
                    .where(DispatchRecipient.dispatch_id == dispatch_id)
                    .group_by(DispatchRecipient.status)
                )
            ).all()
            counts: dict[RecipientStatus, int] = {status: n for status, n in rows}
            open_count = counts.get(RecipientStatus.pending, 0) + counts.get(
                RecipientStatus.retry_wait, 0
            )
            if open_count > 0:
                return  # Backoff läuft noch — nächster Tick übernimmt
            sent = counts.get(RecipientStatus.sent, 0)
            failed = counts.get(RecipientStatus.failed, 0)
            if sent == 0 and failed > 0:
                status = DispatchStatus.failed
            elif failed > 0:
                status = DispatchStatus.completed_with_errors
            else:
                status = DispatchStatus.completed
            await session.execute(
                update(Dispatch)
                .where(Dispatch.id == dispatch_id, Dispatch.status == DispatchStatus.sending)
                .values(status=status, finished_at=utcnow(), last_progress_at=utcnow())
            )
            await session.commit()
            log.info(
                "Versand %s abgeschlossen: %s (sent=%s, failed=%s)",
                dispatch_id,
                status.value,
                sent,
                failed,
            )


def _title_from_subject(subject: str, topic_name: str) -> str:
    """Extrahiert den Titel aus dem gespeicherten Betreff '[PRÄFIX] Topic: Titel'."""
    marker = f"] {topic_name}: "
    idx = subject.find(marker)
    return subject[idx + len(marker) :] if idx >= 0 else subject


async def retention_cleanup(
    sessionmaker: async_sessionmaker[AsyncSession], settings: Settings
) -> None:
    """Konfigurierbare Retention (Plan 10.1 Nr. 4/7): Default aus, keine Frist raten.

    Löscht nur personenbezogene Detailzeilen — der Versand-Header (dispatches)
    bleibt dauerhaft (Dashboards/Newsfeed-Erweiterungspunkt).
    """
    from sqlalchemy import delete

    now = utcnow()
    async with sessionmaker() as session:
        if settings.retention_days_recipients:
            cutoff = now - timedelta(days=settings.retention_days_recipients)
            done = select(Dispatch.id).where(
                Dispatch.finished_at.is_not(None), Dispatch.finished_at < cutoff
            )
            result = await session.execute(
                delete(DispatchRecipient).where(DispatchRecipient.dispatch_id.in_(done))
            )
            deleted = result.rowcount  # type: ignore[attr-defined]
            if deleted:
                log.info("Retention: %s Empfängerzeilen gelöscht", deleted)
        if settings.retention_days_audit:
            cutoff = now - timedelta(days=settings.retention_days_audit)
            result = await session.execute(delete(AuditLog).where(AuditLog.ts < cutoff))
            deleted = result.rowcount  # type: ignore[attr-defined]
            if deleted:
                log.info("Retention: %s Audit-Zeilen gelöscht", deleted)
        await session.commit()


async def retention_loop(
    sessionmaker: async_sessionmaker[AsyncSession], settings: Settings
) -> None:
    while True:
        try:
            await retention_cleanup(sessionmaker, settings)
        except Exception:
            log.exception("Retention-Lauf fehlgeschlagen")
        await asyncio.sleep(24 * 3600)
