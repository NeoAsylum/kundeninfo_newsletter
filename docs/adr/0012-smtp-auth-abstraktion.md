# [ADR-0012] SMTP-Auth-Abstraktion mit reserviertem Kerberos-Adapter

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Auth-Verfahren des Konzern-Relays unklar (Frage B2); interne Relays erlauben typischerweise IP-Allowlist (Port 25, ohne Auth) oder LOGIN (587) (Plan 5.2/6.2).

## Entscheidung

Schmale Mailer-Schnittstelle (`app/mail/mailer.py`, eine Klasse) mit Konfigurations-Schaltern: `SMTP_SECURITY = none|starttls|ssl`, `SMTP_AUTH_MODE = none|login|oauth2`.

**`oauth2` ist gebaut** (nachträglich ergänzt, 2026-08-10): Microsoft hat Basic Auth für SMTP AUTH abgeschaltet — am selben Tag gegen `smtp-mail.outlook.com` verifiziert, Benutzername/Passwort **und App-Passwörter** werden mit `535 5.7.139 basic authentication is disabled` abgelehnt. Ohne OAuth2 ist damit kein Versand aus einem Microsoft-Postfach möglich, was den geforderten Testversand aus dem Postfach des Problemmanagements blockiert hätte. Umsetzung: SASL-XOAUTH2, Access-Token wird aus einem konfigurierten Refresh-Token geholt und im Prozess gecacht; die Token-Beschaffung läuft einmalig über `scripts/get_oauth_token.py` (Device-Code-Flow, kein Client-Secret, kein Redirect-URI).

`kerberos` (GSSAPI + Keytab-Mount) bleibt ein **benannter, nicht gebauter** Erweiterungspunkt — nur bauen, wenn das Exchange-Team es bestätigt.

## Konsequenzen

* **Positiv:** DEV (Mailpit) ↔ PROD (Relay) ist ein reiner `.env`-Wechsel; keine Spekulation über die Relay-Realität im Code.
* **Negativ:** Falls das Relay Kerberos oder OAuth2 fordert, entsteht Nacharbeit — dann aber isoliert an genau einer Codestelle (geschätzt 1–2 PT für OAuth2 inkl. Azure-App-Registrierung und Token-Refresh).
* **Konsequenz für die Stakeholder-Klärung:** Frage B2 muss explizit den Auth-Mechanismus abfragen. Nutzt der Konzern Exchange Online mit erzwungener Modern Auth, ist der übliche und einfachere Weg ein **interner Relay/Receive-Connector mit IP-Allowlist** (`SMTP_AUTH_MODE=none`) statt OAuth2 in der App.

## Verworfene Alternativen

* **Kerberos/GSSAPI oder OAuth2 vorsorglich bauen:** Testinfrastruktur (KDC bzw. Azure-App-Registrierung) und Token-/Keytab-Handling für unbestätigte Szenarien; der Zielweg ist voraussichtlich der interne Relay ohne Auth.
