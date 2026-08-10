"""Legt im DEV-Keycloak einen Benutzer an (optional mit Admin-Rolle).

Nur für die Entwicklungs-/Testumgebung: In PROD kommen Benutzer und Rollen
ausschließlich aus dem Konzern-IdP (ADR-0013), diese Skript hat dort keine
Entsprechung. Nötig, weil der Keycloak-Container seinen Datenstand bei
Neuaufbau verliert — Benutzer also reproduzierbar angelegt werden müssen.

    python ops/create_dev_user.py --email <adresse> [--admin] [--password <pw>]

Ohne --password wird ein Zufallspasswort erzeugt und ausgegeben; es muss beim
ersten Login geändert werden.
"""

import argparse
import secrets
import sys

import httpx

KEYCLOAK = "http://localhost:8081"
REALM = "dev"
ADMIN_ROLE = "stoerungsinfo-admin"


def admin_token(client: httpx.Client, user: str, password: str) -> str:
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
    return response.json()["access_token"]


def _abort_if_prod() -> None:
    """Dieses Skript ist nur für die lokale Entwicklung gedacht.

    Auf dem öffentlichen Server liegt eine .env mit APP_ENV=prod und echten
    Secrets — ein versehentlicher Aufruf (etwa im SSH-Tunnel) würde dort
    Realm-Einstellungen überschreiben oder Konten anlegen.
    """
    import pathlib as _p
    import sys as _s

    for candidate in (
        _p.Path.cwd() / ".env",
        _p.Path(__file__).resolve().parents[1] / ".env",
    ):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("APP_ENV=") and "prod" in line:
                print(
                    f"ABBRUCH: {candidate} enthält APP_ENV=prod. Dieses Skript ist nur für "
                    "die Entwicklungsumgebung. Für den Server: deploy/vm/create-user.sh "
                    "bzw. deploy/vm/configure-realm.sh verwenden.",
                    file=_s.stderr,
                )
                raise SystemExit(2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--username", default=None, help="Default: Teil vor dem @")
    parser.add_argument("--first-name", default="")
    parser.add_argument("--last-name", default="")
    parser.add_argument(
        "--admin", action="store_true", help=f"Realm-Rolle {ADMIN_ROLE}"
    )
    parser.add_argument("--password", default=None)
    parser.add_argument("--keycloak-admin", default="admin")
    parser.add_argument("--keycloak-admin-password", default="admin")
    args = parser.parse_args()
    _abort_if_prod()

    username = args.username or args.email.split("@")[0]
    password = args.password or secrets.token_urlsafe(12)
    must_change = args.password is None

    with httpx.Client(timeout=30) as client:
        try:
            token = admin_token(
                client, args.keycloak_admin, args.keycloak_admin_password
            )
        except httpx.HTTPError as exc:
            print(
                f"FEHLER: Keycloak-Admin-Login fehlgeschlagen ({exc}).", file=sys.stderr
            )
            print("Läuft der DEV-Stack? (make dev)", file=sys.stderr)
            return 1
        headers = {"Authorization": f"Bearer {token}"}

        existing = client.get(
            f"{KEYCLOAK}/admin/realms/{REALM}/users",
            headers=headers,
            params={"email": args.email, "exact": "true"},
        ).json()
        if existing:
            user_id = existing[0]["id"]
            # Tatsächlichen Anmeldenamen übernehmen — er kann vom aus der E-Mail
            # abgeleiteten abweichen, und ein falsch angezeigter Name führt in die Irre.
            username = existing[0]["username"]
            print(
                f"Benutzer existiert bereits (id={user_id}) — aktualisiere Passwort/Rolle"
            )
        else:
            create = client.post(
                f"{KEYCLOAK}/admin/realms/{REALM}/users",
                headers=headers,
                json={
                    "username": username,
                    "email": args.email,
                    "emailVerified": True,
                    "enabled": True,
                    "firstName": args.first_name,
                    "lastName": args.last_name,
                },
            )
            if create.status_code not in (201, 204):
                print(
                    f"FEHLER beim Anlegen ({create.status_code}): {create.text}",
                    file=sys.stderr,
                )
                return 1
            user_id = create.headers["location"].rsplit("/", 1)[-1]
            print(f"Benutzer angelegt: {username} <{args.email}> (id={user_id})")

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

        if args.admin:
            role = client.get(
                f"{KEYCLOAK}/admin/realms/{REALM}/roles/{ADMIN_ROLE}", headers=headers
            )
            if role.status_code != 200:
                print(f"FEHLER: Rolle {ADMIN_ROLE} nicht gefunden", file=sys.stderr)
                return 1
            assign = client.post(
                f"{KEYCLOAK}/admin/realms/{REALM}/users/{user_id}/role-mappings/realm",
                headers=headers,
                json=[{"id": role.json()["id"], "name": ADMIN_ROLE}],
            )
            if assign.status_code not in (204, 200):
                print(
                    f"FEHLER bei Rollenzuweisung ({assign.status_code})",
                    file=sys.stderr,
                )
                return 1
            print(f"Rolle zugewiesen: {ADMIN_ROLE}")

    print()
    print("=" * 62)
    print(f"  Login:    {username}   (oder {args.email})")
    print(f"  Passwort: {password}")
    if must_change:
        print("  → muss beim ersten Login geändert werden")
    print("  Portal:   http://localhost:8080/abos.html")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
