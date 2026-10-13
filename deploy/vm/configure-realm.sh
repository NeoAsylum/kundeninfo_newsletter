#!/bin/bash
# Passt den importierten Keycloak-Realm an den öffentlichen Betrieb an.
# Wird von deploy.sh aufgerufen; jederzeit erneut ausführbar (idempotent).
#
# Aufgaben:
#  * Redirect-URIs und Web-Origins auf die öffentliche Domain (statt localhost)
#  * Client-Secret aus der .env setzen (das Realm-JSON enthält nur einen Dev-Wert)
#  * Selbstregistrierung (ohne Bestätigungsmail, ADR-0021), Realm-SMTP für Reset-Mails
#    — außer bei gesetztem Tageslimit (SMTP_MAX_PER_DAY > 0, ADR-0032): dann bekommt
#    der Realm keinen Mailserver, und der Passwort-Reset ist abgeschaltet
#  * Brute-Force-Schutz — bei öffentlich erreichbarem Login unverzichtbar
#  * Nur E-Mail und Passwort (ADR-0028): gespeicherte Namen leeren, Benutzerprofil
#    ohne Vor-/Nachname, Client ohne den Scope `profile`. Setzt eine Anwendung voraus,
#    die `profile` nicht mehr anfordert — das Skript prüft das und bricht sonst ab.
#
# Die Adminschnittstelle von Keycloak ist absichtlich nicht von außen erreichbar.
# Deshalb laufen alle Aufrufe INNERHALB des Compose-Netzes, und zwar aus dem
# api-Container: dort sind Python und httpx vorhanden (Keycloak hat kein curl).
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
cd "$REPO_DIR"
set -a; . ./.env; set +a

COMPOSE="docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml"

# SMTP_MAX_PER_DAY mit Vorgabe 0: In einer .env aus der Zeit vor ADR-0032 fehlt die
# Zeile, und `set -u` bräche sonst hier ab.
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
    -e SMTP_MAX_PER_DAY="${SMTP_MAX_PER_DAY:-0}" \
    api python - <<'PYTHON'
import math
import os
import sys
import time

import httpx

KC = "http://keycloak:8081/idp"
REALM = "dev"
host = os.environ["PUBLIC_HOST"]
base = f"https://{host}"

with httpx.Client(timeout=30) as client:
    headers: dict[str, str] = {}
    token_at = 0.0

    def fresh_token() -> None:
        # Admin-Tokens des master-Realms leben 60 Sekunden. Die Schleifen über alle
        # Konten können länger laufen — deshalb vor jedem Schritt prüfen und erneuern.
        global token_at
        if time.monotonic() - token_at < 30:
            return
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
        headers["Authorization"] = f"Bearer {token_response.json()['access_token']}"
        token_at = time.monotonic()

    def all_users() -> list[dict]:
        # Die Admin-API liefert seitenweise. Ohne Blättern blieben Konten jenseits der
        # ersten Seite unbearbeitet: Demo-Konten stünden noch, Namen blieben gespeichert.
        # Erst vollständig einsammeln, dann ändern — Löschen und Umbenennen verschieben
        # die Seiten.
        users: list[dict] = []
        while True:
            fresh_token()
            page = client.get(
                f"{KC}/admin/realms/{REALM}/users",
                headers=headers,
                params={"first": len(users), "max": 200},
            )
            if page.status_code != 200:
                print(f"FEHLER: Kontenliste nicht lesbar (HTTP {page.status_code})", file=sys.stderr)
                sys.exit(1)
            if not page.json():
                return users
            users.extend(page.json())

    fresh_token()

    security = os.environ.get("SMTP_SECURITY", "none")
    realm_settings = {
        # Selbstregistrierung (bewusst offen, Entscheidung des Auftraggebers)
        "registrationAllowed": True,
        "registrationEmailAsUsername": True,
        "loginWithEmailAllowed": True,
        "resetPasswordAllowed": True,
        # Keine Bestätigungsmail (ADR-0021, Auftraggeber-Entscheidung): Registrierung ist
        # damit einen Klick lang. Folge, die man kennen muss: Die Adresse muss niemandem
        # gehören. Im Zielbild mit AD-Anbindung entfällt die Selbstregistrierung ganz,
        # dann gehört auch registrationAllowed auf False.
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
    # Tageslimit (SMTP_MAX_PER_DAY, ADR-0032): Was Keycloak selbst verschickt, geht über
    # dasselbe Postfach, läuft aber am Versand-Worker vorbei und wird nicht mitgezählt.
    # Solange ein Limit gesetzt ist, bekommt der Realm deshalb KEINEN Mailserver (leere
    # Angabe), und der Passwort-Reset, der eine Mail auslöst, ist abgeschaltet. Mit 0
    # gilt wieder der Stand von oben; umgestellt wird bei jedem Lauf dieses Skripts.
    day_limit = os.environ.get("SMTP_MAX_PER_DAY", "").strip() or "0"
    try:
        day_limit_value = float(day_limit)
    except ValueError:
        day_limit_value = math.nan
    # Wie die Anwendung, die mit einem negativen Wert nicht startet: -5 bedeutet nicht
    # still „kein Limit“ — und nan oder inf sind so wenig eine Zahl wie ein Tippfehler.
    if day_limit_value < 0:
        print("ABBRUCH: SMTP_MAX_PER_DAY darf nicht negativ sein (0 = kein Limit).", file=sys.stderr)
        sys.exit(1)
    if not math.isfinite(day_limit_value):
        print(
            "ABBRUCH: SMTP_MAX_PER_DAY ist keine Zahl — ohne sie ist nicht zu entscheiden, "
            "ob Keycloak Mails verschicken darf.",
            file=sys.stderr,
        )
        sys.exit(1)
    limit_set = day_limit_value > 0
    if limit_set:
        realm_settings.update(resetPasswordAllowed=False, smtpServer={})
    response = client.put(f"{KC}/admin/realms/{REALM}", headers=headers, json=realm_settings)
    print(f"Realm-Einstellungen: HTTP {response.status_code}")
    if response.status_code not in (204, 200):
        print(response.text[:400], file=sys.stderr)
        sys.exit(1)
    if limit_set:
        print(
            f"Tageslimit gesetzt (SMTP_MAX_PER_DAY={day_limit}): Realm ohne Mailserver, "
            "Passwort-Reset abgeschaltet — Keycloaks eigene Mails würden nicht mitgezählt"
        )

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
    # Das importierte Realm enthält DEV-Testkonten mit dem bekannten Passwort 'test'.
    # Öffentlich erreichbar könnte sich damit jeder anmelden — und admin1@example.corp
    # würde Admin, wo die Adresse noch in ADMIN_BOOTSTRAP_EMAILS steht und kein Admin
    # existiert. Die Konten werden deshalb bei jedem Deploy gelöscht; verifyEmail
    # schützt hier nicht, weil sie bereits als verifiziert importiert werden.
    removed = 0
    for user in all_users():
        mail = (user.get("email") or "").lower()
        if mail.endswith("@example.corp") or mail.endswith("@example.com"):
            fresh_token()
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
        for u in all_users()
        if (u.get("email") or "").lower().endswith(("@example.corp", "@example.com"))
    ]
    if rest:
        print(f"ABBRUCH: Demo-Konten noch vorhanden: {rest}", file=sys.stderr)
        sys.exit(1)

    # --- Nur E-Mail und Passwort, keine Namen (ADR-0028) ----------------------
    # Ein bestehender Realm wird beim Start NICHT neu importiert (Strategie
    # IGNORE_EXISTING) — was realm-dev.json für frische Importe festlegt, muss hier
    # nachgezogen werden. Die Reihenfolge ist wichtig: Namen ZUERST leeren. Sobald
    # firstName/lastName aus dem Benutzerprofil entfernt sind, zeigt die Admin-API
    # sie nicht mehr an und überschreibt sie auch nicht mehr; sie blieben dann
    # unsichtbar gespeichert.
    #
    # Vorher: Passt die Anwendung dazu? Dieses Skript läuft IM api-Container. Fordert
    # dessen Code den Scope `profile` noch an (Stand vor ADR-0028 oder OIDC_SCOPES mit
    # `profile`), wiese Keycloak nach dem Umbau jede Anmeldung mit invalid_scope ab.
    try:
        from app.core.config import Settings

        app_settings = Settings()
    except Exception as exc:
        print(
            "ABBRUCH vor dem Umbau auf „nur E-Mail und Passwort“: Die Einstellungen der "
            f"laufenden Anwendung sind nicht lesbar ({type(exc).__name__}) — ohne sie ist "
            "nicht zu prüfen, ob sie den Scope 'profile' noch anfordert.",
            file=sys.stderr,
        )
        sys.exit(1)
    # Stand vor ADR-0028: Das Feld gibt es dort nicht, angefragt wird fest mit 'profile'.
    app_scopes = getattr(app_settings, "oidc_scopes", "openid profile email").split()
    if "profile" in app_scopes:
        print(
            "ABBRUCH vor dem Umbau auf „nur E-Mail und Passwort“: Die laufende Anwendung "
            "fordert den Scope 'profile' noch an. Erst die Anwendung ausrollen "
            "(deploy.sh) bzw. OIDC_SCOPES ohne 'profile' setzen.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Mehrere Durchgänge, bis einer nichts mehr findet: Die Registrierung steht offen,
    # während der erste Durchgang läuft — ein Konto, das in dieser Zeit entsteht, trüge
    # seinen Namen sonst über den Profilwechsel hinweg.
    cleared = 0
    for _ in range(5):
        found = 0
        for user in all_users():
            if user.get("firstName") or user.get("lastName"):
                fresh_token()
                response = client.put(
                    f"{KC}/admin/realms/{REALM}/users/{user['id']}",
                    headers=headers,
                    json={"firstName": "", "lastName": ""},
                )
                if response.status_code not in (204, 200):
                    print(
                        f"FEHLER beim Leeren der Namen: HTTP {response.status_code}",
                        file=sys.stderr,
                    )
                    sys.exit(1)
                found += 1
        cleared += found
        if not found:
            break
    print(f"Gespeicherte Namen geleert: {cleared}")

    fresh_token()
    profile = client.get(f"{KC}/admin/realms/{REALM}/users/profile", headers=headers).json()
    profile["attributes"] = [
        a for a in profile["attributes"] if a["name"] not in ("firstName", "lastName")
    ]
    response = client.put(
        f"{KC}/admin/realms/{REALM}/users/profile", headers=headers, json=profile
    )
    print(f"Benutzerprofil ohne Vor-/Nachname: HTTP {response.status_code}")
    if response.status_code not in (204, 200):
        print(response.text[:400], file=sys.stderr)
        sys.exit(1)

    # Der Default-Scope 'profile' hängt die Namens-Claims an JEDES Token, egal welchen
    # scope die Anwendung anfragt — deshalb vom Client nehmen. Ein PUT auf den Client
    # mit "defaultClientScopes" bewirkt das nicht (HTTP 204, aber wirkungslos); es
    # braucht diese Endpunkte. Die optionalen Scopes fallen ebenfalls weg, damit der
    # Client denselben Stand hat wie nach einem frischen Import von realm-dev.json.
    for kind in ("default", "optional"):
        scopes_url = f"{KC}/admin/realms/{REALM}/clients/{uuid}/{kind}-client-scopes"
        fresh_token()
        for scope in client.get(scopes_url, headers=headers).json():
            if kind == "optional" or scope["name"] == "profile":
                fresh_token()
                response = client.delete(f"{scopes_url}/{scope['id']}", headers=headers)
                print(f"  Client-Scope entfernt ({kind}): {scope['name']} — HTTP {response.status_code}")
                if response.status_code not in (204, 200):
                    print(response.text[:400], file=sys.stderr)
                    sys.exit(1)

print(f"Realm konfiguriert für {base}")
PYTHON
