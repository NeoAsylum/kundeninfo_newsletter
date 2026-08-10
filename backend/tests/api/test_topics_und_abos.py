from sqlalchemy import select

from app.db.models import AuditLog, Subscription


async def test_topics_mit_subscribed_flag(client, auth_headers, make_user, app):
    user = await make_user(sub="s1", email="mia@example.corp")
    async with app.state.sessionmaker() as session:
        session.add(Subscription(user_id=user.id, topic_id="kap"))
        await session.commit()

    response = await client.get("/api/v1/topics", headers=auth_headers("s1", "mia@example.corp"))
    assert response.status_code == 200
    topics = {t["id"]: t for t in response.json()}
    assert len(topics) == 5  # Seed aus Migration 0002
    assert topics["zentrale-stoerungen"]["is_mandatory"] is True
    assert topics["zentrale-stoerungen"]["subscribed"] is True  # implizit (ADR-009)
    assert topics["kap"]["subscribed"] is True
    assert topics["interflex"]["subscribed"] is False
    # Pflicht-Topic steht vorn
    assert response.json()[0]["id"] == "zentrale-stoerungen"


async def test_abo_setzen_idempotent(client, auth_headers, make_user, app):
    user = await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers("s1", "mia@example.corp")

    assert (await client.put("/api/v1/me/subscriptions/kap", headers=headers)).status_code == 204
    assert (await client.put("/api/v1/me/subscriptions/kap", headers=headers)).status_code == 204

    async with app.state.sessionmaker() as session:
        rows = (
            (await session.execute(select(Subscription).where(Subscription.user_id == user.id)))
            .scalars()
            .all()
        )
    assert len(rows) == 1


async def test_abo_entfernen_idempotent(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers("s1", "mia@example.corp")
    await client.put("/api/v1/me/subscriptions/kap", headers=headers)
    assert (await client.delete("/api/v1/me/subscriptions/kap", headers=headers)).status_code == 204
    assert (await client.delete("/api/v1/me/subscriptions/kap", headers=headers)).status_code == 204


async def test_pflicht_topic_409(client, auth_headers, make_user):
    """Die API ist die Sicherheitsgrenze — nicht nur der gesperrte UI-Toggle."""
    await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers("s1", "mia@example.corp")
    for method in ("put", "delete"):
        response = await getattr(client, method)(
            "/api/v1/me/subscriptions/zentrale-stoerungen", headers=headers
        )
        assert response.status_code == 409
        assert response.json()["code"] == "TOPIC_MANDATORY"


async def test_unbekanntes_topic_404(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    response = await client.put(
        "/api/v1/me/subscriptions/gibts-nicht", headers=auth_headers("s1", "mia@example.corp")
    )
    assert response.status_code == 404
    assert response.json()["code"] == "TOPIC_NOT_FOUND"


async def _audit_rows(app):
    async with app.state.sessionmaker() as session:
        return (await session.execute(select(AuditLog))).scalars().all()


async def test_abo_audit_default_aus(client, app, auth_headers, make_user):
    """AUDIT_SUBSCRIPTIONS=false (Default): keine Verhaltensprotokolle (ADR-017)."""
    await make_user(sub="s1", email="mia@example.corp")
    await client.put("/api/v1/me/subscriptions/kap", headers=auth_headers("s1", "mia@example.corp"))
    assert await _audit_rows(app) == []


async def test_abo_audit_nach_freigabe_schalter(make_app, auth_headers, make_user):
    """Nach B5/B6-Freigabe: ein Konfig-Schalter aktiviert das Abo-Audit (ADR-017)."""
    import httpx

    app_audit = make_app(audit_subscriptions=True)
    await make_user(sub="s1", email="mia@example.corp")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_audit), base_url="http://testserver"
    ) as audit_client:
        await audit_client.put(
            "/api/v1/me/subscriptions/kap", headers=auth_headers("s1", "mia@example.corp")
        )
    audits = await _audit_rows(app_audit)
    assert [a.action for a in audits] == ["subscribe"]
    assert audits[0].actor_email == "mia@example.corp"
    assert audits[0].detail == {"topic_id": "kap"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_audit), base_url="http://testserver"
    ) as audit_client:
        await audit_client.delete(
            "/api/v1/me/subscriptions/kap", headers=auth_headers("s1", "mia@example.corp")
        )
    audits = await _audit_rows(app_audit)
    assert [a.action for a in audits] == ["subscribe", "unsubscribe"]


async def test_delete_unbekanntes_topic_404(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    response = await client.delete(
        "/api/v1/me/subscriptions/gibts-nicht", headers=auth_headers("s1", "mia@example.corp")
    )
    assert response.status_code == 404
    assert response.json()["code"] == "TOPIC_NOT_FOUND"
