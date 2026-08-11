"""Meldungs-Historie für alle angemeldeten Nutzer: GET /api/v1/dispatches (ADR-0023)."""

from datetime import datetime, timedelta

from sqlalchemy import text

# Der Leser hat bewusst KEIN Adminrecht: weder die Rolle im Cookie noch das
# Portal-Kennzeichen in der Datenbank (ADR-0022) — genau diese Sicht wird getestet.
MITARBEITER = ("sub-mia", "mia@example.corp")
AUTOR = ("sub-admin", "admin1@example.corp")

# Fixe Basiszeit statt utcnow(): die Sortierung soll an gesetzten Werten hängen und
# nicht daran, wie schnell die Testinserts aufeinander folgen (DATETIME ohne Bruchteile).
BASIS_ZEIT = datetime(2026, 7, 1, 8, 0, 0)

# Was die Historie NIE ausliefern darf (ADR-0014 / ADR-0023)
VERBOTENE_FELDER = (
    "status",
    "recipient_count",
    "sent_count",
    "failed_count",
    "open_count",
    "created_by_email",
    "finished_at",
)

ENTHALTENE_FELDER = {
    "id",
    "topic_id",
    "topic_name",
    "severity",
    "subject",
    "body",
    "created_at",
}

# Rohtext, wie ihn ein Admin einwirft: Markup, Anführungszeichen, Zeilenumbrüche
ROHER_TEXT = (
    'Ausfall im Rechenzentrum.\n\nHinweis: <script>alert("xss")</script> & "in Anführungszeichen"'
    "\r\nLetzte Zeile mit <b>Markup</b>"
)


async def _setup(make_user, leser_aktiv: bool = True):
    """Legt Leser und Autor an und gibt den Autor zurück: `created_by_user_id` zeigt mit
    RESTRICT auf users, ein Versand braucht also einen echten Nutzer."""
    await make_user(sub=MITARBEITER[0], email=MITARBEITER[1], name="Mia Muster", active=leser_aktiv)
    return await make_user(sub=AUTOR[0], email=AUTOR[1], name="Petra Admin", admin=True)


async def _versand(
    app,
    autor_id: int,
    *,
    dispatch_id: int,
    topic_id: str = "kap",
    status: str = "completed",
    severity: str = "stoerung",
    subject: str = "[STÖRUNG] KAP Störungsmeldungen: Testfall",
    body: str = "Meldungstext",
    minuten: int = 0,
) -> int:
    """Roh-SQL statt POST /admin/dispatches: nur so sind Status und Zeitpunkt frei
    wählbar — über die API entsteht immer ein 'pending' mit Zeitstempel jetzt.

    `recipient_count` und `finished_at` werden absichtlich gefüllt: der Test auf die
    verbotenen Felder soll etwas verschweigen können, das in der Zeile wirklich steht.
    """
    created_at = BASIS_ZEIT + timedelta(minutes=minuten)
    abgeschlossen = status not in ("pending", "sending")
    async with app.state.sessionmaker() as session:
        await session.execute(
            text(
                "INSERT INTO dispatches (id, topic_id, severity, subject, body, status, "
                "recipient_count, created_by_user_id, created_at, finished_at) VALUES "
                "(:id, :topic_id, :severity, :subject, :body, :status, :recipient_count, "
                ":autor_id, :created_at, :finished_at)"
            ),
            {
                "id": dispatch_id,
                "topic_id": topic_id,
                "severity": severity,
                "subject": subject,
                "body": body,
                "status": status,
                "recipient_count": 137,
                "autor_id": autor_id,
                "created_at": created_at,
                "finished_at": created_at + timedelta(minutes=3) if abgeschlossen else None,
            },
        )
        await session.commit()
    return dispatch_id


async def _historie(client, headers, query: str = "") -> dict:
    response = await client.get(f"/api/v1/dispatches{query}", headers=headers)
    assert response.status_code == 200
    return response.json()


async def test_mitarbeiter_ohne_adminrecht_sieht_historie(client, app, auth_headers, make_user):
    """Kern des Features: lesen darf die gesamte Belegschaft — ohne Adminrolle im Cookie
    und ohne Portal-Kennzeichen in der Datenbank."""
    autor = await _setup(make_user)
    await _versand(app, autor.id, dispatch_id=1, subject="[STÖRUNG] KAP: Login klemmt")

    response = await client.get("/api/v1/dispatches", headers=auth_headers(*MITARBEITER))
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["subject"] == "[STÖRUNG] KAP: Login klemmt"


async def test_historie_ohne_operative_und_personenbezogene_felder(
    client, app, auth_headers, make_user
):
    """Absicherung einer Zusage, nicht bloß ein Schema-Test: Zustell- und Fehlerzähler
    wären Auswertungsdaten über Empfänger und verrieten zusätzlich die Größe jedes
    Verteilers, der Absender ist ein personenbezogenes Datum eines Beschäftigten
    (ADR-0014, Betriebsrats-Prinzip). Der Versand in der Datenbank TRÄGT beides —
    wer die Historie erweitert, bricht hier absichtlich einen Test.
    """
    autor = await _setup(make_user)
    await _versand(app, autor.id, dispatch_id=1, status="completed_with_errors")

    data = await _historie(client, auth_headers(*MITARBEITER))
    item = data["items"][0]
    for feld in VERBOTENE_FELDER:
        assert feld not in item, f"'{feld}' darf die Historie nicht verlassen"


async def test_historie_enthaelt_nur_den_meldungsinhalt(client, app, auth_headers, make_user):
    autor = await _setup(make_user)
    await _versand(
        app,
        autor.id,
        dispatch_id=1,
        severity="entwarnung",
        subject="[ENTWARNUNG] KAP Störungsmeldungen: behoben",
        body="Alles wieder erreichbar",
    )

    item = (await _historie(client, auth_headers(*MITARBEITER)))["items"][0]
    assert set(item) == ENTHALTENE_FELDER
    assert item["id"] == 1
    assert item["topic_id"] == "kap"
    assert item["topic_name"] == "KAP Störungsmeldungen"  # aus dem Join, nicht aus dispatches
    assert item["severity"] == "entwarnung"
    assert item["subject"] == "[ENTWARNUNG] KAP Störungsmeldungen: behoben"
    assert item["body"] == "Alles wieder erreichbar"
    assert item["created_at"].startswith("2026-07-01T08:00:00")


async def test_nur_abgeschlossene_versaende_sichtbar(client, app, auth_headers, make_user):
    """pending/sending ist noch nicht zugestellt, failed ist ein Betriebsvorfall — beides
    gehört in die Admin-Ansicht und nicht in die Lesehistorie der Belegschaft."""
    autor = await _setup(make_user)
    sichtbar = set()
    stati = ("completed", "completed_with_errors", "pending", "sending", "failed")
    for nummer, status in enumerate(stati, start=1):
        dispatch_id = await _versand(
            app, autor.id, dispatch_id=nummer, status=status, minuten=nummer
        )
        if status in ("completed", "completed_with_errors"):
            sichtbar.add(dispatch_id)

    data = await _historie(client, auth_headers(*MITARBEITER))
    assert {item["id"] for item in data["items"]} == sichtbar
    assert data["total"] == 2


async def test_neueste_meldung_steht_oben(client, app, auth_headers, make_user):
    autor = await _setup(make_user)
    for dispatch_id, minuten in ((1, 0), (2, 30), (3, 15)):
        await _versand(app, autor.id, dispatch_id=dispatch_id, minuten=minuten)

    data = await _historie(client, auth_headers(*MITARBEITER))
    assert [item["id"] for item in data["items"]] == [2, 3, 1]


async def test_filter_grenzt_auf_einen_verteiler_ein(client, app, auth_headers, make_user):
    autor = await _setup(make_user)
    await _versand(app, autor.id, dispatch_id=1, topic_id="kap")
    await _versand(app, autor.id, dispatch_id=2, topic_id="interflex", minuten=5)
    await _versand(app, autor.id, dispatch_id=3, topic_id="interflex", minuten=10)

    data = await _historie(client, auth_headers(*MITARBEITER), "?topic_id=interflex")
    assert data["total"] == 2
    assert [item["id"] for item in data["items"]] == [3, 2]
    assert data["items"][0]["topic_name"] == "Störungsmeldungen Interflex"


async def test_unbekannter_verteiler_liefert_leere_liste(client, app, auth_headers, make_user):
    """Die Ansicht ist ein Filter, kein Detailabruf: ein alter Lesezeichen-Link auf einen
    verschwundenen Verteiler zeigt eine leere Liste, keinen Fehler."""
    autor = await _setup(make_user)
    await _versand(app, autor.id, dispatch_id=1)

    data = await _historie(client, auth_headers(*MITARBEITER), "?topic_id=gibts-nicht")
    assert data["items"] == []
    assert data["total"] == 0


async def test_paginierung_schneidet_zu_und_zaehlt_alle_sichtbaren(
    client, app, auth_headers, make_user
):
    autor = await _setup(make_user)
    for nummer in range(1, 6):
        await _versand(app, autor.id, dispatch_id=nummer, minuten=nummer)
    # Unsichtbar und damit auch nicht mitgezählt — sonst blieben Seiten leer
    await _versand(app, autor.id, dispatch_id=9, status="pending", minuten=99)
    headers = auth_headers(*MITARBEITER)

    seite = await _historie(client, headers, "?limit=2&offset=1")
    assert seite["total"] == 5
    assert seite["limit"] == 2
    assert seite["offset"] == 1
    assert [item["id"] for item in seite["items"]] == [4, 3]

    letzte = await _historie(client, headers, "?limit=2&offset=4")
    assert letzte["total"] == 5
    assert [item["id"] for item in letzte["items"]] == [1]


async def test_paginierungsgrenzen_422(client, app, auth_headers, make_user):
    await _setup(make_user)
    headers = auth_headers(*MITARBEITER)
    for query in ("limit=0", "limit=101", "offset=-1"):
        response = await client.get(f"/api/v1/dispatches?{query}", headers=headers)
        assert response.status_code == 422, query
        assert response.json()["code"] == "VALIDATION_ERROR"


async def test_meldung_eines_deaktivierten_verteilers_bleibt_sichtbar(
    client, app, auth_headers, make_user
):
    """Die Historie ist unveränderlich: wer einen Verteiler stilllegt, löscht damit nicht,
    was darüber gemeldet wurde — sonst verschwände die Vorgeschichte einer Störung."""
    autor = await _setup(make_user)
    await _versand(app, autor.id, dispatch_id=1, topic_id="kap")
    headers = auth_headers(*MITARBEITER)
    async with app.state.sessionmaker() as session:
        await session.execute(text("UPDATE topics SET is_active = 0 WHERE id = 'kap'"))
        await session.commit()
    try:
        data = await _historie(client, headers)
        assert [item["id"] for item in data["items"]] == [1]
        assert data["items"][0]["topic_name"] == "KAP Störungsmeldungen"

        # Gegenprobe: in der Abo-Maske ist der Verteiler weg, die Meldung bleibt
        topics = (await client.get("/api/v1/topics", headers=headers)).json()
        assert "kap" not in {topic["id"] for topic in topics}
    finally:
        # topics überlebt clean_db bewusst (Seed aus Migration 0002) — selbst zurücksetzen
        async with app.state.sessionmaker() as session:
            await session.execute(text("UPDATE topics SET is_active = 1 WHERE id = 'kap'"))
            await session.commit()


async def test_ohne_session_401(client, app, make_user):
    autor = await _setup(make_user)
    await _versand(app, autor.id, dispatch_id=1)

    response = await client.get("/api/v1/dispatches")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHENTICATED"


async def test_deaktivierter_empfaenger_401_session_stale(client, app, auth_headers, make_user):
    """Offboarding wirkt sofort: das Cookie ist weiter gültig, gelesen wird trotzdem
    nichts mehr — deshalb hängt der Endpunkt an CurrentUserDep, nicht an IdentityDep."""
    autor = await _setup(make_user, leser_aktiv=False)
    await _versand(app, autor.id, dispatch_id=1)

    response = await client.get("/api/v1/dispatches", headers=auth_headers(*MITARBEITER))
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_STALE"


async def test_meldungstext_kommt_unveraendert_zurueck(client, app, auth_headers, make_user):
    """Die API escapt bewusst nicht — Escaping ist Sache der Anzeige. Das Frontend MUSS
    Betreff und Text deshalb per textContent setzen; innerHTML wäre hier eine XSS-Lücke
    mit dem Verfasser einer Meldung als Angreifer."""
    autor = await _setup(make_user)
    await _versand(
        app, autor.id, dispatch_id=1, subject='Titel mit "Zitat" & <Klammern>', body=ROHER_TEXT
    )

    item = (await _historie(client, auth_headers(*MITARBEITER)))["items"][0]
    assert item["body"] == ROHER_TEXT
    assert item["subject"] == 'Titel mit "Zitat" & <Klammern>'
