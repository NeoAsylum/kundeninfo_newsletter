"""Integrationstests (Plan 8.4): beweisen die Container-Komposition, nicht erneut
die Fachlichkeit. Voraussetzung: laufender DEV-Stack (make dev / make test-integration).

Der Login läuft ECHT gegen Keycloak (Formular-Roundtrip) — damit ist der komplette
BFF-Flow inkl. Split-Horizon-Setup (Plan 5.5) abgedeckt.
"""

import html
import os
import pathlib
import re

import httpx
import pytest

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
MAILPIT_URL = os.environ.get("MAILPIT_URL", "http://localhost:8025")

pytestmark = pytest.mark.integration


@pytest.fixture(scope="session", autouse=True)
def stack_muss_laufen():
    try:
        response = httpx.get(f"{BASE_URL}/healthz", timeout=5)
        response.raise_for_status()
    except Exception:
        pytest.skip(f"DEV-Stack unter {BASE_URL} nicht erreichbar — vorher 'make dev' ausführen")


def _groesser_null(wert: str) -> bool:
    try:
        return float(wert) > 0
    except ValueError:
        # Leer oder keine Zahl: Damit läuft die Anwendung ohne Limit oder startet gar nicht.
        return False


def hindernisse_in_der_env(zeilen: list[str]) -> list[str]:
    """Was in der .env gegen einen Lauf der Integrationstests spricht — je Einstellung ein
    Satz, der sie beim Namen nennt. Leer, wenn nichts dagegen spricht."""
    hindernisse = []
    for line in zeilen:
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        # Wie Shell und Docker Compose: Umschließende Anführungszeichen gehören nicht zum Wert.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key == "SMTP_HOST" and value not in ("mailpit", ""):
            hindernisse.append(
                f"SMTP_HOST='{value}' — Integrationstests würden echte Mails versenden. "
                "Erst auf 'mailpit' zurückstellen."
            )
        # Die Adresse selbst bleibt aus der Meldung heraus.
        if key == "MAIL_REDIRECT_TO" and value:
            hindernisse.append(
                "MAIL_REDIRECT_TO ist gesetzt — jede Mail ginge an die Umleitungsadresse, und "
                "die Tests fänden ihre Empfänger nicht. Erst leeren."
            )
        if key == "SMTP_MAX_PER_DAY" and _groesser_null(value):
            hindernisse.append(
                f"SMTP_MAX_PER_DAY={value} — das Tageslimit ließe die Versände der Tests "
                "scheitern, sobald es erreicht ist. Erst auf 0 zurückstellen."
            )
    return hindernisse


@pytest.fixture(scope="session", autouse=True)
def kein_echter_mailversand():
    """Schutz vor echtem Versand: Die Tests legen Störungsmeldungen an reale
    Verteiler an. Zeigt der Stack auf einen echten SMTP-Server (Testbetrieb mit
    Outlook o. ä., RUNBOOK 3b), gingen Mails nach außen und für jede
    Demo-Adresse käme ein Unzustellbarkeitsbericht zurück.

    Umleitung und Tageslimit desselben Testbetriebs ließen die Tests auch mit Mailpit
    scheitern, ohne dass die Fehlermeldung die Ursache nennt — deshalb derselbe Abbruch.
    """
    env_file = pathlib.Path(__file__).resolve().parents[3] / ".env"
    if not env_file.exists():
        return
    hindernisse = hindernisse_in_der_env(env_file.read_text(encoding="utf-8").splitlines())
    if hindernisse:
        pytest.exit(
            "ABBRUCH: Die .env passt nicht zu den Integrationstests (RUNBOOK 3b):\n  "
            + "\n  ".join(hindernisse)
            + "\nDanach 'make dev' und erneut testen.",
            returncode=2,
        )


def _allow_secure_cookies_over_http(client: httpx.Client) -> None:
    """Keycloak markiert Login-Cookies als Secure (SameSite=None-Pflicht). Browser
    akzeptieren das auf localhost (trustworthy origin), Pythons Cookie-Jar sendet
    Secure-Cookies aber nie über http — fürs DEV-Testsetup abschalten."""
    for cookie in client.cookies.jar:
        cookie.secure = False


def keycloak_login(client: httpx.Client, username: str, password: str) -> None:
    """Voller BFF-Roundtrip: /auth/login → Keycloak-Formular → /auth/callback → Session."""
    response = client.get(f"{BASE_URL}/auth/login", follow_redirects=False)
    assert response.status_code == 302, f"Login-Redirect fehlt: {response.status_code}"
    authorize_url = response.headers["location"]

    login_page = client.get(authorize_url, follow_redirects=True)
    _allow_secure_cookies_over_http(client)
    match = re.search(r'action="([^"]+)"', login_page.text)
    assert match, "Keycloak-Loginformular nicht gefunden"
    form_action = html.unescape(match.group(1))

    submit = client.post(
        form_action,
        data={"username": username, "password": password},
        follow_redirects=False,
    )
    assert submit.status_code in (302, 303), f"Keycloak-Login fehlgeschlagen: {submit.status_code}"
    callback_url = submit.headers["location"]
    assert "/auth/callback" in callback_url

    callback = client.get(callback_url, follow_redirects=False)
    assert callback.status_code == 302, f"Callback fehlgeschlagen: {callback.text[:300]}"
    assert client.cookies.get("session"), "Session-Cookie wurde nicht gesetzt"


@pytest.fixture
def http():
    def _client() -> httpx.Client:
        return httpx.Client(timeout=15, headers={"X-Requested-With": "fetch"})

    return _client


@pytest.fixture
def mailpit():
    class Mailpit:
        def clear(self) -> None:
            httpx.delete(f"{MAILPIT_URL}/api/v1/messages", timeout=10)

        def search(self, query: str) -> list[dict]:
            response = httpx.get(
                f"{MAILPIT_URL}/api/v1/search", params={"query": query, "limit": 200}, timeout=10
            )
            response.raise_for_status()
            return response.json().get("messages", [])

        def message_html(self, message_id: str) -> str:
            response = httpx.get(f"{MAILPIT_URL}/api/v1/message/{message_id}", timeout=10)
            response.raise_for_status()
            return response.json().get("HTML", "")

    return Mailpit()
