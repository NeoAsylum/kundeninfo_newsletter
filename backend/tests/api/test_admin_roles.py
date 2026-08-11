"""Rollenvergabe im Portal (ADR-0022): Vergabe/Entzug von users.is_admin und die
daraus folgende, bei JEDER Anfrage gegen die Datenbank geprüfte Autorisierung.

Der Kern dieser Datei ist die ODER-Verknüpfung aus `deps.is_admin`: IdP-Rolle im Cookie
und Portal-Kennzeichen in der DB autorisieren jeweils für sich allein. Die Tests setzen
deshalb bewusst nur EINE der beiden Quellen — ein Cookie mit ["employee"] beweist, dass
der DB-Weg trägt, und ein Cookie mit ["employee", "admin"] ohne DB-Kennzeichen beweist,
dass der IdP-Weg nicht kaputtgegangen ist.
"""

from sqlalchemy import select

from app.core.security import Identity
from app.db.models import AuditLog, Subscription, User
from app.domain.users import jit_upsert
from tests.conftest import make_settings

ADMIN = ("sub-admin", "admin1@example.corp")
# Cookie ohne Adminrolle: die Autorisierung kann dann nur aus der DB kommen
NUR_EMPLOYEE = ["employee"]


async def _handelnder_admin(make_user) -> User:
    """Admin ausschließlich per Portal-Kennzeichen — so hilft die IdP-Rolle in den
    Vergabe-Tests nirgends mit, und der DB-Weg wird nebenbei mitgeprüft."""
    return await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)


async def _audit(app) -> list[AuditLog]:
    async with app.state.sessionmaker() as session:
        return list((await session.execute(select(AuditLog).order_by(AuditLog.id))).scalars())


async def _audit_actions(app) -> list[str]:
    return [eintrag.action for eintrag in await _audit(app)]


async def _kennzeichen(app, user_id: int) -> bool:
    """Frisch aus der DB gelesen — der Response allein belegt noch kein Commit."""
    async with app.state.sessionmaker() as session:
        return bool(
            (await session.execute(select(User.is_admin).where(User.id == user_id))).scalar_one()
        )


async def test_vergabe_setzt_kennzeichen(client, app, auth_headers, make_user):
    await _handelnder_admin(make_user)
    mia = await make_user(sub="s1", email="mia@example.corp")
    async with app.state.sessionmaker() as session:
        session.add(Subscription(user_id=mia.id, topic_id="kap"))
        await session.commit()

    response = await client.put(
        f"/api/v1/admin/users/{mia.id}/admin", headers=auth_headers(*ADMIN, roles=NUR_EMPLOYEE)
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_admin"] is True
    assert data["id"] == mia.id
    assert data["email"] == "mia@example.corp"
    assert data["is_active"] is True
    # Der Response ist der VOLLE AdminUserOut, nicht nur das geänderte Flag — die
    # Maske aktualisiert damit ihre Zeile, ohne die Liste neu zu laden
    assert data["subscribed_topic_ids"] == ["kap"]
    assert await _kennzeichen(app, mia.id) is True


async def test_entzug_setzt_kennzeichen_zurueck(client, app, auth_headers, make_user):
    await _handelnder_admin(make_user)
    mia = await make_user(sub="s1", email="mia@example.corp", admin=True)

    response = await client.delete(
        f"/api/v1/admin/users/{mia.id}/admin", headers=auth_headers(*ADMIN, roles=NUR_EMPLOYEE)
    )
    assert response.status_code == 200
    assert response.json()["is_admin"] is False
    assert await _kennzeichen(app, mia.id) is False


async def test_vergabe_und_entzug_idempotent_ohne_zweites_audit(
    client, app, auth_headers, make_user
):
    """Kein Audit ohne echte Änderung: das Log soll keine Eingriffe erfinden, die
    niemand vorgenommen hat."""
    await _handelnder_admin(make_user)
    mia = await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers(*ADMIN, roles=NUR_EMPLOYEE)

    for _ in range(2):
        response = await client.put(f"/api/v1/admin/users/{mia.id}/admin", headers=headers)
        assert response.status_code == 200
        assert response.json()["is_admin"] is True
    assert (await _audit_actions(app)).count("admin_granted") == 1

    for _ in range(2):
        response = await client.delete(f"/api/v1/admin/users/{mia.id}/admin", headers=headers)
        assert response.status_code == 200
        assert response.json()["is_admin"] is False
    actions = await _audit_actions(app)
    assert actions.count("admin_revoked") == 1
    assert actions.count("admin_granted") == 1  # der Entzug hat nichts nachgeschrieben


async def test_audit_nennt_aktion_und_handelnden_admin(client, app, auth_headers, make_user):
    await _handelnder_admin(make_user)
    mia = await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers(*ADMIN, roles=NUR_EMPLOYEE)
    await client.put(f"/api/v1/admin/users/{mia.id}/admin", headers=headers)
    await client.delete(f"/api/v1/admin/users/{mia.id}/admin", headers=headers)

    eintraege = await _audit(app)
    assert [eintrag.action for eintrag in eintraege] == ["admin_granted", "admin_revoked"]
    for eintrag in eintraege:
        # Wer Rechte vergibt, muss nachvollziehbar sein (ADR-0017)
        assert eintrag.actor_email == ADMIN[1]
        assert eintrag.detail["user_id"] == mia.id
        assert eintrag.detail["email"] == "mia@example.corp"


async def test_selbstentzug_409(client, app, auth_headers, make_user):
    """Aussperr-Schutz: wer entziehen darf, ist selbst Admin und bleibt es — damit ist
    nach jedem erlaubten Entzug mindestens ein Admin übrig."""
    admin = await _handelnder_admin(make_user)
    headers = auth_headers(*ADMIN, roles=NUR_EMPLOYEE)

    response = await client.delete(f"/api/v1/admin/users/{admin.id}/admin", headers=headers)
    assert response.status_code == 409
    assert response.json()["code"] == "CANNOT_REVOKE_OWN_ADMIN"
    assert await _kennzeichen(app, admin.id) is True
    assert await _audit_actions(app) == []

    weiter = await client.get("/api/v1/admin/users", headers=headers)
    assert weiter.status_code == 200  # Zugriff besteht unverändert


async def test_vergabe_an_deaktivierten_empfaenger_409(client, app, auth_headers, make_user):
    """Das Recht hätte keine Wirkung — die Anmeldung endet vorher mit SESSION_STALE."""
    await _handelnder_admin(make_user)
    alt = await make_user(sub="s3", email="alt@example.corp", active=False)

    response = await client.put(
        f"/api/v1/admin/users/{alt.id}/admin", headers=auth_headers(*ADMIN, roles=NUR_EMPLOYEE)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "USER_INACTIVE"
    assert await _kennzeichen(app, alt.id) is False
    assert await _audit_actions(app) == []


async def test_unbekannter_empfaenger_404(client, app, auth_headers, make_user):
    await _handelnder_admin(make_user)
    headers = auth_headers(*ADMIN, roles=NUR_EMPLOYEE)
    for methode in (client.put, client.delete):
        response = await methode("/api/v1/admin/users/99999/admin", headers=headers)
        assert response.status_code == 404
        assert response.json()["code"] == "USER_NOT_FOUND"


async def test_mitarbeiter_darf_keine_rollen_vergeben(client, app, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    max_ = await make_user(sub="s2", email="max@example.corp")
    headers = auth_headers("s1", "mia@example.corp", roles=NUR_EMPLOYEE)

    for methode in (client.put, client.delete):
        response = await methode(f"/api/v1/admin/users/{max_.id}/admin", headers=headers)
        assert response.status_code == 403
        assert response.json()["code"] == "NOT_ADMIN"
    assert await _kennzeichen(app, max_.id) is False


async def test_nur_das_db_kennzeichen_autorisiert(client, auth_headers, make_user):
    """Die Datenbank ist die einzige Quelle (ADR-0022). Der zweite Teil ist der
    sicherheitsrelevante: Eine Rolle „admin" im Session-Cookie autorisiert NICHT — sonst
    gäbe es eine Berechtigung, die die Rollen-Maske nicht entziehen kann und die bis zum
    Cookie-Ablauf weiterlebt.
    """
    await make_user(sub="s-db", email="db-admin@example.corp", admin=True)
    await make_user(sub="s-cookie", email="cookie-admin@example.corp", admin=False)

    nur_db = await client.get(
        "/api/v1/admin/users",
        headers=auth_headers("s-db", "db-admin@example.corp", roles=NUR_EMPLOYEE),
    )
    assert nur_db.status_code == 200

    nur_cookie = await client.get(
        "/api/v1/admin/users",
        headers=auth_headers("s-cookie", "cookie-admin@example.corp", roles=["employee", "admin"]),
    )
    assert nur_cookie.status_code == 403
    assert nur_cookie.json()["code"] == "NOT_ADMIN"


async def test_entzug_wirkt_ohne_neuanmeldung(client, auth_headers, make_user):
    """Der fachliche Gewinn gegenüber dem Cookie-Ansatz: DASSELBE Cookie verliert den
    Zugriff sofort, die betroffene Person muss sich nicht erst neu anmelden."""
    await _handelnder_admin(make_user)
    zweiter = await make_user(sub="s1", email="zweit-admin@example.corp", admin=True)
    zweiter_headers = auth_headers("s1", "zweit-admin@example.corp", roles=NUR_EMPLOYEE)

    vorher = await client.get("/api/v1/admin/users", headers=zweiter_headers)
    assert vorher.status_code == 200

    entzug = await client.delete(
        f"/api/v1/admin/users/{zweiter.id}/admin",
        headers=auth_headers(*ADMIN, roles=NUR_EMPLOYEE),
    )
    assert entzug.status_code == 200

    nachher = await client.get("/api/v1/admin/users", headers=zweiter_headers)
    assert nachher.status_code == 403
    assert nachher.json()["code"] == "NOT_ADMIN"


async def test_deaktivierter_admin_bekommt_session_stale_statt_403(client, auth_headers, make_user):
    """Präzedenz: get_current_user läuft vor der Rollenprüfung, damit Offboarding
    „Bitte neu anmelden“ meldet und nicht „Keine Berechtigung“ — sonst schickt die
    Fehlermeldung die Person zum Admin statt zum Login."""
    await make_user(sub="s-db", email="db-admin@example.corp", active=False, admin=True)
    await make_user(sub="s-off", email="offboard@example.corp", active=False, admin=False)

    for sub, email in (("s-db", "db-admin@example.corp"), ("s-off", "offboard@example.corp")):
        response = await client.get(
            "/api/v1/admin/users", headers=auth_headers(sub, email, roles=NUR_EMPLOYEE)
        )
        assert response.status_code == 401
        assert response.json()["code"] == "SESSION_STALE"


async def test_me_liefert_wirksame_rollen(client, auth_headers, make_user):
    """Das Frontend blendet seine Admin-Navigation an /me auf; ein im Portal vergebenes
    Recht steht nicht im Cookie und bliebe ohne diesen Abgleich unsichtbar."""
    await make_user(sub="s-db", email="db-admin@example.corp", admin=True)
    await make_user(sub="s-mia", email="mia@example.corp")
    await make_user(sub="s-beides", email="beides@example.corp", admin=True)

    db_admin = await client.get(
        "/api/v1/me", headers=auth_headers("s-db", "db-admin@example.corp", roles=["employee"])
    )
    assert db_admin.status_code == 200
    assert "admin" in db_admin.json()["roles"]

    mitarbeiter = await client.get(
        "/api/v1/me", headers=auth_headers("s-mia", "mia@example.corp", roles=["employee"])
    )
    assert mitarbeiter.json()["roles"] == ["employee"]

    beides = await client.get(
        "/api/v1/me",
        headers=auth_headers("s-beides", "beides@example.corp", roles=["employee", "admin"]),
    )
    assert beides.json()["roles"] == ["employee", "admin"]  # kein doppeltes "admin"


async def test_liste_zeigt_kennzeichen(client, auth_headers, make_user):
    await _handelnder_admin(make_user)
    mia = await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers(*ADMIN, roles=NUR_EMPLOYEE)

    vorher = (await client.get("/api/v1/admin/users", headers=headers)).json()
    by_email = {u["email"]: u for u in vorher["items"]}
    assert by_email[ADMIN[1]]["is_admin"] is True
    assert by_email["mia@example.corp"]["is_admin"] is False

    await client.put(f"/api/v1/admin/users/{mia.id}/admin", headers=headers)
    nachher = (await client.get("/api/v1/admin/users", headers=headers)).json()
    umgestellt = {u["email"]: u for u in nachher["items"]}
    assert umgestellt["mia@example.corp"]["is_admin"] is True


async def test_entzug_wirkt_auch_gegen_ein_altes_admin_cookie(client, auth_headers, make_user):
    """Der Entzug ist lückenlos: Selbst ein Cookie, das noch die Rolle „admin" aus der
    Zeit vor ADR-0022 enthält (Cookies leben bis zu 8 Stunden), verliert den Zugriff.
    Genau das war der Grund, die Autorisierung aus dem Cookie herauszunehmen.
    """
    await _handelnder_admin(make_user)
    ziel = await make_user(sub="s-alt", email="alt@example.corp", admin=True)
    altes_cookie = auth_headers("s-alt", "alt@example.corp", roles=["employee", "admin"])

    assert (await client.get("/api/v1/admin/users", headers=altes_cookie)).status_code == 200

    entzug = await client.request(
        "DELETE",
        f"/api/v1/admin/users/{ziel.id}/admin",
        headers=auth_headers(*ADMIN, roles=NUR_EMPLOYEE),
    )
    assert entzug.status_code == 200
    assert entzug.json()["is_admin"] is False

    gesperrt = await client.get("/api/v1/admin/users", headers=altes_cookie)
    assert gesperrt.status_code == 403
    assert gesperrt.json()["code"] == "NOT_ADMIN"


# --- Bootstrap: der erste Admin auf einer Instanz ohne Admin ------------------
#
# Diese Tests gehen absichtlich über jit_upsert statt über den OIDC-Callback: Der
# Callback bräuchte einen echten IdP, die Logik sitzt aber in der Domäne.


async def _anmelden(app, settings, sub: str, email: str):
    async with app.state.sessionmaker() as session:
        user = await jit_upsert(session, Identity(sub=sub, email=email), settings)
        await session.commit()
        return user.is_admin


async def test_bootstrap_macht_die_erste_gelistete_adresse_zum_admin(make_app):
    """Ohne diesen Weg käme eine frische Instanz nie zu einem Admin: Die Rechte stehen
    in der Datenbank, und es gibt niemanden, der sie vergeben könnte."""

    settings = make_settings(admin_bootstrap_emails="Chef@Example.Corp, zweite@example.corp")
    app = make_app(admin_bootstrap_emails="Chef@Example.Corp, zweite@example.corp")
    # Groß-/Kleinschreibung darf nicht entscheiden — Claims kommen kleingeschrieben an
    assert await _anmelden(app, settings, "s-chef", "chef@example.corp") is True


async def test_bootstrap_ist_wirkungslos_sobald_ein_admin_existiert(make_app, make_user):
    """Die Bedingung ist der Sicherheitskern: Eine dauerhaft wirksame Liste wäre bei
    offener Selbstregistrierung eine Hintertür — wer die Adresse errät und sie
    registrieren kann, wäre Admin."""

    settings = make_settings(admin_bootstrap_emails="chef@example.corp")
    app = make_app(admin_bootstrap_emails="chef@example.corp")
    async with app.state.sessionmaker() as session:
        session.add(
            User(oidc_sub="s-vorhanden", email="da@example.corp", is_active=True, is_admin=True)
        )
        await session.commit()

    assert await _anmelden(app, settings, "s-chef", "chef@example.corp") is False


async def test_bootstrap_greift_wieder_wenn_kein_admin_mehr_aktiv_ist(make_app):
    """Der dokumentierte Ausweg aus einer Aussperrung: Ist der letzte Admin deaktiviert,
    kann niemand mehr administrieren — dann darf die Liste erneut greifen."""

    settings = make_settings(admin_bootstrap_emails="chef@example.corp")
    app = make_app(admin_bootstrap_emails="chef@example.corp")
    async with app.state.sessionmaker() as session:
        session.add(
            User(oidc_sub="s-alt", email="alt@example.corp", is_active=False, is_admin=True)
        )
        await session.commit()

    assert await _anmelden(app, settings, "s-chef", "chef@example.corp") is True


async def test_bootstrap_ignoriert_nicht_gelistete_adressen(make_app):

    settings = make_settings(admin_bootstrap_emails="chef@example.corp")
    app = make_app(admin_bootstrap_emails="chef@example.corp")
    assert await _anmelden(app, settings, "s-fremd", "fremd@example.corp") is False


async def test_ohne_konfigurierte_liste_passiert_nichts(make_app):

    settings = make_settings()
    app = make_app()
    assert await _anmelden(app, settings, "s-egal", "egal@example.corp") is False


async def test_bootstrap_wird_auditiert(make_app):
    """Die einzige Rechtevergabe ohne handelnden Menschen muss nachweisbar sein — sonst
    fehlt sie im Berechtigungsreview genau für den ältesten Zugang der Instanz."""
    settings = make_settings(admin_bootstrap_emails="chef@example.corp")
    app = make_app(admin_bootstrap_emails="chef@example.corp")
    assert await _anmelden(app, settings, "s-chef", "chef@example.corp") is True

    async with app.state.sessionmaker() as session:
        eintraege = list((await session.execute(select(AuditLog))).scalars())
    assert [e.action for e in eintraege] == ["admin_bootstrap"]
    assert eintraege[0].actor_email == "chef@example.corp"
    assert eintraege[0].detail["grund"]
