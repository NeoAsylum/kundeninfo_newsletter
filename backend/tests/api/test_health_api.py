import asyncio
from datetime import timedelta

from app.api import health
from app.core.clock import utcnow
from app.db.models import Dispatch, DispatchStatus


async def test_healthz_endpoint(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "git_sha" in data


async def test_smtp_check_erreicht_einen_lauschenden_port(monkeypatch):
    """Die echte Verbindungsprüfung, ohne fremden Dienst: ein eigener Listener auf einem
    freien Port. (Den geschlossenen Port deckt der Cache-Test weiter unten ab.)"""
    monkeypatch.setattr(health, "_smtp_cache", {"at": 0.0, "ok": False, "error": "alt"})
    server = await asyncio.start_server(lambda reader, writer: writer.close(), "127.0.0.1", 0)
    try:
        port = server.sockets[0].getsockname()[1]
        assert await health._check_smtp("127.0.0.1", port) == (True, "")
    finally:
        server.close()
        await server.wait_closed()


def _smtp(monkeypatch, ok: bool, error: str = "") -> None:
    async def check(host: str, port: int) -> tuple[bool, str]:
        return ok, error

    monkeypatch.setattr(health, "_check_smtp", check)


async def test_readyz_alles_ok(client, monkeypatch):
    _smtp(monkeypatch, True)
    response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {"db": "ok", "smtp": "ok", "outbox": "ok"},
    }


async def test_readyz_smtp_fehler_503_ohne_interne_details(client, monkeypatch):
    """/readyz ist unauthentifiziert — der Relay-Host aus der Fehlermeldung bleibt im Log."""
    _smtp(monkeypatch, False, "Connect call failed ('10.1.2.3', 25) relay.intern.corp")
    response = await client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"]["smtp"] == "fehler"
    assert "10.1.2.3" not in response.text
    assert "relay.intern.corp" not in response.text


async def test_smtp_check_erkennt_geschlossenen_port_und_cacht(monkeypatch):
    monkeypatch.setattr(health, "_smtp_cache", {"at": 0.0, "ok": True, "error": ""})
    aufrufe = 0

    async def kein_relay(host, port):
        nonlocal aufrufe
        aufrufe += 1
        raise ConnectionRefusedError("abgelehnt")

    monkeypatch.setattr(health.asyncio, "open_connection", kein_relay)
    assert await health._check_smtp("relay.test", 25) == (False, "abgelehnt")
    # Innerhalb der Cache-Frist kein zweiter Verbindungsversuch (Monitoring pollt eng)
    assert await health._check_smtp("relay.test", 25) == (False, "abgelehnt")
    assert aufrufe == 1


async def test_readyz_db_fehler_503_ohne_verbindungsdaten(client, app, monkeypatch):
    """Die Fehlermeldung des Treibers nennt Host und Port aus dem DSN — sie gehört ins
    Log, nicht in die Antwort eines unauthentifizierten Endpunkts."""
    _smtp(monkeypatch, True)

    def keine_verbindung():
        raise OSError('connection to server at "db.intern.corp" (10.1.2.3), port 5432 failed')

    monkeypatch.setattr(app.state, "sessionmaker", keine_verbindung)

    response = await client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"]["db"] == "fehler"
    assert "db.intern.corp" not in response.text
    assert "10.1.2.3" not in response.text


async def test_readyz_outbox_backlog_degraded(client, app, make_user):
    admin = await make_user(sub="admin-h", email="adminh@example.corp")
    async with app.state.sessionmaker() as session:
        old_dispatch = Dispatch(
            topic_id="kap",
            severity="stoerung",
            subject="Alter Rückstau",
            body="Text",
            status=DispatchStatus.pending,
            recipient_count=1,
            created_by_user_id=admin.id,
            created_at=utcnow() - timedelta(seconds=1000),
        )
        session.add(old_dispatch)
        await session.commit()

    response = await client.get("/readyz")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "degraded"
    assert "rückstau" in data["checks"]["outbox"]
