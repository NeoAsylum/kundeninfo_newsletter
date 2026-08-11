# [ADR-0012] SMTP-Auth-Abstraktion: nur die belegten Verfahren bauen

* **Status:** Akzeptiert
* **Datum:** 2026-08-10 (überarbeitet 2026-08-11)
* **Kontext:** Das Auth-Verfahren des Konzern-Relays ist unklar (Frage B2); interne Relays erlauben typischerweise IP-Allowlist (Port 25, ohne Auth) oder LOGIN (587).

## Entscheidung

Schmale Mailer-Schnittstelle (`app/mail/mailer.py`, eine Klasse) mit zwei Konfigurations-Schaltern: `SMTP_SECURITY = none|starttls|ssl` und `SMTP_AUTH_MODE = none|login`.

Weitere Verfahren sind **benannte, nicht gebaute** Erweiterungspunkte:

* **OAuth2 / Modern Auth (SASL-XOAUTH2)** war zwischenzeitlich implementiert, ist aber wieder entfernt worden. Anlass des Baus war der Versand aus einem privaten Microsoft-Postfach — der scheitert dort grundsätzlich: Bei Consumer-Postfächern ist die SMTP-Clientauthentifizierung mailbox-seitig deaktiviert und für Endnutzer nicht aktivierbar, unabhängig vom Auth-Verfahren (am 2026-08-10 gegen `smtp-mail.outlook.com` verifiziert, `535 5.7.139 basic authentication is disabled`). Damit war der Code im Pilot nie erreichbar, während er Konfigurationsfelder, ein Beschaffungsskript und sieben Tests mitschleppte. Der Pilot versendet über Gmail mit App-Passwort (`login`).
* **Kerberos (GSSAPI + Keytab-Mount)** war von Anfang an nicht gebaut — nur bauen, wenn das Exchange-Team es bestätigt.

## Konsequenzen

* **Positiv:** DEV (Mailpit) ↔ Pilot (Gmail) ↔ PROD (Relay) ist ein reiner `.env`-Wechsel. Kein Code für unbestätigte Szenarien; nichts, was ungetestet mitgepflegt werden muss.
* **Negativ:** Fordert der Relay Kerberos oder Modern Auth, entsteht Nacharbeit — isoliert an genau einer Codestelle, geschätzt 1–2 PT für OAuth2 inklusive App-Registrierung und Token-Refresh.
* **Konsequenz für die Stakeholder-Klärung:** Frage B2 muss den Auth-Mechanismus explizit abfragen. Nutzt der Konzern Exchange Online mit erzwungener Modern Auth, ist der übliche und einfachere Weg ein **interner Relay/Receive-Connector mit IP-Allowlist** (`SMTP_AUTH_MODE=none`) statt OAuth2 in der App.

## Verworfene Alternativen

* **Verfahren vorsorglich bauen und liegen lassen:** genau das war der Zwischenzustand mit OAuth2. Ohne erreichbaren Pfad im Betrieb altert solcher Code unbemerkt, und die Tests prüfen nur, dass er sich selbst treu bleibt.
