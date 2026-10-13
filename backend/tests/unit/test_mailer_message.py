import email
import email.policy
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import aiosmtplib
import pytest

from app.mail.mailer import Mailer


def test_multipart_alternative_mit_umlaut_betreff(settings):
    mailer = Mailer(settings)
    betreff = "[STÖRUNG] KAP: Beeinträchtigung"
    message = mailer.build_message("empfaenger@example.corp", betreff, "<p>Hällo</p>", "Hällo")
    assert message["To"] == "empfaenger@example.corp"
    assert message["From"].endswith("<stoerungsinfo@test.local>")
    # Mit dieser Policy serialisiert aiosmtplib die Mail. Was der Empfänger daraus liest,
    # muss der Betreff sein, der hineinging — samt Umlauten.
    serialized = message.as_bytes(policy=email.policy.SMTP)
    gelesen = email.message_from_bytes(serialized, policy=email.policy.default)
    assert gelesen["Subject"] == betreff

    parts = [p.get_content_type() for p in message.walk()]
    assert "multipart/alternative" in parts
    assert "text/plain" in parts
    assert "text/html" in parts
    # Plaintext zuerst, HTML als bevorzugte Alternative zuletzt
    assert parts.index("text/plain") < parts.index("text/html")


def test_date_header_ist_gesetzt(settings):
    """RFC 5322 verlangt Date. Ohne ihn hängt es am Relay, ob die Mail einen bekommt —
    fehlt er beim Empfänger, wertet ein Spamfilter das gegen die Störungsmeldung."""
    message = Mailer(settings).build_message("a@example.corp", "Betreff", "<p>x</p>", "x")
    gesendet = parsedate_to_datetime(message["Date"])
    assert gesendet.tzinfo is not None
    assert abs((datetime.now(UTC) - gesendet).total_seconds()) < 60
    assert message.as_bytes().count(b"\nDate: ") == 1


async def test_mailer_open_ssl_and_auth(settings, monkeypatch):
    class DummySMTP:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.connected = False
            self.logged_in = False

        async def connect(self):
            self.connected = True

        async def login(self, u, p):
            self.logged_in = True

        async def quit(self):
            pass

    monkeypatch.setattr("aiosmtplib.SMTP", lambda **kwargs: DummySMTP(**kwargs))

    settings.smtp_security = "ssl"
    settings.smtp_auth_mode = "login"
    settings.smtp_user = "user"
    settings.smtp_password = "pw"

    mailer = Mailer(settings)
    smtp = await mailer.open()
    assert smtp.connected is True
    assert smtp.logged_in is True
    await mailer.close(smtp)


@pytest.mark.parametrize(
    ("security", "use_tls", "start_tls"),
    [("ssl", True, False), ("starttls", False, True), ("none", False, False)],
)
async def test_smtp_security_bestimmt_die_verschluesselung(
    settings, monkeypatch, security, use_tls, start_tls
):
    """Stünde die Abbildung falsch, gingen Zugangsdaten und Mails unverschlüsselt hinaus,
    wo der Relay es zulässt — ohne dass irgendetwas scheitert."""
    aufrufe = []

    class DummySMTP:
        def __init__(self, **kwargs):
            aufrufe.append(kwargs)

        async def connect(self):
            pass

    monkeypatch.setattr("aiosmtplib.SMTP", DummySMTP)
    settings.smtp_security = security

    await Mailer(settings).open()

    assert (aufrufe[0]["use_tls"], aufrufe[0]["start_tls"]) == (use_tls, start_tls)


async def test_mailer_schliesst_die_verbindung_wenn_der_login_scheitert(settings, monkeypatch):
    """Sonst bliebe bei falschen Zugangsdaten je Versuch eine offene Verbindung am Relay."""
    verbindungen = []

    class DummySMTP:
        def __init__(self, **kwargs):
            self.geschlossen = False
            verbindungen.append(self)

        async def connect(self):
            pass

        async def login(self, user, password):
            raise aiosmtplib.SMTPAuthenticationError(535, "bad credentials")

        async def quit(self):
            self.geschlossen = True

    monkeypatch.setattr("aiosmtplib.SMTP", lambda **kwargs: DummySMTP(**kwargs))
    settings.smtp_auth_mode = "login"
    settings.smtp_user = "user"
    settings.smtp_password = "falsch"

    with pytest.raises(aiosmtplib.SMTPAuthenticationError):
        await Mailer(settings).open()

    assert [v.geschlossen for v in verbindungen] == [True]
