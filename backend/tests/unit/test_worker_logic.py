import asyncio

import aiosmtplib

from app.mail.worker import OutboxWorker, _title_from_subject, classify_smtp_error


def test_5xx_ist_permanent():
    exc = aiosmtplib.SMTPResponseException(550, "mailbox unavailable")
    assert classify_smtp_error(exc) == "permanent"


def test_4xx_ist_transient():
    exc = aiosmtplib.SMTPResponseException(450, "try again later")
    assert classify_smtp_error(exc) == "transient"


def test_kontingent_5xx_ist_transient():
    """Ein erreichtes Tageslimit kommt als 5xx, ist aber morgen zustellbar — als
    'permanent' gewertet wären alle restlichen Empfänger abgeschrieben."""
    exc = aiosmtplib.SMTPResponseException(550, "5.4.5 Daily user sending limit exceeded")
    assert classify_smtp_error(exc) == "transient"


def test_abgelehnter_empfaenger_wird_nach_seinem_code_eingestuft():
    """SMTPRecipientsRefused trägt selbst keinen Code — er steckt im ersten Empfänger."""

    def refused(code: int, text: str) -> aiosmtplib.SMTPRecipientsRefused:
        return aiosmtplib.SMTPRecipientsRefused(
            [aiosmtplib.SMTPRecipientRefused(code, text, "a@example.corp")]
        )

    assert classify_smtp_error(refused(550, "no such user")) == "permanent"
    assert classify_smtp_error(refused(451, "greylisted")) == "transient"


def test_verbindungsfehler_ist_transient():
    assert classify_smtp_error(TimeoutError("timeout")) == "transient"
    assert classify_smtp_error(ConnectionRefusedError()) == "transient"


def test_titel_aus_betreff():
    subject = "[STÖRUNG] KAP Störungsmeldungen: Login klemmt: seit 9 Uhr"
    assert _title_from_subject(subject, "KAP Störungsmeldungen") == "Login klemmt: seit 9 Uhr"
    # Fallback: Topic wurde umbenannt → ganzer Betreff als Titel (dokumentierte Degradation)
    assert _title_from_subject(subject, "Anderer Name") == subject


async def test_schleife_ueberlebt_fehlerhaften_tick_und_stoppt(settings, caplog):
    """Der Worker ist der einzige Weg, auf dem Mails hinausgehen: Ein Fehler in einem
    Tick (Datenbank kurz weg) darf die Schleife nicht beenden."""
    worker = OutboxWorker(sessionmaker=None, settings=settings)
    ticks = 0

    async def tick():
        nonlocal ticks
        ticks += 1
        await asyncio.sleep(0)  # Kontrolle abgeben — sonst könnte das Zeitlimit nie greifen
        if ticks == 1:
            raise RuntimeError("Datenbank kurz nicht erreichbar")
        if ticks == 3:
            worker.stop()

    worker.tick = tick
    await asyncio.wait_for(worker.run(), timeout=5)

    assert ticks == 3
    assert "Worker-Tick fehlgeschlagen" in caplog.text
