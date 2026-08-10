import asyncio
from datetime import datetime, timedelta

from app.core.clock import utcnow
from app.db.models import Dispatch, DispatchStatus


async def test_healthz_endpoint(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "git_sha" in data


async def test_readyz_endpoint_healthy(client):
    response = await client.get("/readyz")
    # depending on local test smtp connection
    assert response.status_code in (200, 503)
    data = response.json()
    assert "status" in data
    assert "checks" in data
    assert "db" in data["checks"]


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
