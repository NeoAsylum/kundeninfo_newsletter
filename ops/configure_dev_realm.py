"""Konfiguriert den DEV-Keycloak-Realm zur Laufzeit: Selbstregistrierung und SMTP.

Die Flags stehen bereits in deploy/keycloak/realm-dev.json und greifen bei einem
frischen Import. Dieses Skript ist für zwei Fälle:

  * SMTP im Realm setzen, damit Keycloak selbst Mails senden kann
    (Registrierungs-Bestätigung, Passwort-Reset). Die Zugangsdaten kommen aus der
    .env — sie dürfen nicht in die versionierte Realm-Datei.
  * Nachträgliches Ein-/Ausschalten ohne Container-Neuaufbau.

    python ops/configure_dev_realm.py [--verify-email] [--no-registration]

In PROD ohne Entsprechung: dort verwaltet der Konzern-IdP Registrierung und Mails.
"""

import argparse
import sys

import httpx
from _dev_keycloak import KEYCLOAK, REALM, abort_if_prod, admin_headers, load_env


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-email",
        action="store_true",
        help="Bestätigungsmail bei Registrierung verlangen (erfordert SMTP in der .env)",
    )
    parser.add_argument(
        "--no-registration", action="store_true", help="Registrierung abschalten"
    )
    parser.add_argument("--keycloak-admin", default="admin")
    parser.add_argument("--keycloak-admin-password", default="admin")
    args = parser.parse_args()
    abort_if_prod()

    env = load_env()
    smtp_host = env.get("SMTP_HOST", "")
    smtp_user = env.get("SMTP_USER", "")
    smtp_password = env.get("SMTP_PASSWORD", "")
    mail_from = env.get("MAIL_FROM", "")

    registration = not args.no_registration
    updates: dict[str, object] = {
        "registrationAllowed": registration,
        "registrationEmailAsUsername": True,
        "loginWithEmailAllowed": True,
        "resetPasswordAllowed": True,
        "verifyEmail": args.verify_email,
    }

    if smtp_host and smtp_host != "mailpit" and smtp_user:
        updates["smtpServer"] = {
            "host": smtp_host,
            "port": env.get("SMTP_PORT", "587"),
            "starttls": "true" if env.get("SMTP_SECURITY") == "starttls" else "false",
            "ssl": "true" if env.get("SMTP_SECURITY") == "ssl" else "false",
            "auth": "true",
            "user": smtp_user,
            "password": smtp_password,
            "from": mail_from or smtp_user,
            "fromDisplayName": "Störungsinfo-Portal (DEV)",
        }
        smtp_info = f"{smtp_host} als {smtp_user}"
    elif smtp_host == "mailpit":
        updates["smtpServer"] = {
            "host": "mailpit",
            "port": "1025",
            "auth": "false",
            "starttls": "false",
            "ssl": "false",
            "from": mail_from or "keycloak@dev.local",
            "fromDisplayName": "Störungsinfo-Portal (DEV)",
        }
        smtp_info = "mailpit:1025 (Mails landen unter http://localhost:8025)"
    else:
        smtp_info = "nicht gesetzt"
        if args.verify_email:
            print(
                "FEHLER: --verify-email braucht SMTP in der .env, sonst kann Keycloak die "
                "Bestätigungsmail nicht senden und die Registrierung bleibt hängen.",
                file=sys.stderr,
            )
            return 1

    with httpx.Client(timeout=30) as client:
        try:
            headers = admin_headers(
                client, args.keycloak_admin, args.keycloak_admin_password
            )
        except httpx.HTTPError as exc:
            print(
                f"FEHLER: Keycloak nicht erreichbar oder Login falsch ({exc})",
                file=sys.stderr,
            )
            return 1

        update = client.put(
            f"{KEYCLOAK}/admin/realms/{REALM}", headers=headers, json=updates
        )
        if update.status_code not in (204, 200):
            print(f"FEHLER ({update.status_code}): {update.text}", file=sys.stderr)
            return 1

    print(f"Realm '{REALM}' aktualisiert:")
    print(f"  Selbstregistrierung: {'AN' if registration else 'AUS'}")
    print("  E-Mail als Benutzername: AN")
    print(f"  Bestätigungsmail: {'AN' if args.verify_email else 'AUS'}")
    print("  Passwort-Reset: AN")
    print(f"  SMTP im Realm: {smtp_info}")
    print("\nRegistrieren-Link erscheint auf der Login-Seite:")
    print("  http://localhost:8080/auth/login")
    return 0


if __name__ == "__main__":
    sys.exit(main())
