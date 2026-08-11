#!/bin/bash
# Legt einen Benutzer im öffentlichen Keycloak an — also eine ANMELDUNG, keine
# Berechtigung. Adminrechte vergibt das Portal selbst (Maske „Rollen", ADR-0022);
# den allerersten Admin holt ADMIN_BOOTSTRAP_EMAILS aus der .env (RUNBOOK 6b).
#
#   bash deploy/vm/create-user.sh <email> [--password <pw>] [--name "Vor Nach"]
#
# Läuft über den api-Container, weil die Keycloak-Adminschnittstelle absichtlich
# nicht von außen erreichbar ist (NGINX blockt /idp/admin).
# Ohne --password wird eines erzeugt und ausgegeben; es muss beim ersten Login
# geändert werden.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
cd "$REPO_DIR"
set -a; . ./.env; set +a

EMAIL="${1:?Aufruf: create-user.sh <email> [--password <pw>] [--name \"Vor Nach\"] [--disable|--enable]}"
shift
PASSWORD=""
FULL_NAME=""
SET_ENABLED=""
while [ $# -gt 0 ]; do
    case "$1" in
        # --admin gibt es nicht mehr: Eine Realm-Rolle erteilt keine Portalrechte
        # (ADR-0022). Adminrechte setzt die Maske „Rollen".
        --admin)
            echo "FEHLER: --admin entfällt. Adminrechte vergibt die Maske „Rollen“ im" >&2
            echo "        Portal; der erste Admin kommt über ADMIN_BOOTSTRAP_EMAILS (RUNBOOK 6b)." >&2
            exit 2 ;;
        --password) PASSWORD="${2:?--password braucht einen Wert}"; shift ;;
        --name) FULL_NAME="${2:?--name braucht einen Wert}"; shift ;;
        # Anmeldung sperren/freigeben, ohne den Zugang zu löschen — damit bleiben
        # Abos und Versandhistorie erhalten (z. B. nach einer Demo).
        --disable) SET_ENABLED=false ;;
        --enable) SET_ENABLED=true ;;
        *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
    esac
    shift
done

docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml exec -T \
    -e KC_ADMIN="$KEYCLOAK_ADMIN" \
    -e KC_ADMIN_PW="$KEYCLOAK_ADMIN_PASSWORD" \
    -e NEW_EMAIL="$EMAIL" \
    -e NEW_PASSWORD="$PASSWORD" \
    -e NEW_FULL_NAME="$FULL_NAME" \
    -e SET_ENABLED="$SET_ENABLED" \
    -e PUBLIC_BASE_URL="$PUBLIC_BASE_URL" \
    api python - <<'PYTHON'
import os
import secrets
import sys

import httpx

KC = "http://keycloak:8081/idp"
REALM = "dev"
email = os.environ["NEW_EMAIL"]
password = os.environ.get("NEW_PASSWORD") or secrets.token_urlsafe(12)
must_change = not os.environ.get("NEW_PASSWORD")

# Vor- und Nachname sind im Realm Pflichtfelder: fehlen sie, verlangt Keycloak
# beim Login die Aktion VERIFY_PROFILE und der Anmeldevorgang bleibt stehen.
full_name = os.environ.get("NEW_FULL_NAME") or email.split("@")[0].replace(".", " ").title()
parts = full_name.split(None, 1)
first_name = parts[0]
last_name = parts[1] if len(parts) > 1 else "-"

with httpx.Client(timeout=30) as client:
    token_response = client.post(
        f"{KC}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": os.environ["KC_ADMIN"],
            "password": os.environ["KC_ADMIN_PW"],
        },
    )
    if token_response.status_code != 200:
        print(f"FEHLER: Kein Admin-Token ({token_response.status_code})", file=sys.stderr)
        sys.exit(1)
    headers = {"Authorization": f"Bearer {token_response.json()['access_token']}"}

    existing = client.get(
        f"{KC}/admin/realms/{REALM}/users",
        headers=headers,
        params={"email": email, "exact": "true"},
    ).json()

    # Nur sperren/freigeben, sonst nichts anfassen (sofern kein Passwort-Update angefordert wurde)
    set_enabled = os.environ.get("SET_ENABLED", "")
    if set_enabled in ("true", "false") and not os.environ.get("NEW_PASSWORD"):
        if not existing:
            print(f"FEHLER: {email} existiert nicht", file=sys.stderr)
            sys.exit(1)
        client.put(
            f"{KC}/admin/realms/{REALM}/users/{existing[0]['id']}",
            headers=headers,
            json={"enabled": set_enabled == "true"},
        )
        state = "freigegeben" if set_enabled == "true" else "gesperrt"
        print(f"Anmeldung für {email} {state}.")
        if set_enabled == "false":
            print("Hinweis: Abos und Versandhistorie bleiben erhalten; der Datensatz")
            print("bleibt Empfänger, bis er in der Empfänger-Maske deaktiviert wird.")
        sys.exit(0)
    if existing:
        user_id = existing[0]["id"]
        username = existing[0]["username"]
        print(f"Benutzer existiert (id={user_id}) — aktualisiere Name/Passwort/Status")
        payload = {"firstName": first_name, "lastName": last_name, "emailVerified": True}
        if set_enabled in ("true", "false"):
            payload["enabled"] = set_enabled == "true"
        client.put(
            f"{KC}/admin/realms/{REALM}/users/{user_id}",
            headers=headers,
            json=payload,
        )
    else:
        # registrationEmailAsUsername=true → Benutzername IST die E-Mail
        created = client.post(
            f"{KC}/admin/realms/{REALM}/users",
            headers=headers,
            json={
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": first_name,
                "lastName": last_name,
            },
        )
        if created.status_code not in (201, 204):
            print(f"FEHLER beim Anlegen ({created.status_code}): {created.text[:300]}",
                  file=sys.stderr)
            sys.exit(1)
        user_id = created.headers["location"].rsplit("/", 1)[-1]
        username = email
        print(f"Benutzer angelegt: {email}")

    client.put(
        f"{KC}/admin/realms/{REALM}/users/{user_id}/reset-password",
        headers=headers,
        json={"type": "password", "value": password, "temporary": must_change},
    )
    # Übrig gebliebene Pflichtaktionen entfernen, sonst hängt der Login auf der
    # Passwortänderungsseite (auch wenn ein festes Passwort gesetzt wurde).
    client.put(
        f"{KC}/admin/realms/{REALM}/users/{user_id}",
        headers=headers,
        json={"requiredActions": ["UPDATE_PASSWORD"] if must_change else []},
    )

print()
print("=" * 64)
print(f"  Login:    {username}")
print(f"  Passwort: {password}")
if must_change:
    print("  → muss beim ersten Login geändert werden")
print(f"  Portal:   {os.environ['PUBLIC_BASE_URL']}/abos.html")
print("  Rechte:   Mitarbeiter. Adminrechte in der Maske „Rollen“ vergeben.")
print("=" * 64)
PYTHON
