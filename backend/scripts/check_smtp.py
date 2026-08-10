"""Prüft die SMTP-Konfiguration aus der .env: Verbindung, TLS, Auth — OHNE Versand.

Nützlich, um Zugangsdaten zu verifizieren, bevor ein Versand angelegt wird, und
später um den Konzern-Relay zu testen (Frage B2).

    python backend/scripts/check_smtp.py [--send-to <adresse>]

--send-to schickt zusätzlich EINE Testmail an die angegebene Adresse.
"""

import argparse
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _load_env() -> None:
    """Liest die .env aus dem Repo-Root in die Umgebung (nur fehlende Schlüssel)."""
    import os

    env_file = pathlib.Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        print(f"FEHLER: {env_file} nicht gefunden", file=sys.stderr)
        raise SystemExit(1)
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send-to", default=None, help="Optional: eine Testmail hierhin")
    args = parser.parse_args()

    _load_env()
    from app.core.config import Settings
    from app.mail.mailer import Mailer

    settings = Settings()  # type: ignore[call-arg]
    print(f"Host:        {settings.smtp_host}:{settings.smtp_port}")
    print(f"Verschlüss.: {settings.smtp_security}")
    print(
        f"Auth-Modus:  {settings.smtp_auth_mode}"
        + (f" (User: {settings.smtp_user})" if settings.smtp_user else "")
    )
    print(f"Absender:    {settings.mail_from_name} <{settings.mail_from}>")
    if settings.mail_redirect_to:
        print(f"UMLEITUNG:   alle Mails an {settings.mail_redirect_to}")
    print()

    mailer = Mailer(settings)
    try:
        smtp = await mailer.open()
    except Exception as exc:
        print(f"[FAIL] Verbindung/Auth fehlgeschlagen:\n       {type(exc).__name__}: {exc}")
        print("\nHäufige Ursachen:")
        print("  535 5.7.139 / 5.7.3  → Passwort statt App-Passwort, oder der Anbieter")
        print("                         erlaubt keine Passwort-Auth (Outlook.com)")
        print("  Timeout              → Port/Firewall; Relay-Freischaltung fehlt")
        print("  TLS-Fehler           → SMTP_SECURITY passt nicht zum Port (587=starttls,")
        print("                         465=ssl, 25=none)")
        return 1

    print("[OK  ] Verbindung steht, Authentifizierung akzeptiert")

    if args.send_to:
        try:
            message = mailer.build_message(
                args.send_to,
                "Störungsinfo-Portal: SMTP-Testmail",
                "<p>Diese Testmail bestätigt die SMTP-Konfiguration.</p>",
                "Diese Testmail bestätigt die SMTP-Konfiguration.",
            )
            await mailer.send(smtp, message)
            print(f"[OK  ] Testmail an {args.send_to} übergeben")
        except Exception as exc:
            print(f"[FAIL] Versand abgelehnt: {type(exc).__name__}: {exc}")
            await mailer.close(smtp)
            return 1

    await mailer.close(smtp)
    print("\nSMTP-KONFIGURATION OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
