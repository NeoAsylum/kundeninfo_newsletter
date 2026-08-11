from sqlalchemy import select

from app.db.models import AuditLog, DispatchRecipient, Subscription

ADMIN = ("sub-admin", "admin1@example.corp")


async def _setup_users(app, make_user):
    """Admin + 2 Abonnenten (kap) + 1 inaktiver Abonnent + 1 ohne Abo."""
    admin = await make_user(sub=ADMIN[0], email=ADMIN[1], name="Petra Admin")
    u1 = await make_user(sub="s1", email="mia@example.corp")
    u2 = await make_user(sub="s2", email="max@example.corp")
    u3 = await make_user(sub="s3", email="inaktiv@example.corp", active=False)
    await make_user(sub="s4", email="ohneabo@example.corp")
    async with app.state.sessionmaker() as session:
        for user in (u1, u2, u3):
            session.add(Subscription(user_id=user.id, topic_id="kap"))
        await session.commit()
    return admin


async def test_admin_endpunkte_fuer_employee_403(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers("s1", "mia@example.corp")  # nur employee
    response = await client.get("/api/v1/admin/topics/kap/recipient-count", headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "NOT_ADMIN"


async def test_recipient_count_abo_topic(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.get("/api/v1/admin/topics/kap/recipient-count", headers=headers)
    assert response.status_code == 200
    assert response.json()["count"] == 2  # Inaktive zählen nicht


async def test_recipient_count_pflicht_topic_alle_aktiven(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.get(
        "/api/v1/admin/topics/zentrale-stoerungen/recipient-count", headers=headers
    )
    assert response.json()["count"] == 4  # alle aktiven User, unabhängig von Abos (ADR-009)


async def test_preview_rendert_echtes_template(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.post(
        "/api/v1/admin/dispatches/preview",
        headers=headers,
        json={
            "topic_id": "kap",
            "severity": "stoerung",
            "title": "Login <b>kaputt</b>",
            "body": "Text",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["subject"] == "[STÖRUNG] KAP Störungsmeldungen: Login <b>kaputt</b>"
    assert "&lt;b&gt;kaputt&lt;/b&gt;" in body["html"]  # HTML-Escaping auch in der Vorschau
    assert "#C0392B" in body["html"]


async def test_versand_anlegen_friert_empfaenger_ein(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.post(
        "/api/v1/admin/dispatches",
        headers=headers,
        json={"topic_id": "kap", "severity": "stoerung", "title": "Titel", "body": "Text"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "pending"
    assert data["recipient_count"] == 2
    assert data["subject"] == "[STÖRUNG] KAP Störungsmeldungen: Titel"

    async with app.state.sessionmaker() as session:
        recipients = (
            (
                await session.execute(
                    select(DispatchRecipient).where(DispatchRecipient.dispatch_id == data["id"])
                )
            )
            .scalars()
            .all()
        )
        audits = (await session.execute(select(AuditLog))).scalars().all()
    emails = sorted(r.email for r in recipients)
    assert emails == ["max@example.corp", "mia@example.corp"]
    assert all(r.status.value == "pending" for r in recipients)
    # Admin-Aktionen werden IMMER auditiert (unabhängig vom Abo-Audit-Schalter)
    assert [a.action for a in audits] == ["dispatch_created"]


async def test_versand_ohne_empfaenger_422(client, app, auth_headers, make_user):
    await make_user(sub=ADMIN[0], email=ADMIN[1])
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.post(
        "/api/v1/admin/dispatches",
        headers=headers,
        json={"topic_id": "lifefactory", "severity": "stoerung", "title": "T", "body": "B"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "NO_RECIPIENTS"


async def test_titel_laenge_validiert(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.post(
        "/api/v1/admin/dispatches",
        headers=headers,
        json={"topic_id": "kap", "severity": "stoerung", "title": "x" * 151, "body": "B"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


async def test_unbekannter_schweregrad_422(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.post(
        "/api/v1/admin/dispatches",
        headers=headers,
        json={"topic_id": "kap", "severity": "katastrophe", "title": "T", "body": "B"},
    )
    assert response.status_code == 422


async def test_historie_und_detail(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    created = (
        await client.post(
            "/api/v1/admin/dispatches",
            headers=headers,
            json={
                "topic_id": "kap",
                "severity": "entwarnung",
                "title": "Behoben",
                "body": "Alles gut",
            },
        )
    ).json()

    listing = (await client.get("/api/v1/admin/dispatches", headers=headers)).json()
    assert len(listing) == 1
    assert listing[0]["topic_name"] == "KAP Störungsmeldungen"
    assert listing[0]["open_count"] == 2

    detail = (await client.get(f"/api/v1/admin/dispatches/{created['id']}", headers=headers)).json()
    assert detail["body"] == "Alles gut"
    assert detail["created_by_email"] == ADMIN[1]

    missing = await client.get("/api/v1/admin/dispatches/99999", headers=headers)
    assert missing.status_code == 404


async def test_admin_unbekanntes_topic_404(client, app, auth_headers, make_user):
    await _setup_users(app, make_user)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])

    res1 = await client.get("/api/v1/admin/topics/gibts-nicht/recipient-count", headers=headers)
    assert res1.status_code == 404
    assert res1.json()["code"] == "TOPIC_NOT_FOUND"

    res2 = await client.post(
        "/api/v1/admin/dispatches/preview",
        headers=headers,
        json={"topic_id": "gibts-nicht", "severity": "stoerung", "title": "T", "body": "B"},
    )
    assert res2.status_code == 404
    assert res2.json()["code"] == "TOPIC_NOT_FOUND"

    res3 = await client.post(
        "/api/v1/admin/dispatches",
        headers=headers,
        json={"topic_id": "gibts-nicht", "severity": "stoerung", "title": "T", "body": "B"},
    )
    assert res3.status_code == 404
    assert res3.json()["code"] == "TOPIC_NOT_FOUND"


async def test_admin_zugriff_endet_mit_deaktiviertem_user(client, app, auth_headers, make_user):
    """Offboarding: Admin-Cookie allein reicht nicht — der DB-User muss
    aktiv sein, sonst 401 SESSION_STALE auch auf Lese-Endpunkten."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], active=False)
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    response = await client.get("/api/v1/admin/topics/kap/recipient-count", headers=headers)
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_STALE"


async def test_betreff_ueberlauf_422_statt_500(client, app, auth_headers, make_user):
    """Präfix + Topic-Name + Titel > 255 → sauberer 422 statt DataError."""
    from sqlalchemy import text

    await _setup_users(app, make_user)
    async with app.state.sessionmaker() as session:
        await session.execute(
            text(
                "INSERT INTO topics (id, name, is_mandatory, is_active) "
                "VALUES ('langname', :name, 0, 1) ON DUPLICATE KEY UPDATE name = :name"
            ),
            {"name": "L" * 120},
        )
        await session.commit()
    headers = auth_headers(*ADMIN, roles=["employee", "admin"])
    try:
        response = await client.post(
            "/api/v1/admin/dispatches/preview",
            headers=headers,
            json={"topic_id": "langname", "severity": "stoerung", "title": "T" * 150, "body": "B"},
        )
        assert response.status_code == 422
        assert response.json()["code"] == "SUBJECT_TOO_LONG"
    finally:
        # Topics überleben clean_db bewusst (Seed) — Testtopic selbst aufräumen
        async with app.state.sessionmaker() as session:
            await session.execute(text("DELETE FROM topics WHERE id = 'langname'"))
            await session.commit()
