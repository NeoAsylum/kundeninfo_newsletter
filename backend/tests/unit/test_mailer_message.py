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


def test_xoauth2_string_format(settings):
    """SASL-XOAUTH2: base64("user=<user>^Aauth=Bearer <token>^A^A")."""
    import base64

    from app.mail.mailer import Mailer

    encoded = Mailer.xoauth2_string("konto@outlook.de", "ABC123")
    decoded = base64.b64decode(encoded).decode()
    assert decoded == "user=konto@outlook.de\x01auth=Bearer ABC123\x01\x01"


async def test_oauth2_token_wird_gecacht(monkeypatch):
    """Ein Token-Abruf pro Gültigkeitszeitraum — nicht pro Verbindung."""
    import httpx

    from app.mail.mailer import Mailer
    from tests.conftest import make_settings

    calls = {"n": 0}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"access_token": "tok-1", "expires_in": 3600}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None):
            calls["n"] += 1
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: FakeClient())
    mailer = Mailer(
        make_settings(
            smtp_auth_mode="oauth2",
            smtp_user="konto@outlook.de",
            smtp_oauth_client_id="client-1",
            smtp_oauth_refresh_token="refresh-1",
        )
    )

    assert await mailer._get_access_token() == "tok-1"
    assert await mailer._get_access_token() == "tok-1"
    assert calls["n"] == 1


async def test_oauth2_fehler_wird_gemeldet(monkeypatch):
    import httpx
    import pytest

    from app.mail.mailer import Mailer, MailerAuthError
    from tests.conftest import make_settings

    class FailResponse:
        status_code = 400
        text = '{"error":"invalid_grant","error_description":"AADSTS70008: expired"}'

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None):
            return FailResponse()

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: FakeClient())
    mailer = Mailer(
        make_settings(
            smtp_auth_mode="oauth2",
            smtp_user="konto@outlook.de",
            smtp_oauth_client_id="client-1",
            smtp_oauth_refresh_token="abgelaufen",
        )
    )
    with pytest.raises(MailerAuthError, match="AADSTS70008"):
        await mailer._get_access_token()


async def test_oauth2_handshake_sendet_auth_xoauth2(monkeypatch):
    """Der AUTH-Befehl muss XOAUTH2 mit base64-Payload sein; 235 = akzeptiert."""
    import base64

    import aiosmtplib
    import httpx

    from app.mail.mailer import Mailer
    from tests.conftest import make_settings

    commands = []

    class FakeSMTP:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def connect(self):
            return None

        async def execute_command(self, *args, timeout=None):  # noqa: ASYNC109 (Test-Fake spiegelt die aiosmtplib-Signatur)
            commands.append(args)
            return 235, b"2.7.0 Authentication successful"

        async def quit(self):
            return None

    class FakeTokenResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"access_token": "TOKEN-XYZ", "expires_in": 3600}

    class FakeHttpClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None):
            return FakeTokenResponse()

    monkeypatch.setattr(aiosmtplib, "SMTP", lambda **kwargs: FakeSMTP(**kwargs))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: FakeHttpClient())

    mailer = Mailer(
        make_settings(
            smtp_host="smtp-mail.outlook.com",
            smtp_port=587,
            smtp_security="starttls",
            smtp_auth_mode="oauth2",
            smtp_user="konto@outlook.de",
            smtp_oauth_client_id="client-1",
            smtp_oauth_refresh_token="refresh-1",
        )
    )
    smtp = await mailer.open()

    assert smtp.kwargs["start_tls"] is True
    assert len(commands) == 1
    verb, mechanism, payload = commands[0]
    assert verb == b"AUTH"
    assert mechanism == b"XOAUTH2"
    assert base64.b64decode(payload).decode() == (
        "user=konto@outlook.de\x01auth=Bearer TOKEN-XYZ\x01\x01"
    )


async def test_oauth2_abgelehnter_handshake_wirft(monkeypatch):
    import aiosmtplib
    import httpx
    import pytest

    from app.mail.mailer import Mailer, MailerAuthError
    from tests.conftest import make_settings

    class FakeSMTP:
        def __init__(self, **kwargs):
            pass

        async def connect(self):
            return None

        async def execute_command(self, *args, timeout=None):  # noqa: ASYNC109 (Test-Fake spiegelt die aiosmtplib-Signatur)
            return 535, b"5.7.3 Authentication unsuccessful"

        async def quit(self):
            return None

    class FakeTokenResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"access_token": "TOKEN", "expires_in": 3600}

    class FakeHttpClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None):
            return FakeTokenResponse()

    monkeypatch.setattr(aiosmtplib, "SMTP", lambda **kwargs: FakeSMTP(**kwargs))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: FakeHttpClient())

    mailer = Mailer(
        make_settings(
            smtp_auth_mode="oauth2",
            smtp_user="konto@outlook.de",
            smtp_oauth_client_id="client-1",
            smtp_oauth_refresh_token="refresh-1",
        )
    )
    with pytest.raises(MailerAuthError, match="535"):
        await mailer.open()
