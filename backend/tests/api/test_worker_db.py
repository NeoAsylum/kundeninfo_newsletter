"""Worker-Tests gegen die echte DB (Plan 6.3/M3b): Claiming, Retry, Stale-Recovery,
Abschlussstatus, Wiederanlauf nach Crash. SMTP ist gemockt (FakeMailer)."""

from datetime import timedelta

import aiosmtplib
from sqlalchemy import select

from app.core.clock import utcnow
from app.db.models import (
    Dispatch,
    DispatchRecipient,
    DispatchStatus,
    RecipientStatus,
    Severity,
    User,
)
from app.mail.mailer import Mailer
from app.mail.worker import OutboxWorker
from tests.conftest import make_settings

TOPIC_NAME = "KAP Störungsmeldungen"


class FakeMailer(Mailer):
    """fail_plan: {email: [Exception|None, ...]} — wird pro Sendeversuch konsumiert."""

    def __init__(self, settings, fail_plan=None, connect_failures=0):
        super().__init__(settings)
        self.sent: list[str] = []
        self.fail_plan = {k: list(v) for k, v in (fail_plan or {}).items()}
        self.connect_failures = connect_failures

    async def open(self):
        if self.connect_failures > 0:
            self.connect_failures -= 1
            raise ConnectionRefusedError("Relay nicht erreichbar (Test)")
        return object()

    async def send(self, smtp, message):
        to = message["To"]
        plan = self.fail_plan.get(to)
        if plan:
            exc = plan.pop(0)
            if exc is not None:
                raise exc
        self.sent.append(to)

    async def close(self, smtp):
        pass


def worker_settings(**overrides):
    # Backoff 0,0,0: Retries werden im selben Tick sofort fällig — Tests bleiben schnell
    return make_settings(worker_retry_backoff_s="0,0,0", **overrides)


async def create_dispatch(app, emails, status=DispatchStatus.pending, **dispatch_overrides):
    async with app.state.sessionmaker() as session:
        creator = (
            await session.execute(select(User).where(User.oidc_sub == "worker-creator"))
        ).scalar_one_or_none()
        if creator is None:
            creator = User(oidc_sub="worker-creator", email="creator@example.corp", is_active=True)
            session.add(creator)
            await session.flush()
        dispatch = Dispatch(
            topic_id="kap",
            severity=Severity.stoerung,
            subject=f"[STÖRUNG] {TOPIC_NAME}: Testfall",
            body="Testinhalt",
            status=status,
            recipient_count=len(emails),
            created_by_user_id=creator.id,
            **dispatch_overrides,
        )
        session.add(dispatch)
        await session.flush()
        session.add_all(DispatchRecipient(dispatch_id=dispatch.id, email=email) for email in emails)
        await session.commit()
        return dispatch.id


async def load(app, dispatch_id):
    async with app.state.sessionmaker() as session:
        dispatch = (
            await session.execute(select(Dispatch).where(Dispatch.id == dispatch_id))
        ).scalar_one()
        recipients = (
            (
                await session.execute(
                    select(DispatchRecipient)
                    .where(DispatchRecipient.dispatch_id == dispatch_id)
                    .order_by(DispatchRecipient.id)
                )
            )
            .scalars()
            .all()
        )
        return dispatch, recipients


async def test_happy_path_alle_gesendet(app):
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de", "c@x.de"])
    mailer = FakeMailer(worker_settings())
    worker = OutboxWorker(app.state.sessionmaker, worker_settings(), mailer=mailer)

    await worker.tick()

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed
    assert dispatch.finished_at is not None
    assert sorted(mailer.sent) == ["a@x.de", "b@x.de", "c@x.de"]
    assert all(r.status == RecipientStatus.sent and r.sent_at is not None for r in recipients)


async def test_transienter_fehler_wird_erneut_versucht(app):
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de"])
    fail_plan = {"a@x.de": [aiosmtplib.SMTPResponseException(450, "greylisted"), None]}
    mailer = FakeMailer(worker_settings(), fail_plan=fail_plan)
    worker = OutboxWorker(app.state.sessionmaker, worker_settings(), mailer=mailer)

    await worker.tick()

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed
    by_email = {r.email: r for r in recipients}
    assert by_email["a@x.de"].status == RecipientStatus.sent
    assert by_email["a@x.de"].attempts == 1  # ein Fehlversuch protokolliert
    assert by_email["b@x.de"].attempts == 0


async def test_permanenter_fehler_completed_with_errors(app):
    dispatch_id = await create_dispatch(app, ["gut@x.de", "kaputt@x.de"])
    fail_plan = {"kaputt@x.de": [aiosmtplib.SMTPResponseException(550, "no such mailbox")]}
    mailer = FakeMailer(worker_settings(), fail_plan=fail_plan)
    worker = OutboxWorker(app.state.sessionmaker, worker_settings(), mailer=mailer)

    await worker.tick()

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed_with_errors
    by_email = {r.email: r for r in recipients}
    assert by_email["kaputt@x.de"].status == RecipientStatus.failed
    assert "no such mailbox" in by_email["kaputt@x.de"].last_error
    assert by_email["gut@x.de"].status == RecipientStatus.sent


async def test_relay_dauerhaft_tot_endet_in_failed(app):
    """Erschöpfte Retries statt ewigem 'sending' (Plan 6.3)."""
    dispatch_id = await create_dispatch(app, ["a@x.de"])
    mailer = FakeMailer(worker_settings(), connect_failures=99)
    worker = OutboxWorker(app.state.sessionmaker, worker_settings(), mailer=mailer)

    await worker.tick()

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.failed
    assert recipients[0].status == RecipientStatus.failed
    assert recipients[0].attempts == 4  # 1 + 3 Retries erschöpft


async def test_stale_recovery_und_wiederanlauf(app):
    """Crash-Simulation: 'sending' mit altem Heartbeat, ein Empfänger schon sent.
    Der neue Worker übernimmt und versorgt NUR die verbliebenen Empfänger."""
    settings = worker_settings()
    stale_at = utcnow() - timedelta(seconds=settings.worker_stale_after_s + 60)
    dispatch_id = await create_dispatch(
        app,
        ["schon-versorgt@x.de", "offen@x.de"],
        status=DispatchStatus.sending,
        started_at=stale_at,
        last_progress_at=stale_at,
    )
    async with app.state.sessionmaker() as session:
        recipient = (
            await session.execute(
                select(DispatchRecipient).where(DispatchRecipient.email == "schon-versorgt@x.de")
            )
        ).scalar_one()
        recipient.status = RecipientStatus.sent
        recipient.sent_at = utcnow()
        await session.commit()

    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)
    await worker.tick()

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed
    assert mailer.sent == ["offen@x.de"]  # keine Doppelversorgung des sent-Empfängers


async def test_frischer_sending_auftrag_wird_nicht_als_verwaist_recycelt(app):
    """Aktiver Versand (frischer Heartbeat) darf von recover_stale nicht angefasst werden."""
    dispatch_id = await create_dispatch(
        app,
        ["a@x.de"],
        status=DispatchStatus.sending,
        started_at=utcnow(),
        last_progress_at=utcnow(),
    )
    settings = worker_settings()
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=FakeMailer(settings))

    await worker.recover_stale()

    dispatch, _ = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.sending  # unangetastet


async def test_claiming_ist_atomar(app):
    dispatch_id = await create_dispatch(app, ["a@x.de"])
    settings = worker_settings()
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=FakeMailer(settings))

    claimed_first = await worker.claim_next()
    claimed_second = await worker.claim_next()

    assert claimed_first == dispatch_id
    assert claimed_second is None  # bereits geclaimt — kein Doppel-Claim


async def test_retention_loescht_nur_empfaengerzeilen(app):
    """Retention (Plan 10.1 Nr. 7): Empfänger-Detail verfällt, Versand-Header bleibt
    (Datenquelle für spätere Dashboards/Newsfeeds)."""
    from app.db.models import AuditLog
    from app.mail.worker import retention_cleanup

    old = utcnow() - timedelta(days=30)
    dispatch_id = await create_dispatch(
        app,
        ["a@x.de", "b@x.de"],
        status=DispatchStatus.completed,
        started_at=old,
        finished_at=old,
    )
    async with app.state.sessionmaker() as session:
        session.add(AuditLog(ts=old, actor_email="x@y.z", action="dispatch_created"))
        session.add(AuditLog(actor_email="x@y.z", action="topic_changed"))  # frisch
        await session.commit()

    settings = worker_settings(retention_days_recipients=14, retention_days_audit=14)
    await retention_cleanup(app.state.sessionmaker, settings)

    dispatch, recipients = await load(app, dispatch_id)
    assert recipients == []  # personenbezogene Detailzeilen weg
    assert dispatch.status == DispatchStatus.completed  # Header bleibt
    async with app.state.sessionmaker() as session:
        audits = (await session.execute(select(AuditLog))).scalars().all()
    assert [a.action for a in audits] == ["topic_changed"]  # nur alte Audit-Zeile weg


async def test_retention_default_aus_loescht_nichts(app):
    from app.mail.worker import retention_cleanup

    old = utcnow() - timedelta(days=365)
    dispatch_id = await create_dispatch(
        app, ["a@x.de"], status=DispatchStatus.completed, finished_at=old
    )
    await retention_cleanup(app.state.sessionmaker, worker_settings())  # Defaults: aus

    _, recipients = await load(app, dispatch_id)
    assert len(recipients) == 1  # keine Frist geraten — nichts gelöscht


async def test_poison_empfaenger_blockiert_versand_nicht(app):
    """Review-Befund: Eine kaputte Adresse (Headerzeichen) muss auf failed laufen —
    der Auftrag darf nicht ewig in 'sending' hängen, andere Empfänger werden versorgt."""
    dispatch_id = await create_dispatch(app, ["gut@x.de", "kaputt@x.de\nBcc: evil@x.de"])
    settings = worker_settings()
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)

    await worker.tick()

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed_with_errors
    by_email = {r.email: r for r in recipients}
    assert by_email["gut@x.de"].status == RecipientStatus.sent
    poison = by_email["kaputt@x.de\nBcc: evil@x.de"]
    assert poison.status == RecipientStatus.failed
    assert "Nachricht nicht erstellbar" in poison.last_error


async def test_defekter_auftrag_blockiert_andere_nicht(app, monkeypatch):
    """Review-Befund Tick-Starvation: Wirft Auftrag A deterministisch, müssen B und
    neue Aufträge trotzdem verarbeitet werden."""
    import app.mail.worker as worker_module

    bad_id = await create_dispatch(
        app,
        ["a@x.de"],
        status=DispatchStatus.sending,
        started_at=utcnow(),
        last_progress_at=utcnow(),
    )
    good_id = await create_dispatch(app, ["b@x.de"])

    settings = worker_settings()
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)

    original = worker_module.render_mail
    calls = {"n": 0}

    def explode_only_first(*args, **kwargs):
        # A (kleinere ID, 'sending') wird zuerst verarbeitet → erster Aufruf wirft
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("Template kaputt (Test)")
        return original(*args, **kwargs)

    monkeypatch.setattr(worker_module, "render_mail", explode_only_first)

    await worker.tick()
    good, _ = await load(app, good_id)
    assert good.status == DispatchStatus.completed  # B lief trotz A-Fehler im SELBEN Tick

    await worker.tick()  # A wird im Folgetick nachgeholt (Rendering jetzt intakt)
    bad, _ = await load(app, bad_id)
    assert bad.status == DispatchStatus.completed
