"""deploy/vm/configure-realm.sh stellt den Keycloak-Realm der Pilot-VM über ein eingebettetes
Python-Programm ein. Hier läuft dieses Programm gegen eine Keycloak-Attrappe: Geprüft wird,
WELCHE Realm-Einstellungen es schickt — nicht, was ein echter Keycloak daraus macht, und
nicht der Shell-Teil davor (dort nur der Text der Übergabe)."""

import json
import pathlib
import re

import httpx
import pytest

SKRIPT = pathlib.Path(__file__).resolve().parents[3] / "deploy" / "vm" / "configure-realm.sh"
ECHTER_CLIENT = httpx.Client

# So reicht der Shell-Teil die Werte der .env in den api-Container; alles erfunden.
UMGEBUNG = {
    "KC_ADMIN": "kcadmin",
    "KC_ADMIN_PW": "nur-im-test",
    "PUBLIC_HOST": "portal.example",
    "OIDC_CLIENT_ID": "newsletter-dev",
    "OIDC_CLIENT_SECRET": "nur-im-test",
    "SMTP_HOST": "smtp.example.test",
    "SMTP_PORT": "587",
    "SMTP_SECURITY": "starttls",
    "SMTP_AUTH_MODE": "login",
    "SMTP_USER": "postfach@example.test",
    "SMTP_PASSWORD": "nur-im-test",
    "MAIL_FROM": "postfach@example.test",
}
MAILSERVER = {
    "host": "smtp.example.test",
    "port": "587",
    "starttls": "true",
    "ssl": "false",
    "auth": "true",
    "user": "postfach@example.test",
    "password": "nur-im-test",
    "from": "postfach@example.test",
    "fromDisplayName": "Störungsinfo-Portal",
}


def _unterschiede(a: dict, b: dict) -> set[str]:
    """Die Namen der Realm-Einstellungen, in denen sich zwei Läufe unterscheiden — auch
    solcher, die nur einer von beiden schickt."""
    return {name for name in a.keys() | b.keys() if a.get(name) != b.get(name)}


def realm_einstellungen(monkeypatch, capsys, tageslimit: str | None):
    """Führt das eingebettete Python aus und gibt zurück, was es als Realm-Einstellungen
    schickt und was es ausgibt. Die Attrappe kennt danach keinen Client: Das Skript bricht
    dort ab, bevor es Client oder Konten anfasst."""
    quelltext = re.search(r"<<'PYTHON'\n(.*?)^PYTHON$", SKRIPT.read_text("utf-8"), re.M | re.S)
    assert quelltext, "eingebettetes Python nicht gefunden"
    geschickt: list[dict] = []

    def keycloak(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "nur-im-test"})
        if request.method == "PUT" and request.url.path == "/idp/admin/realms/dev":
            geschickt.append(json.loads(request.content))
            return httpx.Response(204)
        return httpx.Response(200, json=[])  # Suche nach dem Client: nichts gefunden

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **optionen: ECHTER_CLIENT(transport=httpx.MockTransport(keycloak), **optionen),
    )
    for name, wert in UMGEBUNG.items():
        monkeypatch.setenv(name, wert)
    if tageslimit is None:
        monkeypatch.delenv("SMTP_MAX_PER_DAY", raising=False)
    else:
        monkeypatch.setenv("SMTP_MAX_PER_DAY", tageslimit)

    with pytest.raises(SystemExit):
        exec(compile(quelltext.group(1), str(SKRIPT), "exec"), {"__name__": "__main__"})
    ausgabe = capsys.readouterr()
    # Admin-, Client- und Postfach-Passwort sowie das Token: nichts davon gehört in die Ausgabe
    assert "nur-im-test" not in ausgabe.out + ausgabe.err
    return geschickt, ausgabe


@pytest.mark.parametrize("tageslimit", ["0", "", None])
def test_ohne_tageslimit_sendet_keycloak_ueber_das_postfach_der_anwendung(
    monkeypatch, capsys, tageslimit
):
    """SMTP_MAX_PER_DAY 0, leer oder gar nicht gesetzt: Der Realm bekommt den Mailserver aus
    den SMTP_*-Werten, und der Passwort-Reset ist an — der Stand vor ADR-0032."""
    (einstellungen,), ausgabe = realm_einstellungen(monkeypatch, capsys, tageslimit)

    assert einstellungen["smtpServer"] == MAILSERVER
    assert einstellungen["resetPasswordAllowed"] is True
    assert "Tageslimit" not in ausgabe.out


# 1: schon das kleinste Limit zählt; 5.0 liest auch die Anwendung als 5
@pytest.mark.parametrize("tageslimit", ["1", "5", "5.0"])
def test_mit_tageslimit_bekommt_der_realm_keinen_mailserver(monkeypatch, capsys, tageslimit):
    """Keycloaks eigene Mails gingen über dasselbe Postfach am Versand-Worker vorbei und
    zählten nicht mit (ADR-0032). Solange ein Limit gesetzt ist, bekommt der Realm deshalb
    keinen Mailserver und keinen Passwort-Reset — alles andere bleibt, wie es ohne Limit
    ist — und das Skript sagt es in einer Zeile."""
    (ohne_limit,), _ = realm_einstellungen(monkeypatch, capsys, "0")
    (mit_limit,), ausgabe = realm_einstellungen(monkeypatch, capsys, tageslimit)

    assert mit_limit["smtpServer"] == {}
    assert mit_limit["resetPasswordAllowed"] is False
    assert _unterschiede(ohne_limit, mit_limit) == {"smtpServer", "resetPasswordAllowed"}
    zeilen = [z for z in ausgabe.out.splitlines() if "Tageslimit" in z]
    assert zeilen == [
        f"Tageslimit gesetzt (SMTP_MAX_PER_DAY={tageslimit}): Realm ohne Mailserver, "
        "Passwort-Reset abgeschaltet — Keycloaks eigene Mails würden nicht mitgezählt"
    ]


@pytest.mark.parametrize(
    ("tageslimit", "meldung"),
    [
        ("fünf", "ABBRUCH: SMTP_MAX_PER_DAY ist keine Zahl"),
        ("nan", "ABBRUCH: SMTP_MAX_PER_DAY ist keine Zahl"),
        ("inf", "ABBRUCH: SMTP_MAX_PER_DAY ist keine Zahl"),
        ("-5", "ABBRUCH: SMTP_MAX_PER_DAY darf nicht negativ sein"),
        ("-0.5", "ABBRUCH: SMTP_MAX_PER_DAY darf nicht negativ sein"),
        ("-inf", "ABBRUCH: SMTP_MAX_PER_DAY darf nicht negativ sein"),
    ],
)
def test_unlesbares_oder_negatives_tageslimit_bricht_vor_der_umstellung_ab(
    monkeypatch, capsys, tageslimit, meldung
):
    """Ist der Wert keine Zahl, rät das Skript nicht, ob Keycloak Mails verschicken darf: Es
    bricht ab, bevor es den Realm anfasst. Dasselbe bei einem negativen Wert — die Anwendung
    startet mit ihm nicht, also bedeutet er auch hier nicht still „kein Limit“."""
    geschickt, ausgabe = realm_einstellungen(monkeypatch, capsys, tageslimit)

    assert geschickt == []
    assert meldung in ausgabe.err


def test_shell_teil_reicht_das_tageslimit_in_den_container():
    """Das eingebettete Python sieht nur, was `docker compose exec -e …` ihm mitgibt. Mit
    Vorgabe 0: In einer .env aus der Zeit vor ADR-0032 fehlt die Zeile, und unter `set -u`
    bräche das Skript — und mit ihm deploy.sh — sonst an dieser Stelle ab."""
    aufruf = re.search(
        r"^\$COMPOSE exec -T \\\n(.*?)^ +api python - <<'PYTHON'$",
        SKRIPT.read_text("utf-8"),
        re.M | re.S,
    )
    assert aufruf, "Aufruf des eingebetteten Python nicht gefunden"
    assert '    -e SMTP_MAX_PER_DAY="${SMTP_MAX_PER_DAY:-0}" \\' in aufruf.group(1).splitlines()


# ---------- ops/configure_dev_realm.py: dieselbe Regel für den DEV-Realm ----------

DEV_ENV = {
    "SMTP_HOST": "smtp.example.test",
    "SMTP_PORT": "587",
    "SMTP_SECURITY": "starttls",
    "SMTP_USER": "postfach@example.test",
    "SMTP_PASSWORD": "nur-im-test",
    "MAIL_FROM": "postfach@example.test",
}
DEV_MAILSERVER = {**MAILSERVER, "fromDisplayName": "Störungsinfo-Portal (DEV)"}


def dev_realm(
    monkeypatch, capsys, env: dict[str, str], *argumente: str
) -> tuple[int, list[dict], str]:
    """Lässt ops/configure_dev_realm.py gegen eine Keycloak-Attrappe laufen: Rückgabewert, die
    geschickten Realm-Einstellungen und was das Skript ausgibt."""
    ops = str(SKRIPT.parents[2] / "ops")
    monkeypatch.syspath_prepend(ops)
    import configure_dev_realm as skript

    geschickt: list[dict] = []

    def keycloak(request: httpx.Request) -> httpx.Response:
        geschickt.append(json.loads(request.content))
        return httpx.Response(204)

    monkeypatch.setattr(skript, "abort_if_prod", lambda: None)
    monkeypatch.setattr(skript, "load_env", lambda: dict(env))
    monkeypatch.setattr(
        skript, "admin_headers", lambda *a, **k: {"Authorization": "Bearer nur-im-test"}
    )
    monkeypatch.setattr(
        skript.httpx, "Client", lambda **k: ECHTER_CLIENT(transport=httpx.MockTransport(keycloak))
    )
    monkeypatch.setattr("sys.argv", ["configure_dev_realm.py", *argumente])
    code = skript.main()
    ausgabe = capsys.readouterr()
    assert "nur-im-test" not in ausgabe.out + ausgabe.err  # Postfach-Passwort und Token
    return code, geschickt, ausgabe.out + ausgabe.err


@pytest.mark.parametrize("limit", [None, "", "0"])
def test_dev_realm_ohne_tageslimit_sendet_ueber_das_postfach_der_env(monkeypatch, capsys, limit):
    env = dict(DEV_ENV) if limit is None else {**DEV_ENV, "SMTP_MAX_PER_DAY": limit}
    code, (realm,), ausgabe = dev_realm(monkeypatch, capsys, env)
    assert code == 0
    assert realm["resetPasswordAllowed"] is True
    assert realm["smtpServer"] == DEV_MAILSERVER
    assert "Passwort-Reset: AN" in ausgabe


@pytest.mark.parametrize("limit", ["1", "5", "5.0"])
def test_dev_realm_mit_tageslimit_bekommt_keinen_mailserver(monkeypatch, capsys, limit):
    """Sonst gingen Keycloaks Mails (Passwort-Reset) über dasselbe Postfach am Limit vorbei —
    lokal genauso wie auf der Pilot-VM. Alles andere bleibt, wie es ohne Limit ist."""
    _, (ohne_limit,), _ = dev_realm(monkeypatch, capsys, {**DEV_ENV, "SMTP_MAX_PER_DAY": "0"})
    code, (realm,), ausgabe = dev_realm(monkeypatch, capsys, {**DEV_ENV, "SMTP_MAX_PER_DAY": limit})
    assert code == 0
    assert realm["smtpServer"] == {}
    assert realm["resetPasswordAllowed"] is False
    assert _unterschiede(ohne_limit, realm) == {"smtpServer", "resetPasswordAllowed"}
    assert "Passwort-Reset: AUS" in ausgabe and "Tageslimit gesetzt" in ausgabe


def test_dev_realm_mit_tageslimit_verweigert_die_bestaetigungsmail(monkeypatch, capsys):
    code, geschickt, ausgabe = dev_realm(
        monkeypatch, capsys, {**DEV_ENV, "SMTP_MAX_PER_DAY": "5"}, "--verify-email"
    )
    assert (code, geschickt) == (1, [])
    assert "Tageslimit" in ausgabe


@pytest.mark.parametrize(
    ("limit", "meldung"),
    [
        ("fünf", "SMTP_MAX_PER_DAY in der .env ist keine Zahl"),
        ("nan", "SMTP_MAX_PER_DAY in der .env ist keine Zahl"),
        ("inf", "SMTP_MAX_PER_DAY in der .env ist keine Zahl"),
        ("-5", "SMTP_MAX_PER_DAY in der .env darf nicht negativ sein"),
        ("-0.5", "SMTP_MAX_PER_DAY in der .env darf nicht negativ sein"),
        ("-inf", "SMTP_MAX_PER_DAY in der .env darf nicht negativ sein"),
    ],
)
def test_dev_realm_bricht_bei_unlesbarem_oder_negativem_tageslimit_ab(
    monkeypatch, capsys, limit, meldung
):
    """Wie auf der Pilot-VM: Weder ein Tippfehler noch -5 bedeutet still „kein Limit“."""
    code, geschickt, ausgabe = dev_realm(
        monkeypatch, capsys, {**DEV_ENV, "SMTP_MAX_PER_DAY": limit}
    )
    assert (code, geschickt) == (1, [])
    assert meldung in ausgabe
