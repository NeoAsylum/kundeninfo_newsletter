# [ADR-0007] Mailpit als „Mock-Outlook-Server“

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Der Auftraggeber forderte einen Mock-Outlook/Exchange-Server für Entwicklung und Test (Plan 6.1).

## Entscheidung

**Mailpit** als SMTP-Sink im DEV-Stack: nimmt alles an, stellt nichts zu; Web-UI (Port 8025) zum Sichten; REST-API für automatisierte Test-Assertions; Fehler-Injektion („Chaos“) für Retry-Tests.

## Konsequenzen

* **Positiv:** Protokollechtes SMTP-Verhalten inkl. LOGIN/STARTTLS-Simulation; Integrationstests asserten über die Mailpit-API (Empfängermenge, Betreff, HTML-Inhalt).
* **Einordnung:** Ein Mock kann Kerberos nicht sinnvoll nachbilden (bräuchte KDC/AD). Die Auth-Realität des Konzern-Relays wird per `SMTP_AUTH_MODE` wegkonfiguriert ([ADR-0012]) — damit ist die Vorgabe erfüllt, ohne einen echten Exchange nachzubauen.

## Verworfene Alternativen

* **MailHog:** unmaintained.
* **smtp4dev:** .NET-Runtime, schwerer, keine Fehler-Injektion.
* **Echter Exchange/Dovecot im Container:** massiver Overkill für „Mails ankommen sehen“.
