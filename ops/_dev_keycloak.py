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
                values[key.strip()] = value.strip()
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
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
