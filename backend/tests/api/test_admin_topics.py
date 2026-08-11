"""Verteiler-Verwaltung (Admin-CRUD, ADR-0024) — löst die RUNBOOK-SQL-Pflege ab.

`topics` überlebt clean_db bewusst (Seed aus Migration 0002 ist Fixture vieler Tests),
deshalb räumt hier jeder Test seine Spuren im finally selbst weg: Testverteiler löschen,
verändertes Seed-Topic zurückstellen. Sonst brechen fremde Testdateien
reihenfolgeabhängig.
"""

from sqlalchemy import func, select, text

from app.db.models import AuditLog, Subscription

ADMIN = ("sub-admin", "admin1@example.corp")
SLUG = "test-verteiler"
NAME = "Test Verteiler"
BESCHREIBUNG = "Beschreibung A"


async def _anlegen(client, headers, **overrides):
    payload = {"id": SLUG, "name": NAME, "description": BESCHREIBUNG} | overrides
    return await client.post("/api/v1/admin/topics", headers=headers, json=payload)


async def _liste(client, headers) -> dict:
    response = await client.get("/api/v1/admin/topics", headers=headers)
    assert response.status_code == 200
    return {t["id"]: t for t in response.json()}


async def _empfaengerzahl(client, headers, topic_id: str) -> int:
    response = await client.get(f"/api/v1/admin/topics/{topic_id}/recipient-count", headers=headers)
    assert response.status_code == 200
    return response.json()["count"]


async def _versand_anlegen(app, topic_id: str, user_id: int, status: str) -> None:
    """Historie ohne API-Weg: POST /dispatches bräuchte auflösbare Empfänger, hier zählt
    nur die Zeile in dispatches (sie blockiert Löschen bzw. Umbenennen)."""
    async with app.state.sessionmaker() as session:
        await session.execute(
            text(
                "INSERT INTO dispatches (topic_id, severity, subject, body, status, "
                "recipient_count, created_by_user_id) "
                "VALUES (:topic_id, 'stoerung', :subject, 'Text', :status, 1, :user_id)"
            ),
            {
                "topic_id": topic_id,
                "subject": f"[STÖRUNG] {topic_id}: Test",
                "status": status,
                "user_id": user_id,
            },
        )
        await session.commit()


async def _abo_anzahl(app, topic_id: str) -> int:
    async with app.state.sessionmaker() as session:
        return (
            await session.execute(
                select(func.count())
                .select_from(Subscription)
                .where(Subscription.topic_id == topic_id)
            )
        ).scalar_one()


async def _audit(app) -> list[AuditLog]:
    async with app.state.sessionmaker() as session:
        return list((await session.execute(select(AuditLog).order_by(AuditLog.id))).scalars())


async def _audit_aktionen(app) -> list[str]:
    return [eintrag.action for eintrag in await _audit(app)]


async def _aufraeumen(app, *topic_ids: str) -> None:
    """Reihenfolge ist zwingend: dispatches hängt mit RESTRICT am Verteiler."""
    async with app.state.sessionmaker() as session:
        for topic_id in topic_ids:
            for statement in (
                "DELETE FROM subscriptions WHERE topic_id = :id",
                "DELETE FROM dispatches WHERE topic_id = :id",
                "DELETE FROM topics WHERE id = :id",
            ):
                await session.execute(text(statement), {"id": topic_id})
        await session.commit()


async def test_liste_zeigt_zaehler_und_auch_inaktive_verteiler(
    client, app, auth_headers, make_user
):
    """Zwei Sichten auf denselben Bestand: die Adminmaske braucht die deaktivierten
    Verteiler zum Reaktivieren, die Abo-Maske darf sie nicht mehr anbieten."""
    admin = await make_user(sub=ADMIN[0], email=ADMIN[1], name="Petra Admin", admin=True)
    mia = await make_user(sub="s1", email="mia@example.corp")
    async with app.state.sessionmaker() as session:
        session.add(Subscription(user_id=mia.id, topic_id="kap"))
        await session.commit()
    await _versand_anlegen(app, "kap", admin.id, "completed")
    headers = auth_headers(*ADMIN)
    async with app.state.sessionmaker() as session:
        await session.execute(text("UPDATE topics SET is_active = 0 WHERE id = 'kap'"))
        await session.commit()
    try:
        response = await client.get("/api/v1/admin/topics", headers=headers)
        assert response.status_code == 200
        liste = response.json()
        assert len(liste) == 5  # Seed aus Migration 0002
        nach_id = {t["id"]: t for t in liste}
        assert nach_id["kap"]["is_active"] is False
        assert nach_id["kap"]["subscriber_count"] == 1
        assert nach_id["kap"]["dispatch_count"] == 1
        assert nach_id["kap"]["has_open_dispatch"] is False  # 'completed' ist abgeschlossen
        assert nach_id["zentrale-stoerungen"]["is_mandatory"] is True
        assert nach_id["lifefactory"]["subscriber_count"] == 0
        # Sortierung: aktive zuerst, darin Pflicht zuerst — Inaktive fallen ans Ende
        assert liste[0]["id"] == "zentrale-stoerungen"
        assert liste[-1]["id"] == "kap"

        selbstbedienung = await client.get("/api/v1/topics", headers=headers)
        sichtbar = [t["id"] for t in selbstbedienung.json()]
        assert len(sichtbar) == 4
        assert "kap" not in sichtbar
    finally:
        async with app.state.sessionmaker() as session:
            await session.execute(text("UPDATE topics SET is_active = 1 WHERE id = 'kap'"))
            await session.execute(text("DELETE FROM dispatches WHERE topic_id = 'kap'"))
            await session.commit()


async def test_anlegen_erscheint_ohne_zaehler_in_der_liste(client, app, auth_headers, make_user):
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        response = await _anlegen(client, headers)
        assert response.status_code == 201
        angelegt = response.json()
        assert angelegt["id"] == SLUG
        assert angelegt["name"] == NAME
        assert angelegt["description"] == BESCHREIBUNG
        assert angelegt["is_active"] is True
        assert angelegt["is_mandatory"] is False
        assert angelegt["subscriber_count"] == 0
        assert angelegt["dispatch_count"] == 0
        assert angelegt["has_open_dispatch"] is False

        nach_id = await _liste(client, headers)
        assert nach_id[SLUG]["name"] == NAME
        assert "topic_created" in await _audit_aktionen(app)
    finally:
        await _aufraeumen(app, SLUG)


async def test_doppelter_slug_und_doppelter_name_409(client, app, auth_headers, make_user):
    """Der Slug ist eindeutig, weil er Primärschlüssel ist; der Name ist es nur durch
    diese Prüfung — zwei gleichnamige Verteiler machen jede Auswahlliste mehrdeutig."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201

        gleicher_slug = await _anlegen(client, headers, name="Ganz anderer Name")
        assert gleicher_slug.status_code == 409
        assert gleicher_slug.json()["code"] == "TOPIC_EXISTS"

        gleicher_name = await _anlegen(client, headers, id="test-verteiler-zwei")
        assert gleicher_name.status_code == 409
        assert gleicher_name.json()["code"] == "TOPIC_NAME_EXISTS"

        seed_name = await _anlegen(
            client, headers, id="test-verteiler-drei", name="KAP Störungsmeldungen"
        )
        assert seed_name.status_code == 409
        assert seed_name.json()["code"] == "TOPIC_NAME_EXISTS"
    finally:
        await _aufraeumen(app, SLUG, "test-verteiler-zwei", "test-verteiler-drei")


async def test_ungueltige_slugs_422(client, app, auth_headers, make_user):
    """Der Slug steht in URLs und Fremdschlüsseln und ist nachträglich nicht änderbar —
    deshalb hält das Muster ihn schon bei der Anlage klein, ASCII und ohne Leerzeichen."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    ungueltig = (
        "Test-Verteiler",  # Großbuchstaben
        "test verteiler",  # Leerzeichen
        "stoerungen-sued-ost-süd",  # Umlaut
        "-test-verteiler",  # führender Bindestrich
        "t",  # ein einzelnes Zeichen
        "t" * 65,  # länger als topics.id (VARCHAR(64))
    )
    try:
        for slug in ungueltig:
            response = await _anlegen(client, headers, id=slug, name=f"Name zu {slug}")
            assert response.status_code == 422, slug
            assert response.json()["code"] == "VALIDATION_ERROR", slug
        nach_id = await _liste(client, headers)
        assert len(nach_id) == 5  # nichts davon ist durchgekommen
    finally:
        # Der Überlang-Slug kann in topics.id gar nicht stehen — nur die Kandidaten
        # aufräumen, die die Spalte fassen könnte
        await _aufraeumen(app, *[slug for slug in ungueltig if len(slug) <= 64])


async def test_patch_aendert_nur_gesendete_felder(client, app, auth_headers, make_user):
    """exclude_unset: ein Teil-Update (nur der Status-Schalter) darf die Beschreibung
    nicht leeren, bloß weil das Formular das Feld nicht mitgeschickt hat."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201

        umbenannt = await client.patch(
            f"/api/v1/admin/topics/{SLUG}",
            headers=headers,
            json={"name": "Test Verteiler neu", "description": "Beschreibung B"},
        )
        assert umbenannt.status_code == 200
        assert umbenannt.json()["name"] == "Test Verteiler neu"
        assert umbenannt.json()["description"] == "Beschreibung B"

        deaktiviert = await client.patch(
            f"/api/v1/admin/topics/{SLUG}", headers=headers, json={"is_active": False}
        )
        assert deaktiviert.status_code == 200
        assert deaktiviert.json()["is_active"] is False
        assert deaktiviert.json()["name"] == "Test Verteiler neu"
        assert deaktiviert.json()["description"] == "Beschreibung B"
    finally:
        await _aufraeumen(app, SLUG)


async def test_patch_ohne_echte_aenderung_kein_audit(client, app, auth_headers, make_user):
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        response = await client.patch(
            f"/api/v1/admin/topics/{SLUG}",
            headers=headers,
            json={"name": NAME, "description": BESCHREIBUNG, "is_active": True},
        )
        assert response.status_code == 200
        # Das Log soll keine Eingriffe erfinden — nur die Anlage steht drin
        assert await _audit_aktionen(app) == ["topic_created"]
    finally:
        await _aufraeumen(app, SLUG)


async def test_audit_aktionen_der_verteilerpflege(client, app, auth_headers, make_user):
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        geaendert = await client.patch(
            f"/api/v1/admin/topics/{SLUG}", headers=headers, json={"is_mandatory": True}
        )
        assert geaendert.status_code == 200
        geloescht = await client.delete(f"/api/v1/admin/topics/{SLUG}", headers=headers)
        assert geloescht.status_code == 204

        eintraege = await _audit(app)
        assert [e.action for e in eintraege] == ["topic_created", "topic_updated", "topic_deleted"]
        assert all(e.actor_email == ADMIN[1] for e in eintraege)
        assert eintraege[1].detail == {"topic_id": SLUG, "geaendert": {"is_mandatory": True}}
    finally:
        await _aufraeumen(app, SLUG)


async def test_loeschen_ohne_historie_nimmt_abos_mit(client, app, auth_headers, make_user):
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    mia = await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        abo = await client.put(
            f"/api/v1/admin/users/{mia.id}/subscriptions/{SLUG}", headers=headers
        )
        assert abo.status_code == 204
        assert await _abo_anzahl(app, SLUG) == 1

        response = await client.delete(f"/api/v1/admin/topics/{SLUG}", headers=headers)
        assert response.status_code == 204
        assert SLUG not in await _liste(client, headers)
        # CASCADE auf subscriptions: keine Abo-Waisen mit unbekanntem Verteiler
        assert await _abo_anzahl(app, SLUG) == 0
    finally:
        await _aufraeumen(app, SLUG)


async def test_loesch_audit_haelt_verlorene_abos_fest(client, app, auth_headers, make_user):
    """Die Abos gehen per CASCADE mit — ihre Zahl ist danach nur noch im Log belegbar."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    mia = await make_user(sub="s1", email="mia@example.corp")
    max_ = await make_user(sub="s2", email="max@example.corp")
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        for user in (mia, max_):
            abo = await client.put(
                f"/api/v1/admin/users/{user.id}/subscriptions/{SLUG}", headers=headers
            )
            assert abo.status_code == 204

        response = await client.delete(f"/api/v1/admin/topics/{SLUG}", headers=headers)
        assert response.status_code == 204
        loeschungen = [e for e in await _audit(app) if e.action == "topic_deleted"]
        assert len(loeschungen) == 1
        assert loeschungen[0].detail == {
            "topic_id": SLUG,
            "name": NAME,
            "verlorene_abos": 2,
        }
    finally:
        await _aufraeumen(app, SLUG)


async def test_verteiler_mit_historie_nicht_loeschbar(client, app, auth_headers, make_user):
    admin = await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        await _versand_anlegen(app, SLUG, admin.id, "completed")

        response = await client.delete(f"/api/v1/admin/topics/{SLUG}", headers=headers)
        assert response.status_code == 409
        assert response.json()["code"] == "TOPIC_IN_USE"

        nach_id = await _liste(client, headers)
        assert nach_id[SLUG]["dispatch_count"] == 1  # Historie bleibt unveränderlich
        assert "topic_deleted" not in await _audit_aktionen(app)
    finally:
        await _aufraeumen(app, SLUG)


async def test_umbenennen_mit_laufendem_versand_blockiert(client, app, auth_headers, make_user):
    """Der Worker schneidet den Titel zur Sendezeit per Textsuche nach dem AKTUELLEN
    Verteilernamen aus dem eingefrorenen Betreff — ein Rename mitten im Versand
    verfälscht die Mails an bis zu 5.000 Empfänger."""
    admin = await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        await _versand_anlegen(app, SLUG, admin.id, "pending")

        blockiert = await client.patch(
            f"/api/v1/admin/topics/{SLUG}", headers=headers, json={"name": "Anderer Name"}
        )
        assert blockiert.status_code == 409
        assert blockiert.json()["code"] == "TOPIC_RENAME_BLOCKED"

        # Unveränderter Name ist kein Rename: die Beschreibung bleibt pflegbar
        erlaubt = await client.patch(
            f"/api/v1/admin/topics/{SLUG}",
            headers=headers,
            json={"name": NAME, "description": "Beschreibung B"},
        )
        assert erlaubt.status_code == 200
        assert erlaubt.json()["description"] == "Beschreibung B"
        assert erlaubt.json()["has_open_dispatch"] is True
    finally:
        await _aufraeumen(app, SLUG)


async def test_unbekannter_verteiler_404(client, app, auth_headers, make_user):
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)

    patch = await client.patch(
        "/api/v1/admin/topics/gibts-nicht", headers=headers, json={"name": "Egal wie"}
    )
    assert patch.status_code == 404
    assert patch.json()["code"] == "TOPIC_NOT_FOUND"

    delete = await client.delete("/api/v1/admin/topics/gibts-nicht", headers=headers)
    assert delete.status_code == 404
    assert delete.json()["code"] == "TOPIC_NOT_FOUND"


async def test_employee_hat_keinen_zugriff_auf_verteilerpflege(
    client, app, auth_headers, make_user
):
    """Die API ist die Sicherheitsgrenze — nicht die ausgeblendete Navigation. Die
    Prüfung hängt am Router, greift also vor jeder Arbeit (403 statt 404)."""
    await make_user(sub="s1", email="mia@example.corp")  # kein Portal-Kennzeichen
    headers = auth_headers("s1", "mia@example.corp")  # nur employee
    rufe = (
        ("get", "/api/v1/admin/topics", None),
        ("post", "/api/v1/admin/topics", {"id": SLUG, "name": NAME}),
        ("patch", "/api/v1/admin/topics/gibts-nicht", {"name": "Egal wie"}),
        ("delete", "/api/v1/admin/topics/gibts-nicht", None),
    )
    try:
        for methode, pfad, payload in rufe:
            extra = {"json": payload} if payload is not None else {}
            response = await getattr(client, methode)(pfad, headers=headers, **extra)
            assert response.status_code == 403, pfad
            assert response.json()["code"] == "NOT_ADMIN", pfad
    finally:
        await _aufraeumen(app, SLUG)


async def test_nur_das_db_kennzeichen_darf_verteiler_pflegen(client, app, auth_headers, make_user):
    """ADR-0022/0024: Die Verteilerpflege hängt am Portal-Kennzeichen, nicht an einer Rolle im
    Cookie — sonst könnte jemand mit einem alten Cookie Stammdaten ändern, obwohl ihm das
    Recht in der Oberfläche längst entzogen wurde."""
    await make_user(sub="s1", email="nur-cookie@example.corp")  # Rolle nur im Cookie
    await make_user(sub="s2", email="kennzeichen@example.corp", admin=True)  # in der DB
    per_cookie = auth_headers("s1", "nur-cookie@example.corp", roles=["employee", "admin"])
    per_kennzeichen = auth_headers("s2", "kennzeichen@example.corp")  # nur employee im Cookie
    try:
        gesperrt = await client.get("/api/v1/admin/topics", headers=per_cookie)
        assert gesperrt.status_code == 403
        assert gesperrt.json()["code"] == "NOT_ADMIN"
        assert (await _anlegen(client, per_cookie)).status_code == 403

        aus_der_db = await client.get("/api/v1/admin/topics", headers=per_kennzeichen)
        assert aus_der_db.status_code == 200
        assert (await _anlegen(client, per_kennzeichen)).status_code == 201
    finally:
        await _aufraeumen(app, SLUG)


async def test_pflicht_umschalten_laesst_abozeilen_liegen(client, app, auth_headers, make_user):
    """ADR-0009 verwirft das Abo-Aufräumen beim Umschalten: Pflicht-Verteiler ignorieren
    die Abo-Tabelle zur Laufzeit, deshalb muss ein Zurückschalten die alten Abos
    unverändert wiederfinden."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    mia = await make_user(sub="s1", email="mia@example.corp")
    await make_user(sub="s2", email="max@example.corp")
    await make_user(sub="s3", email="alt@example.corp", active=False)
    headers = auth_headers(*ADMIN)
    try:
        assert (await _anlegen(client, headers)).status_code == 201
        abo = await client.put(
            f"/api/v1/admin/users/{mia.id}/subscriptions/{SLUG}", headers=headers
        )
        assert abo.status_code == 204
        assert await _empfaengerzahl(client, headers, SLUG) == 1

        zu_pflicht = await client.patch(
            f"/api/v1/admin/topics/{SLUG}", headers=headers, json={"is_mandatory": True}
        )
        assert zu_pflicht.status_code == 200
        assert zu_pflicht.json()["is_mandatory"] is True
        assert zu_pflicht.json()["subscriber_count"] == 1  # Abozeile bleibt liegen
        assert await _abo_anzahl(app, SLUG) == 1
        # Pflicht heißt "alle aktiven" — die drei aktiven Nutzer, ohne den inaktiven
        assert await _empfaengerzahl(client, headers, SLUG) == 3

        zurueck = await client.patch(
            f"/api/v1/admin/topics/{SLUG}", headers=headers, json={"is_mandatory": False}
        )
        assert zurueck.status_code == 200
        assert zurueck.json()["is_mandatory"] is False
        assert await _empfaengerzahl(client, headers, SLUG) == 1  # altes Abo greift wieder
    finally:
        await _aufraeumen(app, SLUG)
