"""Log-Format und der Filter, der Empfängeradressen aus dem Access-Log hält (ADR-0014)."""

import json
import logging
import sys
import time

from app.core.logging import (
    _ZEICHEN,
    JsonFormatter,
    QueryStringFilter,
    request_id_var,
    setup_logging,
)
from app.core.oidc import _ADRESSE as _ANMELDUNG_ADRESSE

UVICORN = ("uvicorn", "uvicorn.error", "uvicorn.access")
# Was eine Adresse nach RFC 5322 neben Buchstaben, Ziffern und „_“ ohne Anführungszeichen
# enthalten darf, dazu der Punkt
SONDERZEICHEN = ".!#$%&'*+/=?^`{|}~-"


def _record(msg: str, args: object) -> logging.LogRecord:
    return logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, msg, args, None)


def test_query_string_wird_aus_dem_access_log_entfernt():
    """So protokolliert uvicorn.access — die Suche der Empfänger-Maske trüge sonst die
    gesuchte Mailadresse ins Log."""
    record = _record(
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1", "GET", "/api/v1/admin/users?query=mia@example.corp&limit=50", "1.1", 200),
    )
    assert QueryStringFilter().filter(record) is True
    message = record.getMessage()
    assert "mia@example.corp" not in message
    assert "/api/v1/admin/users?<entfernt>" in message
    assert message.endswith("200")


def test_setup_logging_filtert_auch_das_access_log_von_uvicorn(capsys):
    """Der Filter wirkt nur, wenn setup_logging ihn an den Handler hängt, über den auch
    uvicorn.access schreibt — und wenn uvicorns eigener Access-Handler weg ist: Der
    schriebe die Zeile ein zweites Mal, ungefiltert."""
    root = logging.getLogger()
    vorher = (root.handlers[:], root.level)
    uvicorn_vorher = {
        n: (logging.getLogger(n).handlers[:], logging.getLogger(n).propagate) for n in UVICORN
    }
    access = logging.getLogger("uvicorn.access")
    access.handlers = [logging.StreamHandler(sys.stdout)]  # so legt uvicorn ihn beim Start an
    access.propagate = False
    try:
        setup_logging("info")
        access.info(
            '%s - "%s %s HTTP/%s" %d',
            "127.0.0.1:1",
            "GET",
            "/api/v1/admin/users?query=mia@example.corp",
            "1.1",
            200,
        )
        ausgabe = capsys.readouterr().out
    finally:
        root.handlers = vorher[0]
        root.setLevel(vorher[1])  # setLevel leert auch den Cache von isEnabledFor
        for name, (handlers, propagate) in uvicorn_vorher.items():
            logging.getLogger(name).handlers = handlers
            logging.getLogger(name).propagate = propagate
    assert "mia@example.corp" not in ausgabe
    (zeile,) = ausgabe.splitlines()
    assert json.loads(zeile)["msg"].endswith('GET /api/v1/admin/users?<entfernt> HTTP/1.1" 200')


def _ausgabe(record: logging.LogRecord) -> dict[str, str]:
    return json.loads(JsonFormatter().format(record))


def test_adressen_aus_fremden_fehlertexten_stehen_nicht_im_log():
    """hide_parameters nimmt SQLAlchemys Parameterblock weg — PostgreSQL nennt den
    Schlüsselwert aber zusätzlich in der DETAIL-Zeile seiner Meldung, und die steht im
    Traceback, den log.exception schreibt (ADR-0014)."""
    detail = (
        'duplicate key value violates unique constraint "uq_users_email"\n'
        "DETAIL:  Key (email)=(mia.muster+portal@example.corp) already exists."
    )
    try:
        raise RuntimeError(detail)
    except RuntimeError:
        record = logging.LogRecord(
            "app", logging.ERROR, __file__, 1, "Versand %s fehlgeschlagen", (7,), sys.exc_info()
        )
    zeile = _ausgabe(record)
    assert "example.corp" not in json.dumps(zeile)
    assert "Key (email)=(<adresse>) already exists." in zeile["exc"]
    assert zeile["msg"] == "Versand 7 fehlgeschlagen"


def test_adressen_in_der_meldung_werden_ersetzt_alles_andere_bleibt():
    """Ein SMTP-Fehlertext nennt den abgelehnten Empfänger; der Worker reicht ihn als
    Formatargument durch. Auch Zugangsdaten in einer Datenbank-URL sehen so aus."""
    record = _record(
        "SMTP-Verbindung fehlgeschlagen: %s",
        ("550 5.1.1 <ö.müller@bücher.example>: Recipient address rejected",),
    )
    assert _ausgabe(record)["msg"] == (
        "SMTP-Verbindung fehlgeschlagen: 550 5.1.1 <<adresse>>: Recipient address rejected"
    )
    url = _record("Verbindung zu %s", ("postgresql+psycopg://app:geheim@postgres:5432/db",))
    assert _ausgabe(url)["msg"] == "Verbindung zu <adresse>"
    harmlos = _record("Retention: %s Empfängerzeilen gelöscht, Versand %s @ 08:00", (12, 7))
    assert _ausgabe(harmlos)["msg"] == "Retention: 12 Empfängerzeilen gelöscht, Versand 7 @ 08:00"


def test_adressen_die_die_anmeldung_annimmt_werden_ganz_ersetzt():
    """Die Anmeldung nimmt im lokalen Teil mehr an als Buchstaben und Ziffern (oidc._ADRESSE);
    solche Adressen stehen dann in der Datenbank und in fremden Fehlertexten. Kennte das Log
    eines dieser Zeichen nicht, bliebe alles davor stehen — bei „mia~@…“ die ganze Adresse.
    Deshalb nimmt das Log dieselben Zeichen wie die Anmeldung, nicht eine eigene Auswahl."""
    assert _ANMELDUNG_ADRESSE.pattern == f"{_ZEICHEN}+@{_ZEICHEN}+"
    for adresse in (
        "jean-pierre.o'neil@example.corp",
        "sonde&partner@example.corp",
        "abt/mia@example.corp",
        "mia~@example.corp",
        "vertretung:mia@example.corp",
        "mia€@example.corp",
        "rene\u0301@example.corp",  # é aus e und einem kombinierenden Akzent
    ):
        assert _ANMELDUNG_ADRESSE.fullmatch(adresse), adresse
        try:
            raise RuntimeError(f"DETAIL:  Key (email)=({adresse}) already exists.")
        except RuntimeError:
            record = logging.LogRecord(
                "app", logging.ERROR, __file__, 1, "Abgelehnt: <%s>", (adresse,), sys.exc_info()
            )
        zeile = _ausgabe(record)
        assert zeile["msg"] == "Abgelehnt: <<adresse>>", adresse
        assert "Key (email)=(<adresse>) already exists." in zeile["exc"], adresse
    # Ebenso jedes andere ASCII-Zeichen, das die Anmeldung annimmt
    for zeichen in map(chr, range(0x21, 0x7F)):
        adresse = f"a{zeichen}@example.corp"
        if _ANMELDUNG_ADRESSE.fullmatch(adresse):
            assert _ausgabe(_record("<%s>", (adresse,)))["msg"] == "<<adresse>>", adresse


def test_verbundene_adressen_hinterlassen_keinen_rest():
    """„+“ steht in Formulardaten für ein Leerzeichen und ist zugleich ein Adresszeichen. Endete
    der Treffer an der ersten Domain oder vor dem zweiten „@“, bliebe von der zweiten Adresse
    etwas stehen — das gilt für jedes Zeichen, das auf beiden Seiten des „@“ stehen darf."""
    verbunden = [f"mia@example.corp{z}max@example.corp" for z in "_" + SONDERZEICHEN]
    for text in ["a@b+c@d", *verbunden]:
        meldung = _ausgabe(_record("Empfänger %s abgelehnt", (text,)))["msg"]
        assert meldung == "Empfänger <adresse> abgelehnt", text


def test_lange_zeichenketten_halten_das_log_nicht_auf():
    """Die Anfragezeile einer unangemeldeten Anfrage steht im Access-Log wie jede andere. NGINX
    lässt höchstens 8 KiB durch (large_client_header_buffers, Standardwert). Der Test nimmt
    40 000 Zeichen, damit der Abstand zur Zeitgrenze deutlich ist — mehr, als im Log aus 8 KiB
    werden kann, auch wenn uvicorn den Pfad prozentkodiert schreibt (aus einem „'“ werden drei
    Zeichen). Begänne die Suche nach Adressen an jedem Zeichen neu, kostete eine solche Zeile
    viele Sekunden statt Millisekunden, und im einzigen Prozess stünde so lange alles. Das
    gilt für jedes Zeichen, aus dem eine Adresse bestehen kann, nicht nur für Buchstaben."""
    ketten = [zeichen * 40_000 for zeichen in "a7_ü:€" + SONDERZEICHEN] + ["Ab1._-+" * 6_000]
    for kette in ketten:
        for ende in ("", "@", "@ziel.example"):
            zeile = "GET /" + kette + ende + " HTTP/1.1"
            start = time.perf_counter()
            meldung = _ausgabe(_record("%s", (zeile,)))["msg"]
            assert time.perf_counter() - start < 2, kette[:7]
            # „/“ ist selbst ein Adresszeichen: Der Schrägstrich vor der Kette gehört zum Treffer
            assert meldung == ("GET <adresse> HTTP/1.1" if ende == "@ziel.example" else zeile)


def test_pfad_ohne_query_und_fremde_argumente_bleiben():
    record = _record("%s %s %s", ("/api/v1/topics", "Frage? Antwort", 7))
    QueryStringFilter().filter(record)
    assert record.args == ("/api/v1/topics", "Frage? Antwort", 7)


def test_filter_vertraegt_fehlende_und_dict_argumente():
    # logging packt ein einzelnes Dict-Argument aus: record.args ist dann kein Tupel
    for args in (None, ({"pfad": "/x?y=1"},)):
        record = _record("ohne Platzhalter", args)
        assert QueryStringFilter().filter(record) is True


def test_json_format_mit_request_id():
    token = request_id_var.set("req-42")
    try:
        data = json.loads(JsonFormatter().format(_record("Versand %s abgeschlossen", (7,))))
    finally:
        request_id_var.reset(token)
    assert data["msg"] == "Versand 7 abgeschlossen"
    assert data["level"] == "INFO"
    assert data["logger"] == "uvicorn.access"
    assert data["request_id"] == "req-42"
    assert data["ts"].endswith("+00:00")
    assert "exc" not in data


def test_json_format_haengt_traceback_an():
    try:
        raise RuntimeError("kaputt")
    except RuntimeError:
        record = logging.LogRecord(
            "app", logging.ERROR, __file__, 1, "Fehler", None, sys.exc_info()
        )
    data = json.loads(JsonFormatter().format(record))
    assert "RuntimeError: kaputt" in data["exc"]


def test_umlaute_bleiben_lesbar():
    assert "Störung" in JsonFormatter().format(_record("Störung", None))
