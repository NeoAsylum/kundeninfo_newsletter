"""Empfänger-Verwaltung (Admin): browsen, aktivieren/deaktivieren, Abos pflegen."""

from sqlalchemy import select

from app.db.models import AuditLog, Subscription

ADMIN = ("sub-admin", "admin1@example.corp")


async def _setup(app, make_user):
    admin = await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    mia = await make_user(sub="s1", email="mia@example.corp")
    max_ = await make_user(sub="s2", email="max@example.corp")
    inactive = await make_user(sub="s3", email="alt@example.corp", active=False)
    async with app.state.sessionmaker() as session:
        session.add(Subscription(user_id=mia.id, topic_id="kap"))
        session.add(Subscription(user_id=mia.id, topic_id="interflex"))
        await session.commit()
    return admin, mia, max_, inactive


async def _audit_actions(app) -> list[str]:
    async with app.state.sessionmaker() as session:
        return [a.action for a in (await session.execute(select(AuditLog))).scalars()]


async def test_liste_mit_abos_und_status(client, app, auth_headers, make_user):
    await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.get("/api/v1/admin/users", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 4
    by_email = {u["email"]: u for u in data["items"]}
    assert by_email["mia@example.corp"]["subscribed_topic_ids"] == ["interflex", "kap"]
    assert by_email["alt@example.corp"]["is_active"] is False
    # Bewusst KEINE Verhaltensdaten im Payload (B5)
    assert "last_login_at" not in by_email["mia@example.corp"]


async def test_suche_und_paging(client, app, auth_headers, make_user):
    await _setup(app, make_user)
    headers = auth_headers(*ADMIN)

    search = (await client.get("/api/v1/admin/users?query=mia", headers=headers)).json()
    assert search["total"] == 1
    assert search["items"][0]["email"] == "mia@example.corp"

    # Suche ist bewusst E-Mail-only — Namen werden in der Maske nicht angezeigt
    by_name = (await client.get("/api/v1/admin/users?query=Beispiel", headers=headers)).json()
    assert by_name["total"] == 0

    only_active = (await client.get("/api/v1/admin/users?is_active=true", headers=headers)).json()
    assert only_active["total"] == 3  # 'alt@example.corp' ist inaktiv
    assert all(u["is_active"] for u in only_active["items"])

    page = (await client.get("/api/v1/admin/users?limit=2&offset=2", headers=headers)).json()
    assert page["total"] == 4
    assert len(page["items"]) == 2


async def test_employee_hat_keinen_zugriff(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    response = await client.get(
        "/api/v1/admin/users", headers=auth_headers("s1", "mia@example.corp")
    )
    assert response.status_code == 403


async def test_deaktivieren_entfernt_aus_empfaengerauflloesung(
    client, app, auth_headers, make_user
):
    _, mia, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)

    before = (
        await client.get(
            "/api/v1/admin/topics/zentrale-stoerungen/recipient-count", headers=headers
        )
    ).json()["count"]

    response = await client.patch(
        f"/api/v1/admin/users/{mia.id}", headers=headers, json={"is_active": False}
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    after = (
        await client.get(
            "/api/v1/admin/topics/zentrale-stoerungen/recipient-count", headers=headers
        )
    ).json()["count"]
    assert after == before - 1
    assert "user_deactivated" in await _audit_actions(app)


async def test_patch_ohne_aenderung_kein_audit(client, app, auth_headers, make_user):
    _, mia, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.patch(
        f"/api/v1/admin/users/{mia.id}", headers=headers, json={"is_active": True}
    )
    assert response.status_code == 200
    assert await _audit_actions(app) == []  # idempotent, nichts passiert


async def test_selbst_deaktivieren_409(client, app, auth_headers, make_user):
    admin, _, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.patch(
        f"/api/v1/admin/users/{admin.id}", headers=headers, json={"is_active": False}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "CANNOT_DEACTIVATE_SELF"


async def test_unbekannter_user_404(client, app, auth_headers, make_user):
    await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.patch(
        "/api/v1/admin/users/99999", headers=headers, json={"is_active": False}
    )
    assert response.status_code == 404
    assert response.json()["code"] == "USER_NOT_FOUND"


async def test_admin_abo_pflege_mit_audit(client, app, auth_headers, make_user):
    _, _, max_, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)

    put = await client.put(f"/api/v1/admin/users/{max_.id}/subscriptions/kap", headers=headers)
    assert put.status_code == 204
    put_again = await client.put(
        f"/api/v1/admin/users/{max_.id}/subscriptions/kap", headers=headers
    )
    assert put_again.status_code == 204  # idempotent

    delete = await client.delete(
        f"/api/v1/admin/users/{max_.id}/subscriptions/kap", headers=headers
    )
    assert delete.status_code == 204
    delete_again = await client.delete(
        f"/api/v1/admin/users/{max_.id}/subscriptions/kap", headers=headers
    )
    assert delete_again.status_code == 204

    # Admin-Fremdänderungen werden auditiert (unabhängig vom AUDIT_SUBSCRIPTIONS-
    # Schalter, ADR-0017) — aber nur ECHTE Änderungen: idempotente Wiederholungen
    # erzeugen keine Einträge, das Log soll keine Eingriffe erfinden
    actions = await _audit_actions(app)
    assert actions.count("admin_subscribe") == 1
    assert actions.count("admin_unsubscribe") == 1


async def test_admin_abo_pflicht_topic_409(client, app, auth_headers, make_user):
    _, mia, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.put(
        f"/api/v1/admin/users/{mia.id}/subscriptions/zentrale-stoerungen", headers=headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "TOPIC_MANDATORY"


async def test_admin_abo_unbekanntes_topic_404(client, app, auth_headers, make_user):
    _, mia, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.put(
        f"/api/v1/admin/users/{mia.id}/subscriptions/gibts-nicht", headers=headers
    )
    assert response.status_code == 404


async def test_reaktivieren_mit_audit(client, app, auth_headers, make_user):
    _, _, _, inactive = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.patch(
        f"/api/v1/admin/users/{inactive.id}", headers=headers, json={"is_active": True}
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert "user_activated" in await _audit_actions(app)


async def test_admin_abo_delete_pflicht_topic_409(client, app, auth_headers, make_user):
    _, mia, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.delete(
        f"/api/v1/admin/users/{mia.id}/subscriptions/zentrale-stoerungen", headers=headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "TOPIC_MANDATORY"


async def test_admin_abo_unbekannter_user_404(client, app, auth_headers, make_user):
    await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    response = await client.put("/api/v1/admin/users/99999/subscriptions/kap", headers=headers)
    assert response.status_code == 404
    assert response.json()["code"] == "USER_NOT_FOUND"


async def test_unauthentifiziert_401(client):
    response = await client.get("/api/v1/admin/users")
    assert response.status_code == 401


async def test_suche_escaped_like_wildcards(client, app, auth_headers, make_user):
    """'_'/'%' aus der Suche matchen wörtlich, nicht als Wildcard."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    await make_user(sub="s1", email="vorname_nachname@example.corp")
    await make_user(sub="s2", email="vornameXnachname@example.corp")
    headers = auth_headers(*ADMIN)

    underscore = (
        await client.get("/api/v1/admin/users?query=vorname_nach", headers=headers)
    ).json()
    assert underscore["total"] == 1  # ohne Escaping würde '_' auch das 'X' matchen
    assert underscore["items"][0]["email"] == "vorname_nachname@example.corp"

    percent = (await client.get("/api/v1/admin/users?query=%25", headers=headers)).json()
    assert percent["total"] == 0  # '%' wörtlich — matcht nicht alles


async def test_abo_auf_deaktiviertem_topic_aufraeumbar(client, app, auth_headers, make_user):
    """Anzeige/Pflege-Symmetrie: Abos auf inzwischen deaktivierte
    Topics bleiben sichtbar UND entfernbar."""
    from sqlalchemy import text

    _, mia, _, _ = await _setup(app, make_user)
    headers = auth_headers(*ADMIN)
    async with app.state.sessionmaker() as session:
        await session.execute(text("UPDATE topics SET is_active = 0 WHERE id = 'kap'"))
        await session.commit()
    try:
        listed = (await client.get("/api/v1/admin/users?query=mia", headers=headers)).json()
        assert "kap" in listed["items"][0]["subscribed_topic_ids"]  # sichtbar

        response = await client.delete(
            f"/api/v1/admin/users/{mia.id}/subscriptions/kap", headers=headers
        )
        assert response.status_code == 204  # aufräumbar trotz inaktivem Topic

        relisted = (await client.get("/api/v1/admin/users?query=mia", headers=headers)).json()
        assert "kap" not in relisted["items"][0]["subscribed_topic_ids"]
    finally:
        async with app.state.sessionmaker() as session:
            await session.execute(text("UPDATE topics SET is_active = 1 WHERE id = 'kap'"))
            await session.commit()
