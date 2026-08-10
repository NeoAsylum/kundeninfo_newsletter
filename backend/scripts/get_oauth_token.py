"""Holt einen SMTP-Refresh-Token für Microsoft Modern Auth (ADR-0012, RUNBOOK 3b).

Nutzt den Device-Code-Flow: kein Redirect-URI, kein Client-Secret, keine
lokale Weboberfläche — du bestätigst einmal im Browser, das Skript gibt den
Refresh-Token aus, den du in die .env einträgst.

Voraussetzung: App-Registrierung im Azure-Portal (Anleitung: RUNBOOK 3b).

    python scripts/get_oauth_token.py --client-id <ID> [--tenant consumers]
"""

import argparse
import sys
import time

import httpx

DEFAULT_SCOPE = "https://outlook.office.com/SMTP.Send offline_access"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-id", required=True, help="Anwendungs-ID der Azure-App")
    parser.add_argument(
        "--tenant",
        default="consumers",
        help="'consumers' für private Microsoft-Konten, sonst Tenant-ID (Default: consumers)",
    )
    parser.add_argument("--scope", default=DEFAULT_SCOPE)
    args = parser.parse_args()

    base = f"https://login.microsoftonline.com/{args.tenant}/oauth2/v2.0"

    with httpx.Client(timeout=30) as client:
        start = client.post(
            f"{base}/devicecode",
            data={"client_id": args.client_id, "scope": args.scope},
        )
        if start.status_code != 200:
            print(f"FEHLER beim Device-Code-Start (HTTP {start.status_code}):", file=sys.stderr)
            print(start.text[:600], file=sys.stderr)
            return 1
        flow = start.json()

        print()
        print("=" * 70)
        print("  1. Öffne:", flow["verification_uri"])
        print("  2. Code eingeben:", flow["user_code"])
        print("  3. Mit dem Konto anmelden, dessen Adresse als Absender dient")
        print("=" * 70)
        print()
        print("Warte auf Bestätigung …", flush=True)

        interval = int(flow.get("interval", 5))
        deadline = time.time() + int(flow.get("expires_in", 900))
        while time.time() < deadline:
            time.sleep(interval)
            poll = client.post(
                f"{base}/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": args.client_id,
                    "device_code": flow["device_code"],
                },
            )
            if poll.status_code == 200:
                token = poll.json()
                refresh_token = token.get("refresh_token")
                if not refresh_token:
                    print(
                        "FEHLER: Antwort enthält keinen refresh_token — fehlt 'offline_access' "
                        "im Scope?",
                        file=sys.stderr,
                    )
                    return 1
                print("\nErfolg. Diese Zeilen in die .env übernehmen:\n")
                print("SMTP_AUTH_MODE=oauth2")
                print(f"SMTP_OAUTH_TENANT={args.tenant}")
                print(f"SMTP_OAUTH_CLIENT_ID={args.client_id}")
                print(f"SMTP_OAUTH_REFRESH_TOKEN={refresh_token}")
                print("\n(Der Refresh-Token ist ein Geheimnis — behandle ihn wie ein Passwort.)")
                print("Danach: .\\make.ps1 dev  bzw.  make dev")
                return 0

            error = poll.json().get("error", "")
            if error == "authorization_pending":
                continue
            if error == "slow_down":
                interval += 5
                continue
            print(
                f"\nFEHLER ({error}): {poll.json().get('error_description', '')}", file=sys.stderr
            )
            return 1

    print(
        "\nZeitüberschreitung — Bestätigung im Browser nicht rechtzeitig erfolgt.", file=sys.stderr
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
