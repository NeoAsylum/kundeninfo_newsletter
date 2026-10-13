"""Legt im DEV-Keycloak einen Benutzer an — nur E-Mail und Passwort (ADR-0028).

Nur für die Entwicklungs-/Testumgebung: In PROD kommen Benutzer ausschließlich
aus dem Konzern-IdP. Nötig, weil der DEV-Keycloak seinen Datenstand bei Neuaufbau
verliert.

    python ops/create_dev_user.py --email <adresse> [--password <pw>]

Legt eine ANMELDUNG an, keine Berechtigung: Adminrechte vergibt das Portal selbst
(Maske „Rollen", ADR-0022). Den ersten Admin holt ADMIN_BOOTSTRAP_EMAILS aus der
.env — im DEV-Standard ist das admin1@example.corp.

Ohne --password wird ein Zufallspasswort erzeugt und ausgegeben; es muss beim
ersten Login geändert werden.
"""

import argparse
import secrets
import sys

import httpx
from _dev_keycloak import KEYCLOAK, REALM, abort_if_prod, admin_headers


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", default=None)
    parser.add_argument("--keycloak-admin", default="admin")
    parser.add_argument("--keycloak-admin-password", default="admin")
    args = parser.parse_args()
    abort_if_prod()

    password = args.password or secrets.token_urlsafe(12)
    must_change = args.password is None

    with httpx.Client(timeout=30) as client:
        try:
            headers = admin_headers(
                client, args.keycloak_admin, args.keycloak_admin_password
            )
        except httpx.HTTPError as exc:
            print(
                f"FEHLER: Keycloak-Admin-Login fehlgeschlagen ({exc}).", file=sys.stderr
            )
            print("Läuft der DEV-Stack? (make dev)", file=sys.stderr)
            return 1

        existing = client.get(
            f"{KEYCLOAK}/admin/realms/{REALM}/users",
            headers=headers,
            params={"email": args.email, "exact": "true"},
        ).json()
        if existing:
            user_id = existing[0]["id"]
            print(f"Benutzer existiert bereits (id={user_id}) — aktualisiere Passwort")
        else:
            create = client.post(
                f"{KEYCLOAK}/admin/realms/{REALM}/users",
                headers=headers,
                # registrationEmailAsUsername: Der Anmeldename IST die E-Mail — Keycloak
                # speichert sie als username, egal was hier stünde.
                json={
                    "username": args.email,
                    "email": args.email,
                    "emailVerified": True,
                    "enabled": True,
                },
            )
            if create.status_code not in (201, 204):
                print(
                    f"FEHLER beim Anlegen ({create.status_code}): {create.text}",
                    file=sys.stderr,
                )
                return 1
            user_id = create.headers["location"].rsplit("/", 1)[-1]
            print(f"Benutzer angelegt: {args.email} (id={user_id})")

        reset = client.put(
            f"{KEYCLOAK}/admin/realms/{REALM}/users/{user_id}/reset-password",
            headers=headers,
            json={"type": "password", "value": password, "temporary": must_change},
        )
        if reset.status_code not in (204, 200):
            print(
                f"FEHLER beim Passwort setzen ({reset.status_code}): {reset.text}",
                file=sys.stderr,
            )
            return 1

        # requiredActions explizit setzen: Ein früheres temporäres Passwort hinterlässt
        # UPDATE_PASSWORD, das beim Überschreiben mit einem festen Passwort bestehen
        # bleibt — der Login landet dann dauerhaft auf der Passwortänderungs-Seite.
        client.put(
            f"{KEYCLOAK}/admin/realms/{REALM}/users/{user_id}",
            headers=headers,
            json={"requiredActions": ["UPDATE_PASSWORD"] if must_change else []},
        )

    print()
    print("=" * 62)
    print(f"  Login:    {args.email}")
    print(f"  Passwort: {password}")
    if must_change:
        print("  → muss beim ersten Login geändert werden")
    print("  Portal:   http://localhost:8080/abos.html")
    if args.email.endswith("@demo.invalid"):
        # Demo-Regel der Testmaschine (DEMO_ADMIN_SUFFIX in app/domain/users.py)
        print(
            "  Rechte:   ADMIN ab der ersten Anmeldung (Adress-Endung @demo.invalid)."
        )
    else:
        print("  Rechte:   Mitarbeiter. Adminrechte in der Maske „Rollen“ vergeben.")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
