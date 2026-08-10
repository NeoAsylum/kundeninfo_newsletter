from app.mail.mailer import Mailer


def test_multipart_alternative_mit_umlaut_betreff(settings):
    mailer = Mailer(settings)
    message = mailer.build_message(
        "empfaenger@example.corp",
        "[STÖRUNG] KAP: Beeinträchtigung",
        "<p>Hällo</p>",
        "Hällo",
    )
    assert message["To"] == "empfaenger@example.corp"
    assert message["From"].endswith("<stoerungsinfo@test.local>")
    # RFC-2047: Nicht-ASCII-Betreff wird beim Serialisieren encodiert
    serialized = message.as_bytes()
    assert b"=?utf-8?" in serialized or b"STRUNG" not in serialized

    parts = [p.get_content_type() for p in message.walk()]
    assert "multipart/alternative" in parts
    assert "text/plain" in parts
    assert "text/html" in parts
    # Plaintext zuerst, HTML als bevorzugte Alternative zuletzt
    assert parts.index("text/plain") < parts.index("text/html")


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
