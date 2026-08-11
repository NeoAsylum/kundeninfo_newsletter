#!/bin/bash
# Passt den importierten Keycloak-Realm an den öffentlichen Betrieb an.
# Wird von deploy.sh aufgerufen; jederzeit erneut ausführbar (idempotent).
#
# Aufgaben:
#  * Redirect-URIs und Web-Origins auf die öffentliche Domain (statt localhost)
#  * Client-Secret aus der .env setzen (das Realm-JSON enthält nur einen Dev-Wert)
#  * Selbstregistrierung + Bestätigungsmail, Realm-SMTP für diese Mails
#  * Brute-Force-Schutz — bei öffentlich erreichbarem Login unverzichtbar
#
# Die Adminschnittstelle von Keycloak ist absichtlich nicht von außen erreichbar.
# Deshalb laufen alle Aufrufe INNERHALB des Compose-Netzes, und zwar aus dem
# api-Container: dort sind Python und httpx vorhanden (Keycloak hat kein curl).
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
cd "$REPO_DIR"
set -a; . ./.env; set +a

COMPOSE="docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml"

$COMPOSE exec -T \
    -e KC_ADMIN="$KEYCLOAK_ADMIN" \
    -e KC_ADMIN_PW="$KEYCLOAK_ADMIN_PASSWORD" \
    -e PUBLIC_HOST="$PUBLIC_HOST" \
    -e OIDC_CLIENT_ID="$OIDC_CLIENT_ID" \
    -e OIDC_CLIENT_SECRET="$OIDC_CLIENT_SECRET" \
    -e SMTP_HOST="$SMTP_HOST" \
    -e SMTP_PORT="$SMTP_PORT" \
    -e SMTP_SECURITY="$SMTP_SECURITY" \
    -e SMTP_AUTH_MODE="$SMTP_AUTH_MODE" \
    -e SMTP_USER="$SMTP_USER" \
    -e SMTP_PASSWORD="$SMTP_PASSWORD" \
    -e MAIL_FROM="$MAIL_FROM" \
    api python - <<'PYTHON'
import os
import sys

import httpx

KC = "http://keycloak:8081/idp"
REALM = "dev"
host = os.environ["PUBLIC_HOST"]
base = f"https://{host}"

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
        print(token_response.text[:300], file=sys.stderr)
        sys.exit(1)
    headers = {"Authorization": f"Bearer {token_response.json()['access_token']}"}

    security = os.environ.get("SMTP_SECURITY", "none")
    realm_settings = {
        # Selbstregistrierung (bewusst offen, Entscheidung des Auftraggebers)
        "registrationAllowed": True,
        "registrationEmailAsUsername": True,
        "loginWithEmailAllowed": True,
        "resetPasswordAllowed": True,
        # Bestätigungsmail: Für Demos deaktiviert (Instant-Login nach Registrierung ohne Wartezeit)
        "verifyEmail": False,
        # Brute-Force-Schutz: bei öffentlichem Login unverzichtbar
        "bruteForceProtected": True,
        "permanentLockout": False,
        "failureFactor": 10,
        "waitIncrementSeconds": 60,
        "maxFailureWaitSeconds": 900,
        "sslRequired": "all",
        "smtpServer": {
            "host": os.environ.get("SMTP_HOST", ""),
            "port": os.environ.get("SMTP_PORT", "587"),
            "starttls": "true" if security == "starttls" else "false",
            "ssl": "true" if security == "ssl" else "false",
            "auth": "true" if os.environ.get("SMTP_AUTH_MODE") == "login" else "false",
            "user": os.environ.get("SMTP_USER", ""),
            "password": os.environ.get("SMTP_PASSWORD", ""),
            "from": os.environ.get("MAIL_FROM", ""),
            "fromDisplayName": "Störungsinfo-Portal",
        },
    }
    response = client.put(f"{KC}/admin/realms/{REALM}", headers=headers, json=realm_settings)
    print(f"Realm-Einstellungen: HTTP {response.status_code}")
    if response.status_code not in (204, 200):
        print(response.text[:400], file=sys.stderr)
        sys.exit(1)

    client_id = os.environ["OIDC_CLIENT_ID"]
    found = client.get(
        f"{KC}/admin/realms/{REALM}/clients", headers=headers, params={"clientId": client_id}
    ).json()
    if not found:
        print(f"FEHLER: Client '{client_id}' nicht im Realm", file=sys.stderr)
        sys.exit(1)
    uuid = found[0]["id"]

    client_settings = {
        "redirectUris": [f"{base}/auth/callback"],
        "webOrigins": [base],
        "attributes": {"post.logout.redirect.uris": f"{base}/*"},
        "publicClient": False,
        "secret": os.environ["OIDC_CLIENT_SECRET"],
    }
    response = client.put(
        f"{KC}/admin/realms/{REALM}/clients/{uuid}", headers=headers, json=client_settings
    )
    print(f"Client-Redirects/Secret: HTTP {response.status_code}")
    if response.status_code not in (204, 200):
        print(response.text[:400], file=sys.stderr)
        sys.exit(1)

    check = client.get(f"{KC}/admin/realms/{REALM}/clients/{uuid}", headers=headers).json()
    print(f"  redirectUris: {check['redirectUris']}")
    print(f"  webOrigins:   {check['webOrigins']}")

    # --- Demo-Benutzer entfernen (sicherheitskritisch) ------------------------
    # Das importierte Realm enthält DEV-Testkonten mit dem Passwort 'test' — eines
    # davon (admin1@example.corp) mit Adminrolle. Öffentlich erreichbar wäre das
    # eine offene Tür zur Versandmaske und zur gesamten Empfängerliste. Die Konten
    # werden deshalb bei jedem Deploy gelöscht; verifyEmail schützt hier nicht, weil
    # sie bereits als verifiziert importiert werden.
    removed = 0
    users = client.get(
        f"{KC}/admin/realms/{REALM}/users", headers=headers, params={"max": 500}
    ).json()
    for user in users:
        mail = (user.get("email") or "").lower()
        if mail.endswith("@example.corp") or mail.endswith("@example.com"):
            delete = client.delete(
                f"{KC}/admin/realms/{REALM}/users/{user['id']}", headers=headers
            )
            if delete.status_code in (204, 200):
                removed += 1
                print(f"  Demo-Benutzer entfernt: {mail}")
            else:
                print(f"  FEHLER beim Entfernen von {mail}: {delete.status_code}",
                      file=sys.stderr)
    print(f"Demo-Benutzer entfernt: {removed}")

    # Absicherung: Es darf kein Konto mit Beispiel-Domain übrig bleiben
    rest = [
        u.get("email")
        for u in client.get(
            f"{KC}/admin/realms/{REALM}/users", headers=headers, params={"max": 500}
        ).json()
        if (u.get("email") or "").lower().endswith(("@example.corp", "@example.com"))
    ]
    if rest:
        print(f"ABBRUCH: Demo-Konten noch vorhanden: {rest}", file=sys.stderr)
        sys.exit(1)

print(f"Realm konfiguriert für {base}")
PYTHON
