# [ADR-0012] SMTP-Auth-Abstraktion mit reserviertem Kerberos-Adapter

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Auth-Verfahren des Konzern-Relays unklar (Frage B2); interne Relays erlauben typischerweise IP-Allowlist (Port 25, ohne Auth) oder LOGIN (587) (Plan 5.2/6.2).

## Entscheidung

Schmale Mailer-Schnittstelle (`app/mail/mailer.py`, eine Klasse) mit Konfigurations-Schaltern: `SMTP_SECURITY = none|starttls|ssl`, `SMTP_AUTH_MODE = none|login`. `kerberos` ist ein **benannter, bewusst nicht gebauter** Erweiterungspunkt (GSSAPI + Keytab-Mount hinter derselben Schnittstelle) — wird erst gebaut, wenn das Exchange-Team es bestätigt.

## Konsequenzen

* **Positiv:** DEV (Mailpit) ↔ PROD (Relay) ist ein reiner `.env`-Wechsel; keine Spekulation über die Relay-Realität im Code.
* **Negativ:** Falls das Relay tatsächlich Kerberos fordert, entsteht Nacharbeit — dann aber isoliert an genau einer Codestelle.

## Verworfene Alternativen

* **Kerberos/GSSAPI vorsorglich bauen:** KDC-Testinfrastruktur und Keytab-Handling für ein unbestätigtes Szenario.
