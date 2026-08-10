import aiosmtplib

from app.mail.worker import _title_from_subject, classify_smtp_error


def test_5xx_ist_permanent():
    exc = aiosmtplib.SMTPResponseException(550, "mailbox unavailable")
    assert classify_smtp_error(exc) == "permanent"


def test_4xx_ist_transient():
    exc = aiosmtplib.SMTPResponseException(450, "try again later")
    assert classify_smtp_error(exc) == "transient"


def test_verbindungsfehler_ist_transient():
    assert classify_smtp_error(TimeoutError("timeout")) == "transient"
    assert classify_smtp_error(ConnectionRefusedError()) == "transient"


def test_titel_aus_betreff():
    subject = "[STÖRUNG] KAP Störungsmeldungen: Login klemmt: seit 9 Uhr"
    assert _title_from_subject(subject, "KAP Störungsmeldungen") == "Login klemmt: seit 9 Uhr"
    # Fallback: Topic wurde umbenannt → ganzer Betreff als Titel (dokumentierte Degradation)
    assert _title_from_subject(subject, "Anderer Name") == subject
