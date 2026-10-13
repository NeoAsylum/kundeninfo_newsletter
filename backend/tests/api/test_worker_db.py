"""Worker-Tests gegen die echte DB (Plan 6.3/M3b): Claiming, Retry, Stale-Recovery,
Abschlussstatus, Wiederanlauf nach Crash. SMTP ist gemockt (FakeMailer)."""

import asyncio
from datetime import timedelta

import aiosmtplib
import pytest
from sqlalchemy import select, update

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
        self.messages: list = []
        self.fail_plan = {k: list(v) for k, v in (fail_plan or {}).items()}
        self.connect_failures = connect_failures
        self.connections = 0  # Verbindungsversuche, auch gescheiterte

    async def open(self):
        self.connections += 1
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
        self.messages.append(message)

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
    """Eine kaputte Adresse (Headerzeichen) muss auf failed laufen —
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
    """Tick-Starvation: Wirft Auftrag A deterministisch, müssen B und
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


async def test_mail_redirect_to_testadresse(app):
    """MAIL_REDIRECT_TO (Testbetrieb): alle Mails gehen an die Umleitungsadresse,
    Originalempfänger bleiben in Header und Historie nachvollziehbar."""
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de"])
    settings = worker_settings(mail_redirect_to="tester@outlook.example")
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)

    await worker.tick()

    assert mailer.sent == ["tester@outlook.example", "tester@outlook.example"]
    originals = sorted(m["X-Original-Recipient"] for m in mailer.messages)
    assert originals == ["a@x.de", "b@x.de"]

    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed
    assert sorted(r.email for r in recipients) == ["a@x.de", "b@x.de"]  # Historie unverändert


async def test_drosselung_pausiert_zwischen_den_mails(app, monkeypatch):
    """SMTP_MAX_PER_MINUTE: Zwischen zwei Mails liegt die errechnete Pause — sonst
    läuft ein Großversand ins Kontingent des Relays."""
    import app.mail.worker as worker_module

    echtes_sleep = worker_module.asyncio.sleep
    pausen: list[float] = []

    async def sleep_ohne_warten(delay, *args, **kwargs):
        if delay:
            pausen.append(delay)
        await echtes_sleep(0)  # weiter kooperativ abgeben, nur nicht wirklich warten

    monkeypatch.setattr(worker_module.asyncio, "sleep", sleep_ohne_warten)

    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de", "c@x.de"])
    settings = worker_settings(smtp_max_per_minute=120)
    mailer = FakeMailer(settings)
    await OutboxWorker(app.state.sessionmaker, settings, mailer=mailer).tick()

    dispatch, _ = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed
    assert len(mailer.sent) == 3
    # 60 s / 120 Mails = 0,5 s — mindestens zwischen den drei Mails
    assert pausen.count(0.5) >= 2


# --- Tageslimit (SMTP_MAX_PER_DAY, ADR-0032) -------------------------------------------

UEBER_DEM_LIMIT = "Tageslimit erreicht (SMTP_MAX_PER_DAY={}): nicht gesendet"
# Versand, Limit, Anzahl der abgeschriebenen Empfänger
WARNUNG = "Versand {}: Tageslimit erreicht (SMTP_MAX_PER_DAY={}) — {} Empfänger nicht gesendet"


def limit_settings(limit, **overrides):
    # Mit dem echten Backoff (60,300,900) statt 0,0,0 aus worker_settings: Landete ein
    # Empfänger über dem Limit fälschlich in retry_wait, bleibt er dort liegen und der
    # Auftrag in 'sending'. Mit Backoff 0 liefe er im selben Tick auf failed durch und
    # sähe am Status aus wie gewollt.
    return make_settings(smtp_max_per_day=limit, **overrides)


async def tick(worker):
    # Mit Zeitlimit: Blieben Empfänger über dem Limit 'pending', drehte process_dispatch
    # endlos — der Test soll dann rot werden statt zu hängen.
    await asyncio.wait_for(worker.tick(), timeout=30)


async def frueherer_versand(app, emails, sent_at, status=RecipientStatus.sent):
    """Ein abgeschlossener Auftrag, dessen Empfängerzeilen Status und sent_at schon tragen."""
    dispatch_id = await create_dispatch(
        app, emails, status=DispatchStatus.completed, started_at=sent_at, finished_at=sent_at
    )
    async with app.state.sessionmaker() as session:
        await session.execute(
            update(DispatchRecipient)
            .where(DispatchRecipient.dispatch_id == dispatch_id)
            .values(status=status, sent_at=sent_at)
        )
        await session.commit()
    return dispatch_id


def limit_warnungen(caplog):
    return [
        r.getMessage()
        for r in caplog.records
        if r.name == "app.mail.worker" and r.levelname == "WARNING"
    ]


def zaehlabfragen(worker, monkeypatch):
    """Zählt mit, wie oft der Worker den Stand fürs Tageslimit aus der Datenbank liest."""
    echt = worker._sent_last_24h
    aufrufe = []

    async def zaehlen():
        aufrufe.append(1)
        return await echt()

    monkeypatch.setattr(worker, "_sent_last_24h", zaehlen)
    return aufrufe


async def test_tageslimit_stoppt_den_versand_mittendrin(app, caplog):
    """SMTP_MAX_PER_DAY=2, fünf Empfänger in EINEM Batch: Geprüft wird vor jeder Mail, nicht
    nur am Batch-Anfang. Die übrigen drei enden endgültig als failed — ohne Sendeversuch,
    ohne Retry — und der Auftrag schließt regulär ab. Abgeschrieben wird EINMAL für alle
    drei: eine Warnung mit der Anzahl 3, nicht eine je übrigem Empfänger des Batches."""
    dispatch_id = await create_dispatch(app, [f"e{i}@x.de" for i in range(1, 6)])
    settings = limit_settings(2)
    mailer = FakeMailer(settings)

    with caplog.at_level("WARNING", logger="app.mail.worker"):
        await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    assert limit_warnungen(caplog) == [WARNUNG.format(dispatch_id, 2, 3)]
    dispatch, recipients = await load(app, dispatch_id)
    assert mailer.sent == [r.email for r in recipients[:2]]
    assert [r.status for r in recipients[:2]] == [RecipientStatus.sent] * 2
    for recipient in recipients[2:]:
        assert recipient.status == RecipientStatus.failed
        assert recipient.last_error == UEBER_DEM_LIMIT.format(2)
        assert recipient.next_attempt_at is None  # kein Retry vorgemerkt
        assert recipient.attempts == 0  # es gab keinen Sendeversuch
    assert dispatch.status == DispatchStatus.completed_with_errors
    assert dispatch.finished_at is not None


async def test_tageslimit_zaehlt_fruehere_versaende_mit(app):
    """Gezählt wird über ALLE Aufträge und aus der Datenbank: Die zwei Mails des ersten
    Versands verbrauchen das Limit des zweiten mit — auch für einen neuen Worker, der wie
    nach einem Neustart nichts im Speicher hat."""
    settings = limit_settings(3)
    erster = await create_dispatch(app, ["a@x.de", "b@x.de"])
    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=FakeMailer(settings)))
    assert (await load(app, erster))[0].status == DispatchStatus.completed

    zweiter = await create_dispatch(app, ["c@x.de", "d@x.de", "e@x.de"])
    mailer = FakeMailer(settings)
    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, recipients = await load(app, zweiter)
    assert len(mailer.sent) == 1  # 2 vom ersten Versand + 1 = Limit
    assert [r.status for r in recipients] == [
        RecipientStatus.sent,
        RecipientStatus.failed,
        RecipientStatus.failed,
    ]
    assert dispatch.status == DispatchStatus.completed_with_errors


async def test_tageslimit_zaehlt_mails_nicht_adressen(app):
    """Der übliche Testfall: derselbe Verteiler mehrmals am Tag. Vier Mails an zwei Adressen
    sind vier — ein Limit von 3 ist damit erreicht, der dritte Versand geht nicht hinaus."""
    for vor_stunden in (2, 1):
        await frueherer_versand(app, ["a@x.de", "b@x.de"], utcnow() - timedelta(hours=vor_stunden))
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de"])
    settings = limit_settings(3)
    mailer = FakeMailer(settings)

    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, _ = await load(app, dispatch_id)
    assert mailer.sent == []
    assert dispatch.status == DispatchStatus.failed


async def test_im_zweiten_versuch_gesendete_mail_zaehlt_fuers_tageslimit(app):
    """Gezählt wird die übergebene Mail, gleich im wievielten Versuch: Die Mail, die erst
    nach einem Fehlversuch hinausging (attempts = 1), schöpft ein Limit von 1 aus."""
    settings = limit_settings(1, worker_retry_backoff_s="0,0,0")  # Retry im selben Tick
    greylisting = aiosmtplib.SMTPResponseException(450, "greylisted")
    mailer = FakeMailer(settings, fail_plan={"a@x.de": [greylisting, None]})
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)
    erster = await create_dispatch(app, ["a@x.de"])
    await tick(worker)
    _, recipients = await load(app, erster)
    assert (recipients[0].status, recipients[0].attempts) == (RecipientStatus.sent, 1)

    zweiter = await create_dispatch(app, ["b@x.de"])
    await tick(worker)

    assert mailer.sent == ["a@x.de"]
    assert (await load(app, zweiter))[0].status == DispatchStatus.failed


async def test_tageslimit_liest_den_stand_einmal_je_batch(app, monkeypatch):
    """Auch mit Limit bleibt es bei EINER Zählabfrage je Batch (sechs Empfänger, Batchgröße
    3: zwei Abfragen) — im Batch wird mitgezählt, nicht vor jeder Mail neu gelesen."""
    dispatch_id = await create_dispatch(app, [f"e{i}@x.de" for i in range(1, 7)])
    settings = limit_settings(10, smtp_batch_size=3)
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)
    aufrufe = zaehlabfragen(worker, monkeypatch)

    await tick(worker)

    assert len(mailer.sent) == 6
    assert (await load(app, dispatch_id))[0].status == DispatchStatus.completed
    assert len(aufrufe) == 2


@pytest.mark.parametrize(("alter_in_stunden", "noch_frei"), [(23, 0), (25, 2)])
async def test_tageslimit_zaehlt_nur_die_letzten_24_stunden(app, alter_in_stunden, noch_frei):
    """Das Fenster gleitet: Zwei Mails von vor 23 Stunden schöpfen ein Limit von 2 noch aus,
    zwei von vor 25 Stunden nicht mehr."""
    gesendet_am = utcnow() - timedelta(hours=alter_in_stunden)
    await frueherer_versand(app, ["a@x.de", "b@x.de"], gesendet_am)
    dispatch_id = await create_dispatch(app, ["c@x.de", "d@x.de"])
    settings = limit_settings(2)
    mailer = FakeMailer(settings)

    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, _ = await load(app, dispatch_id)
    assert len(mailer.sent) == noch_frei
    assert dispatch.status == (DispatchStatus.completed if noch_frei else DispatchStatus.failed)


async def test_erreichtes_tageslimit_oeffnet_keine_smtp_verbindung(app):
    """Ist das Limit schon vor dem Batch erreicht, wird der SMTP-Server gar nicht erst
    angesprochen; der Auftrag endet als failed, weil keine Mail hinausging."""
    await frueherer_versand(app, ["a@x.de", "b@x.de"], utcnow() - timedelta(hours=1))
    dispatch_id = await create_dispatch(app, ["c@x.de", "d@x.de", "e@x.de"])
    settings = limit_settings(2)
    mailer = FakeMailer(settings)

    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, recipients = await load(app, dispatch_id)
    assert mailer.connections == 0
    assert mailer.sent == []
    assert dispatch.status == DispatchStatus.failed
    assert [(r.status, r.last_error) for r in recipients] == [
        (RecipientStatus.failed, UEBER_DEM_LIMIT.format(2))
    ] * 3


async def test_fehlversuche_verbrauchen_das_tageslimit_nicht(app):
    """Nur übergebene Mails zählen: Der abgelehnte erste Empfänger kostet nichts vom Limit,
    die beiden anderen gehen noch hinaus."""
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de", "c@x.de"])
    _, recipients = await load(app, dispatch_id)
    erster = recipients[0].email  # kleinste id — wird als Erster versucht
    settings = limit_settings(2)
    abgelehnt = aiosmtplib.SMTPResponseException(550, "no such mailbox")
    mailer = FakeMailer(settings, fail_plan={erster: [abgelehnt]})

    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, recipients = await load(app, dispatch_id)
    assert mailer.sent == [r.email for r in recipients[1:]]
    assert recipients[0].status == RecipientStatus.failed
    assert "no such mailbox" in recipients[0].last_error
    assert [r.status for r in recipients[1:]] == [RecipientStatus.sent] * 2
    assert dispatch.status == DispatchStatus.completed_with_errors


async def test_tageslimit_schreibt_auch_wartende_wiederholungen_ab(app, caplog):
    """Ist das Limit erreicht, wird ALLES Offene des Versands abgeschrieben — auch wer nach
    einem Fehlversuch im Backoff wartet und noch gar nicht fällig ist. Der Versand schließt
    damit im selben Tick ab, mit einer einzigen Warnung, und nichts von ihm geht später
    hinaus: Kein Retry ist mehr vorgemerkt, und auch ein wieder freies Fenster holt nichts
    nach."""
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de", "c@x.de"])
    _, recipients = await load(app, dispatch_id)
    erster = recipients[0].email  # kleinste id — wird als Erster versucht
    settings = limit_settings(1)
    greylisting = aiosmtplib.SMTPResponseException(450, "greylisted")
    mailer = FakeMailer(settings, fail_plan={erster: [greylisting]})
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)

    with caplog.at_level("WARNING", logger="app.mail.worker"):
        await tick(worker)

        dispatch, recipients = await load(app, dispatch_id)
        assert [r.status for r in recipients] == [
            RecipientStatus.failed,  # wartete im Backoff (60 s), war also nicht fällig
            RecipientStatus.sent,
            RecipientStatus.failed,
        ]
        for abgeschrieben in (recipients[0], recipients[2]):
            assert abgeschrieben.last_error == UEBER_DEM_LIMIT.format(1)
            assert abgeschrieben.next_attempt_at is None  # kein Retry mehr vorgemerkt
        assert recipients[0].attempts == 1  # der eine echte Fehlversuch, kein weiterer
        assert dispatch.status == DispatchStatus.completed_with_errors
        assert dispatch.finished_at is not None

        async with app.state.sessionmaker() as session:  # das Fenster ist wieder frei
            await session.execute(
                update(DispatchRecipient)
                .where(DispatchRecipient.status == RecipientStatus.sent)
                .values(sent_at=utcnow() - timedelta(hours=25))
            )
            await session.commit()
        await tick(worker)

    assert mailer.sent == [recipients[1].email]
    assert limit_warnungen(caplog) == [WARNUNG.format(dispatch_id, 1, 2)]


async def test_vor_dem_abschreiben_wird_der_stand_neu_gelesen(app, monkeypatch, caplog):
    """Im Batch wird der Stand nur mitgezählt. Fallen währenddessen ältere Mails aus dem
    24-Stunden-Fenster (hier: nach der ersten Mail des Batches sind die zwei früheren
    25 Stunden alt), ist er zu hoch — und Abschreiben ist endgültig. Darum liest der Worker
    davor einmal neu und sendet mit dem frischen Stand weiter: Limit 3, fünf Empfänger, drei
    gehen hinaus, erst die letzten zwei werden abgeschrieben."""
    frueher = await frueherer_versand(app, ["a@x.de", "b@x.de"], utcnow() - timedelta(hours=1))
    dispatch_id = await create_dispatch(app, [f"e{i}@x.de" for i in range(1, 6)])
    settings = limit_settings(3)
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)
    aufrufe = zaehlabfragen(worker, monkeypatch)
    echtes_send = mailer.send

    async def send_und_das_fenster_wandert(smtp, message):
        await echtes_send(smtp, message)
        if len(mailer.sent) == 1:
            async with app.state.sessionmaker() as session:
                await session.execute(
                    update(DispatchRecipient)
                    .where(DispatchRecipient.dispatch_id == frueher)
                    .values(sent_at=utcnow() - timedelta(hours=25))
                )
                await session.commit()

    monkeypatch.setattr(mailer, "send", send_und_das_fenster_wandert)

    with caplog.at_level("WARNING", logger="app.mail.worker"):
        await tick(worker)

    dispatch, recipients = await load(app, dispatch_id)
    assert mailer.sent == [r.email for r in recipients[:3]]
    assert [r.status for r in recipients] == [RecipientStatus.sent] * 3 + [
        RecipientStatus.failed
    ] * 2
    assert dispatch.status == DispatchStatus.completed_with_errors
    assert limit_warnungen(caplog) == [WARNUNG.format(dispatch_id, 3, 2)]
    # Batch-Anfang, dann je einmal, wenn der mitgezählte Stand das Limit erreicht —
    # nicht vor jeder Mail.
    assert len(aufrufe) == 3


async def test_tageslimit_zaehlt_nur_zeilen_im_status_sent(app):
    """Gezählt wird der Status 'sent', nicht ein gesetztes sent_at allein. Der Worker selbst
    hinterlässt sent_at nur an 'sent'-Zeilen; eine von Hand umgestellte Zeile (hier: failed
    mit sent_at) verbraucht das Limit nicht."""
    await frueherer_versand(app, ["a@x.de", "b@x.de"], utcnow(), status=RecipientStatus.failed)
    dispatch_id = await create_dispatch(app, ["c@x.de", "d@x.de"])
    settings = limit_settings(2)
    mailer = FakeMailer(settings)

    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, _ = await load(app, dispatch_id)
    assert len(mailer.sent) == 2
    assert dispatch.status == DispatchStatus.completed


async def test_umgeleitete_mails_zaehlen_fuers_tageslimit(app):
    """MAIL_REDIRECT_TO begrenzt die Menge nicht — es bleibt eine Mail je Empfänger. Darum
    zählen umgeleitete Mails wie jede andere."""
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de", "c@x.de"])
    settings = limit_settings(2, mail_redirect_to="tester@outlook.example")
    mailer = FakeMailer(settings)

    await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    dispatch, recipients = await load(app, dispatch_id)
    assert mailer.sent == ["tester@outlook.example"] * 2
    assert [r.status for r in recipients] == [
        RecipientStatus.sent,
        RecipientStatus.sent,
        RecipientStatus.failed,
    ]
    assert recipients[2].last_error == UEBER_DEM_LIMIT.format(2)
    assert dispatch.status == DispatchStatus.completed_with_errors


async def test_ohne_tageslimit_wird_weder_begrenzt_noch_gezaehlt(app, monkeypatch):
    """SMTP_MAX_PER_DAY=0 (Voreinstellung, PROD): kein Limit — und auch keine Zählabfrage
    vor jedem Batch."""
    await frueherer_versand(app, ["a@x.de", "b@x.de"], utcnow())
    dispatch_id = await create_dispatch(app, ["c@x.de", "d@x.de", "e@x.de"])
    settings = limit_settings(0)
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)
    zaehlungen = []

    async def zaehlen():
        zaehlungen.append(1)
        return 0

    monkeypatch.setattr(worker, "_sent_last_24h", zaehlen)

    await tick(worker)

    dispatch, _ = await load(app, dispatch_id)
    assert len(mailer.sent) == 3
    assert dispatch.status == DispatchStatus.completed
    assert zaehlungen == []


async def test_nach_dem_tageslimit_wird_nichts_nachgesendet(app):
    """Empfänger über dem Limit warten nicht auf den nächsten Tag: Weder der nächste Tick
    noch ein wieder freies Fenster (die gesendete Mail ist dann 25 Stunden alt) holt sie
    nach. Dass das Fenster wirklich frei ist, zeigt der NEUE Versand, der hinausgeht.

    EIN Worker über alle Ticks, wie im Betrieb (ein Objekt je Prozess): Der Stand kommt für
    jeden Batch neu aus der Datenbank. Merkte ihn sich der Worker, bliebe das Limit bis
    zum Neustart erreicht, und der neue Versand scheiterte."""
    dispatch_id = await create_dispatch(app, ["a@x.de", "b@x.de", "c@x.de"])
    settings = limit_settings(1)
    mailer = FakeMailer(settings)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=mailer)
    await tick(worker)
    assert len(mailer.sent) == 1

    await tick(worker)
    assert len(mailer.sent) == 1  # zweiter Tick: nichts weiter
    assert mailer.connections == 1  # und auch keine neue Verbindung

    async with app.state.sessionmaker() as session:
        await session.execute(
            update(DispatchRecipient)
            .where(DispatchRecipient.status == RecipientStatus.sent)
            .values(sent_at=utcnow() - timedelta(hours=25))
        )
        await session.commit()
    neuer = await create_dispatch(app, ["d@x.de"])
    await tick(worker)

    assert mailer.sent[1:] == ["d@x.de"]
    dispatch, recipients = await load(app, dispatch_id)
    assert dispatch.status == DispatchStatus.completed_with_errors
    assert [r.status for r in recipients] == [
        RecipientStatus.sent,
        RecipientStatus.failed,
        RecipientStatus.failed,
    ]
    assert (await load(app, neuer))[0].status == DispatchStatus.completed


async def test_tageslimit_schreibt_eine_warnung_je_versand_ohne_adressen(app, caplog):
    """Eine Warnung je betroffenem Versand — nicht je Batch (sieben Empfänger, Batchgröße 2)
    — mit Auftragsnummer, Limit und der Anzahl aus DIESEM Versand. Adressen stehen in
    keiner Zeile des Workers (ADR-0014), auch nicht die der Umleitung — mitgeschnitten ab
    DEBUG, denn die VM läuft mit LOG_LEVEL=INFO, und eine Adresse in einer INFO-Zeile
    fiele ab WARNING nicht auf."""
    erster = await create_dispatch(app, [f"e{i}@x.de" for i in range(1, 8)])
    zweiter = await create_dispatch(app, ["f1@x.de", "f2@x.de"])
    settings = limit_settings(3, smtp_batch_size=2, mail_redirect_to="tester@outlook.example")
    mailer = FakeMailer(settings)

    with caplog.at_level("DEBUG", logger="app.mail.worker"):
        await tick(OutboxWorker(app.state.sessionmaker, settings, mailer=mailer))

    assert len(mailer.sent) == 3  # das Limit gilt über die Batchgrenze hinweg
    assert limit_warnungen(caplog) == [
        WARNUNG.format(erster, 3, 4),
        WARNUNG.format(zweiter, 3, 2),
    ]
    vom_worker = [r for r in caplog.records if r.name == "app.mail.worker"]
    assert "INFO" in {r.levelname for r in vom_worker}  # der Mitschnitt reicht unter WARNING
    assert "@" not in caplog.text


@pytest.mark.parametrize(
    ("limit", "angabe"), [(5, "Tageslimit: 5 Mails in 24 Stunden"), (0, "kein Tageslimit")]
)
async def test_startzeile_des_workers_nennt_das_geltende_tageslimit(app, caplog, limit, angabe):
    """Welches Limit gilt, steht beim Start im Log. Sonst fiele nirgends auf, dass keines
    gilt: Die Voreinstellung ist 0, und ein vertippter Variablenname ändert daran nichts."""
    settings = limit_settings(limit)
    worker = OutboxWorker(app.state.sessionmaker, settings, mailer=FakeMailer(settings))
    worker.stop()  # die Schleife endet, bevor sie einen Tick beginnt

    with caplog.at_level("INFO", logger="app.mail.worker"):
        await asyncio.wait_for(worker.run(), timeout=5)

    assert [r.getMessage() for r in caplog.records if r.name == "app.mail.worker"] == [
        f"Outbox-Worker gestartet (Poll-Intervall 0.05s, {angabe})",
        "Outbox-Worker gestoppt",
    ]
