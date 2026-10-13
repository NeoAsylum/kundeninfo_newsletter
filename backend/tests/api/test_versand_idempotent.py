"""„Versand anlegen“ ist mit `idempotency_key` wiederholbar (ADR-0031).

Geht die Antwort auf POST /api/v1/admin/dispatches verloren, weiß der Admin nicht, ob der
Versand angelegt wurde — und ein zweiter Aufruf verschickte die Meldung doppelt. Mit
Schlüssel legt die Wiederholung nichts an und liefert den vorhandenen Versand.

`topics` überlebt clean_db (Seed): Was ein Test an „kap“ ändert, stellt die Fixture
`kap_zurueckstellen` wieder her.
"""

import asyncio
import uuid

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Enum, Uuid, func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.api import admin
from app.db.models import AuditLog, Base, Dispatch, DispatchRecipient, Subscription

ADMIN = ("sub-admin", "admin1@example.corp")
URL = "/api/v1/admin/dispatches"
KAP_NAME = "KAP Störungsmeldungen"
MELDUNG = {
    "topic_id": "kap",
    "severity": "stoerung",
    "title": "Login klemmt",
    "body": "Seit 9 Uhr.",
}


def _mit_schluessel(schluessel: str | None = None, **aenderung) -> dict:
    return MELDUNG | {"idempotency_key": schluessel or str(uuid.uuid4())} | aenderung


async def _admin_und_zwei_abonnenten(app, make_user, auth_headers) -> dict[str, str]:
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    mia = await make_user(sub="s1", email="mia@example.corp")
    max_ = await make_user(sub="s2", email="max@example.corp")
    async with app.state.sessionmaker() as session:
        session.add_all(Subscription(user_id=u.id, topic_id="kap") for u in (mia, max_))
        await session.commit()
    return auth_headers(*ADMIN)


async def _bestand(app) -> tuple[list[Dispatch], int, list[str]]:
    """Frisch aus der DB gelesen: Versände, Zahl der Empfängerzeilen, Audit-Aktionen."""
    async with app.state.sessionmaker() as session:
        versaende = list((await session.execute(select(Dispatch).order_by(Dispatch.id))).scalars())
        empfaenger = (
            await session.execute(select(func.count()).select_from(DispatchRecipient))
        ).scalar_one()
        audit = list(
            (await session.execute(select(AuditLog.action).order_by(AuditLog.id))).scalars()
        )
    return versaende, empfaenger, audit


async def _sql(app, anweisung: str, **parameter) -> None:
    async with app.state.sessionmaker() as session:
        await session.execute(text(anweisung), parameter)
        await session.commit()


@pytest.fixture
async def kap_zurueckstellen(app):
    yield
    await _sql(
        app, "UPDATE topics SET name = :name, is_active = true WHERE id = 'kap'", name=KAP_NAME
    )


# --- Ohne Schlüssel: wie bisher ------------------------------------------------------------


@pytest.mark.parametrize("zusatz", [{}, {"idempotency_key": None}], ids=["fehlt", "null"])
async def test_ohne_schluessel_entsteht_jedes_mal_ein_neuer_versand(
    client, app, auth_headers, make_user, zusatz
):
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)

    antworten = [await client.post(URL, headers=headers, json=MELDUNG | zusatz) for _ in range(2)]

    assert [a.status_code for a in antworten] == [201, 201]
    assert antworten[0].json()["id"] != antworten[1].json()["id"]
    versaende, empfaenger, audit = await _bestand(app)
    # Zwei Zeilen ohne Schlüssel nebeneinander: Der eindeutige Index lässt mehrere NULL zu
    assert [v.idempotency_key for v in versaende] == [None, None]
    assert empfaenger == 4
    assert audit == ["dispatch_created", "dispatch_created"]


# --- Neuer Schlüssel, Wiederholung ---------------------------------------------------------


async def test_neuer_schluessel_legt_an_und_wird_am_versand_gespeichert(
    client, app, auth_headers, make_user
):
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    schluessel = uuid.uuid4()

    antwort = await client.post(URL, headers=headers, json=_mit_schluessel(str(schluessel)))

    assert antwort.status_code == 201
    assert antwort.json()["recipient_count"] == 2
    versaende, empfaenger, audit = await _bestand(app)
    assert [(v.id, v.idempotency_key) for v in versaende] == [(antwort.json()["id"], schluessel)]
    assert empfaenger == 2
    assert audit == ["dispatch_created"]


async def test_wiederholung_antwortet_200_mit_demselben_versand_und_legt_nichts_an(
    client, app, auth_headers, make_user
):
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel()

    angelegt = await client.post(URL, headers=headers, json=anfrage)
    wiederholt = await client.post(URL, headers=headers, json=anfrage)

    assert (angelegt.status_code, wiederholt.status_code) == (201, 200)
    # Form der 201-Antwort — und solange sich nichts getan hat, auch derselbe Inhalt
    assert wiederholt.json() == angelegt.json()
    versaende, empfaenger, audit = await _bestand(app)
    assert len(versaende) == 1
    assert empfaenger == 2  # kein zweiter Empfänger-Snapshot
    assert audit == ["dispatch_created"]  # kein zweiter Audit-Eintrag


async def test_wiederholung_zeigt_aktuellen_status_und_zaehler(
    client, app, auth_headers, make_user
):
    """Die Wiederholung kommt, während der Worker schon sendet: Sie liefert den Stand von
    jetzt, nicht eine Kopie der ersten Antwort."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel()
    angelegt = (await client.post(URL, headers=headers, json=anfrage)).json()
    await _sql(app, "UPDATE dispatches SET status = 'sending'")
    for adresse, status in (("mia@example.corp", "sent"), ("max@example.corp", "failed")):
        await _sql(
            app,
            "UPDATE dispatch_recipients SET status = :status WHERE email = :adresse",
            status=status,
            adresse=adresse,
        )

    wiederholt = await client.post(URL, headers=headers, json=anfrage)

    assert wiederholt.status_code == 200
    stand = {"status": "sending", "sent_count": 1, "failed_count": 1, "open_count": 0}
    assert wiederholt.json() == angelegt | stand


async def test_schreibweise_des_schluessels_ist_egal(client, app, auth_headers, make_user):
    """Gespeichert wird der Wert, nicht die Zeichenkette: Großschreibung trennt nicht."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    schluessel = str(uuid.uuid4())

    angelegt = await client.post(URL, headers=headers, json=_mit_schluessel(schluessel))
    wiederholt = await client.post(URL, headers=headers, json=_mit_schluessel(schluessel.upper()))

    assert (angelegt.status_code, wiederholt.status_code) == (201, 200)
    assert wiederholt.json()["id"] == angelegt.json()["id"]


async def test_schluessel_gilt_nicht_je_admin(client, app, auth_headers, make_user):
    """Der Schlüssel ist nicht an das anlegende Konto gebunden (ADR-0031): Ein zweiter
    Admin bekommt denselben Versand zurück — den ihm die Historie ohnehin zeigt."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    await make_user(sub="sub-admin-2", email="admin2@example.corp", admin=True)
    anfrage = _mit_schluessel()

    angelegt = await client.post(URL, headers=headers, json=anfrage)
    wiederholt = await client.post(
        URL, headers=auth_headers("sub-admin-2", "admin2@example.corp"), json=anfrage
    )

    assert (angelegt.status_code, wiederholt.status_code) == (201, 200)
    assert wiederholt.json() == angelegt.json()
    assert len((await _bestand(app))[0]) == 1


@pytest.mark.parametrize(
    ("eingriff", "neuer_versand_scheitert_mit"),
    [
        ("UPDATE topics SET is_active = false WHERE id = 'kap'", (404, "TOPIC_NOT_FOUND")),
        ("DELETE FROM subscriptions WHERE topic_id = 'kap'", (422, "NO_RECIPIENTS")),
    ],
    ids=["verteiler-deaktiviert", "ohne-empfaenger"],
)
async def test_wiederholung_gilt_vor_den_pruefungen_fuer_einen_neuen_versand(
    client, app, auth_headers, make_user, kap_zurueckstellen, eingriff, neuer_versand_scheitert_mit
):
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel()
    angelegt = await client.post(URL, headers=headers, json=anfrage)
    await _sql(app, eingriff)

    wiederholt = await client.post(URL, headers=headers, json=anfrage)
    neu = await client.post(URL, headers=headers, json=_mit_schluessel())

    assert wiederholt.status_code == 200
    assert wiederholt.json() == angelegt.json()
    # Gegenprobe: Dieselbe Meldung unter einem NEUEN Schlüssel scheitert an eben der Prüfung
    assert (neu.status_code, neu.json()["code"]) == neuer_versand_scheitert_mit
    versaende, empfaenger, audit = await _bestand(app)
    assert (len(versaende), empfaenger, audit) == (1, 2, ["dispatch_created"])


async def test_wiederholung_nach_umbenanntem_verteiler(
    client, app, auth_headers, make_user, kap_zurueckstellen
):
    """Der gespeicherte Betreff trägt den alten Verteilernamen. Der Vergleich darf daran
    nicht scheitern (sonst 409 auf eine echte Wiederholung) — und erkennt einen anderen
    Titel trotzdem."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel()
    angelegt = (await client.post(URL, headers=headers, json=anfrage)).json()
    await _sql(app, "UPDATE topics SET name = 'KAP (neu)' WHERE id = 'kap'")

    wiederholt = await client.post(URL, headers=headers, json=anfrage)
    anderer_titel = await client.post(URL, headers=headers, json=anfrage | {"title": "Anders"})

    assert wiederholt.status_code == 200
    assert wiederholt.json() == angelegt | {"topic_name": "KAP (neu)"}
    assert wiederholt.json()["subject"] == f"[STÖRUNG] {KAP_NAME}: Login klemmt"
    assert anderer_titel.status_code == 409


# --- Derselbe Schlüssel, andere Meldung ----------------------------------------------------


@pytest.mark.parametrize(
    "aenderung",
    [
        {"topic_id": "aap"},
        {"severity": "entwarnung"},
        {"title": "Login klemmt wieder"},
        {"title": "Update: Login klemmt"},
        {"title": "klemmt"},
        {"body": "Seit 9 Uhr. Nachtrag: behoben."},
    ],
    ids=["verteiler", "schweregrad", "titel", "titel-mit-vorsatz", "titel-nur-ende", "text"],
)
async def test_gleicher_schluessel_mit_anderer_meldung_409(
    client, app, auth_headers, make_user, aenderung
):
    """Nie stillschweigend den anderen Versand liefern: Der Admin hielte die geänderte
    Meldung für verschickt."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel()
    angelegt = (await client.post(URL, headers=headers, json=anfrage)).json()

    antwort = await client.post(URL, headers=headers, json=anfrage | aenderung)

    assert antwort.status_code == 409
    assert antwort.json() == {
        "code": "IDEMPOTENCY_KEY_REUSED",
        "detail": f"Unter dem Schlüssel dieser Anfrage besteht bereits Versand {angelegt['id']} "
        "mit anderem Inhalt — die jetzt übermittelte Meldung wurde nicht angelegt",
    }
    versaende, empfaenger, audit = await _bestand(app)
    assert (len(versaende), empfaenger, audit) == (1, 2, ["dispatch_created"])
    assert versaende[0].subject == f"[STÖRUNG] {KAP_NAME}: Login klemmt"


async def test_titelvergleich_erkennt_fehlenden_vorsatz_nicht(client, app, auth_headers, make_user):
    """Die bekannte Grenze des Vergleichs (ADR-0031): Der Titel steht nur als Ende des
    Betreffs in der Datenbank. Fehlt dem neuen Titel nur ein vorderes Stück, das auf „: “
    endet, hält die API ihn für denselben. Dieser Test hält die Grenze fest — fällt er,
    stimmt der Satz im ADR nicht mehr."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel(title="Login: Ausfall")
    angelegt = await client.post(URL, headers=headers, json=anfrage)

    antwort = await client.post(URL, headers=headers, json=anfrage | {"title": "Ausfall"})

    assert antwort.status_code == 200
    assert antwort.json()["subject"] == angelegt.json()["subject"]
    assert antwort.json()["subject"].endswith(": Login: Ausfall")


# --- Eingabe, Antworten, Vorschau ----------------------------------------------------------


@pytest.mark.parametrize(
    "wert",
    ["kein-uuid", "", 12345, ["a"], "123e4567-e89b-42d3-a456-42661417400"],
    ids=["text", "leer", "zahl", "liste", "ein-zeichen-zu-kurz"],
)
async def test_schluessel_muss_eine_uuid_sein_422(client, app, auth_headers, make_user, wert):
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)

    antwort = await client.post(URL, headers=headers, json=MELDUNG | {"idempotency_key": wert})

    assert antwort.status_code == 422
    assert antwort.json()["code"] == "VALIDATION_ERROR"
    assert (await _bestand(app))[0] == []


async def test_schluessel_steht_in_keiner_antwort(client, app, auth_headers, make_user):
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    schluessel = str(uuid.uuid4())
    anfrage = _mit_schluessel(schluessel)

    angelegt = await client.post(URL, headers=headers, json=anfrage)
    antworten = [
        angelegt,
        await client.post(URL, headers=headers, json=anfrage),
        await client.post(URL, headers=headers, json=anfrage | {"body": "Anderer Text"}),
        await client.get(URL, headers=headers),
        await client.get(f"{URL}/{angelegt.json()['id']}", headers=headers),
        await client.get("/api/v1/dispatches", headers=headers),
    ]

    assert [a.status_code for a in antworten] == [201, 200, 409, 200, 200, 200]
    for antwort in antworten:
        assert schluessel not in antwort.text.lower()
        assert '"idempotency_key"' not in antwort.text


async def test_vorschau_kennt_den_schluessel_nicht(client, app, auth_headers, make_user):
    """Die Vorschau legt nichts an und nimmt das Feld nicht: Selbst ein ungültiger Wert
    wird nicht geprüft, und ein gültiger reserviert nichts."""
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    schluessel = str(uuid.uuid4())

    for wert in ("kein-uuid", schluessel):
        vorschau = await client.post(
            f"{URL}/preview", headers=headers, json=MELDUNG | {"idempotency_key": wert}
        )
        assert vorschau.status_code == 200
    angelegt = await client.post(URL, headers=headers, json=_mit_schluessel(schluessel))

    assert angelegt.status_code == 201
    assert len((await _bestand(app))[0]) == 1


# --- Gleichzeitige Aufrufe -----------------------------------------------------------------


async def test_gleichzeitige_aufrufe_mit_demselben_schluessel_ergeben_einen_versand(
    client, app, auth_headers, make_user, monkeypatch
):
    """Ein echtes Rennen, nicht zwei Aufrufe hintereinander: Beide Aufrufe werden zwischen
    der Vorab-Abfrage zum Schlüssel und dem INSERT angehalten, bis BEIDE dort stehen. Dort
    kommt nur an, wer zu seinem Schlüssel keinen Versand gefunden hat — das Lesen vor dem
    Schreiben hat also beide durchgelassen, und beide schreiben. Dass trotzdem nur ein
    Versand entsteht, leistet allein der eindeutige Index; dass der Verlierer 200 statt
    eines Fehlers bekommt, die Behandlung des Konflikts.
    """
    headers = await _admin_und_zwei_abonnenten(app, make_user, auth_headers)
    anfrage = _mit_schluessel()
    beide_da = asyncio.Barrier(2)
    echte_aufloesung = admin.resolve_recipient_users
    hinter_der_vorab_abfrage = 0

    async def erst_wenn_beide_da_sind(session, topic):
        nonlocal hinter_der_vorab_abfrage
        await beide_da.wait()
        hinter_der_vorab_abfrage += 1
        return await echte_aufloesung(session, topic)

    monkeypatch.setattr(admin, "resolve_recipient_users", erst_wenn_beide_da_sind)

    # Die Frist ist nur das Netz: Käme ein Aufruf nie an der Barriere an, hinge der Test.
    async with asyncio.timeout(30):
        antworten = await asyncio.gather(
            *(client.post(URL, headers=headers, json=anfrage) for _ in range(2))
        )

    assert hinter_der_vorab_abfrage == 2
    assert sorted(a.status_code for a in antworten) == [200, 201]
    assert antworten[0].json() == antworten[1].json()
    versaende, empfaenger, audit = await _bestand(app)
    assert [v.id for v in versaende] == [antworten[0].json()["id"]]
    assert empfaenger == 2
    assert audit == ["dispatch_created"]


async def test_anderer_integritaetsverstoss_bleibt_ein_fehler(
    client, app, auth_headers, make_user, monkeypatch
):
    """Die Konfliktbehandlung gilt nur dem Schlüssel. Verschwindet der Verteiler zwischen
    Prüfung und INSERT (Fremdschlüssel), gibt es zum Schlüssel keinen Versand — das darf
    nicht als Erfolg beantwortet werden."""
    await make_user(sub=ADMIN[0], email=ADMIN[1], admin=True)
    headers = auth_headers(*ADMIN)
    await _sql(
        app,
        "INSERT INTO topics (id, name, is_mandatory, is_active) "
        "VALUES ('test-weg', 'Test weg', true, true) ON CONFLICT (id) DO NOTHING",
    )
    echte_aufloesung = admin.resolve_recipient_users

    async def verteiler_verschwindet(session, topic):
        empfaenger = await echte_aufloesung(session, topic)
        await _sql(app, "DELETE FROM topics WHERE id = 'test-weg'")
        return empfaenger

    monkeypatch.setattr(admin, "resolve_recipient_users", verteiler_verschwindet)
    try:
        with pytest.raises(IntegrityError):
            await client.post(URL, headers=headers, json=_mit_schluessel(topic_id="test-weg"))
        assert (await _bestand(app))[0] == []
    finally:
        await _sql(app, "DELETE FROM topics WHERE id = 'test-weg'")


# --- Migration 0005 ------------------------------------------------------------------------


async def test_migration_0005_spalte_und_eindeutiger_index(app):
    def _lesen(conn):
        inspektor = inspect(conn)
        return (
            {s["name"]: s for s in inspektor.get_columns("dispatches")},
            {i["name"]: i for i in inspektor.get_indexes("dispatches")},
        )

    async with app.state.engine.connect() as conn:
        spalten, indizes = await conn.run_sync(_lesen)

    spalte = spalten["idempotency_key"]
    assert isinstance(spalte["type"], Uuid)
    # Additiv (ADR-0011): nullable und ohne Default — Bestandszeilen bleiben unberührt
    assert (spalte["nullable"], spalte["default"]) == (True, None)
    index = indizes["uq_dispatches_idempotency_key"]
    assert (index["unique"], index["column_names"]) == (True, ["idempotency_key"])


async def test_modell_und_migrationen_beschreiben_dasselbe_schema(app):
    """Alembics eigener Vergleich (der hinter `--autogenerate`) zwischen den Modellen und
    der per `upgrade head` aufgebauten Datenbank: Tabellen, Spalten, Typen, Indizes und
    Unique-Constraints. Server-Defaults vergleicht er in dieser Einstellung nicht, die
    Werte der Enum-Typen gar nicht — die prüft der zweite Teil."""

    def _abweichungen(conn):
        return compare_metadata(MigrationContext.configure(conn), Base.metadata)

    def _enum_werte(conn):
        zeilen = conn.exec_driver_sql(
            "SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid"
        )
        werte: dict[str, set[str]] = {}
        for typ, wert in zeilen:
            werte.setdefault(typ, set()).add(wert)
        return werte

    im_modell = {
        spalte.type.name: set(spalte.type.enums)
        for tabelle in Base.metadata.tables.values()
        for spalte in tabelle.columns
        if isinstance(spalte.type, Enum)
    }
    assert len(im_modell) >= 3
    async with app.state.engine.connect() as conn:
        assert await conn.run_sync(_abweichungen) == []
        # Ein Status, der nur im Modell steht, scheiterte sonst erst beim ersten INSERT
        assert await conn.run_sync(_enum_werte) == im_modell
