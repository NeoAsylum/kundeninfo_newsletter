"""Gemeinsame Basis der DEV-Keycloak-Skripte (create_dev_user, configure_dev_realm).

Beide sprechen denselben lokalen Keycloak an und brauchen denselben Schutz gegen
einen versehentlichen Aufruf auf dem öffentlichen Server.
"""

import pathlib
import sys

import httpx

KEYCLOAK = "http://localhost:8081"
REALM = "dev"

_ENV_FILE = pathlib.Path(__file__).resolve().parents[1] / ".env"

_KCADM = (
    "docker compose -f compose.yaml -f compose.db.yaml -f compose.dev.yaml "
    "exec -T keycloak /opt/keycloak/bin/kcadm.sh"
)
HTTPS_HINWEIS = f"""FEHLER: Keycloak lehnt den Admin-Login über http ab ("HTTPS required").
Es hält die Verbindung vom Host für extern (Absenderadresse aus dem Docker-Netz).
Einmal je Keycloak-Container im Container selbst freischalten, dort ist sie lokal:

  {_KCADM} config credentials --server http://localhost:8081 --realm master --user admin --password admin
  {_KCADM} update realms/master -s sslRequired=NONE
"""


def abort_if_prod() -> None:
    """Auf dem öffentlichen Server liegt eine .env mit APP_ENV=prod und echten
    Secrets — ein versehentlicher Aufruf (etwa im SSH-Tunnel) würde dort
    Realm-Einstellungen überschreiben oder Konten anlegen."""
    for candidate in (pathlib.Path.cwd() / ".env", _ENV_FILE):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("APP_ENV=") and "prod" in line:
                print(
                    f"ABBRUCH: {candidate} enthält APP_ENV=prod. Dieses Skript ist nur für "
                    "die Entwicklungsumgebung. Für den Server: deploy/vm/create-user.sh "
                    "bzw. deploy/vm/configure-realm.sh verwenden.",
                    file=sys.stderr,
                )
                raise SystemExit(2)


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = value.strip()
                # Wie Shell und Docker Compose: umschließende Anführungszeichen entfernen
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[key.strip()] = value
    return values


def admin_headers(client: httpx.Client, user: str, password: str) -> dict[str, str]:
    """Master-Realm-Login für die Admin-API. Wirft httpx.HTTPError, wenn Keycloak
    nicht läuft oder die Zugangsdaten falsch sind."""
    response = client.post(
        f"{KEYCLOAK}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": user,
            "password": password,
        },
    )
    if response.status_code == 403 and "HTTPS required" in response.text:
        # Der master-Realm verlangt HTTPS, sobald Keycloak die Verbindung für extern hält.
        # Docker Desktop reicht Host-Verbindungen je nach Netzkonfiguration mit einer
        # nicht-privaten Absenderadresse durch — dann trifft das auch localhost.
        print(HTTPS_HINWEIS, file=sys.stderr)
        raise SystemExit(1)
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
