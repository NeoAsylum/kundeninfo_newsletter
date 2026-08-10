# Register offener Fragen (Stand 2026-08-10)

Dieses Register dokumentiert alle offenen organisatorischen, technischen und regulatorischen Fragen an die Stakeholder.

---

## Kategorie A — Blockiert das MVP (Fachkonzept & Abnahme)

| # | Frage | Adressat | Status | Antworten / Quelle |
|---|---|---|---|---|
| A1 | Muss das Pflicht-Topic **alle Mitarbeiter** erreichen oder genügen angemeldete Portal-Nutzer (JIT)? Falls alle: Woher kommt die vollständige Adressliste? | Auftraggeber / Konzern-IT | Offen | Ist in Woche 1 zu klären. |
| A2 | Wer darf die Versand-Maske nutzen (Entra App-Rolle vs. AD-Gruppe)? | IAM-Team | Offen | `ADMIN_ROLE_VALUE` ist per `.env` konfigurierbar. |
| A3 | Welche Absenderadresse (Funktionspostfach) und welches Reply-To-Verhalten sollen Störungsmails haben? | Problemmanagement | Offen | Standard `MAIL_FROM` in `.env` hinterlegt. |
| A4 | Mengengerüste: Empfänger gesamt, je Topic, Versandhäufigkeit? | Auftraggeber | Offen | Beeinflusst `SMTP_MAX_PER_MINUTE`. |
| A5 | Welche Verfügbarkeitsanforderung (RTO) gilt für das Portal während Großstörungen? | IT-Betrieb / Risk | Offen | Notfall-Versand-Prozedur in RUNBOOK vorbereitet. |

---

## Kategorie B — Blockiert den Go-Live (Parallel klärbar dank DEV-Mocks)

| # | Frage | Adressat | Status |
|---|---|---|---|
| B1 | IdP konkret: Entra ID / Keycloak / ADFS? Prozess & Ansprechpartner für App-Registrierung. | IAM-Team | Offen |
| B2 | Relay Hostname, Port (25/587), Auth-Verfahren & IP-Allowlist-Verfahren. | Exchange-Team | Offen |
| B3 | Externe DB: MySQL oder MariaDB, Version, TLS-Pflicht, User-Rechte & Cutover-Termin. | DB-Betrieb | Offen |
| B4 | Proxy-Zwang für ausgehendes HTTPS & Zertifikatsprozess der Konzern-PKI. | Netzwerk / Security | Offen |
| B5 | Betriebsrat (§87 BetrVG Mitbestimmung, Pflicht-Abo Zulässigkeit, Audit-Log Schalter). | Betriebsrat / HR | Offen |
| B6 | Datenschutz: Retention-Fristen für `dispatch_recipients`, Art.-13-Hinweis & Art.-30-Eintrag. | DSB | Offen |
| B7 | Betriebs-Owner der Linux-VM (OS-Patching, Log-Rotation, Backup-Verantwortung). | IT-Betrieb | Offen |
| B8 | Registry & CI-Runner Verfügbarkeit. | DevOps | Offen |
| B9 | Change-Prozess & CMDB App-ID Registrierung. | Change Mgmt | Offen |
| B10 | Security-Freigabe (Pentest / Schwachstellenscan Slots). | InfoSec | Offen |
