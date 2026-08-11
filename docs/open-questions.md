# Register offener Fragen (Stand 2026-08-11)

Dieses Register dokumentiert alle offenen organisatorischen, technischen und regulatorischen Fragen an die Stakeholder.

---

## Kategorie A — Blockiert das MVP (Fachkonzept & Abnahme)

| # | Frage | Adressat | Status | Antworten / Quelle |
|---|---|---|---|---|
| A1 | Muss das Pflicht-Topic **alle Mitarbeiter** erreichen oder genügen angemeldete Portal-Nutzer (JIT)? Falls alle: Woher kommt die vollständige Adressliste? | Auftraggeber / Konzern-IT | Offen | Ist in Woche 1 zu klären. |
| A2 | Wer darf die Versand-Maske nutzen? | IAM-Team | **Beantwortet (2026-08-11, Auftraggeber):** weder Entra App-Rolle noch AD-Gruppe — die Berechtigung führt das Portal selbst (`users.is_admin`, ADR-0022). Für das IAM-Team bleibt nur die Authentisierung. | Rollen aus dem Token werden nicht gelesen; `ADMIN_ROLE_VALUE`/`OIDC_ROLES_CLAIM` sind entfallen. |
| A3 | Welche Absenderadresse (Funktionspostfach) und welches Reply-To-Verhalten sollen Störungsmails haben? | Problemmanagement | Offen | Standard `MAIL_FROM` in `.env` hinterlegt. |
| A4 | Mengengerüste: Empfänger gesamt, je Topic, Versandhäufigkeit? | Auftraggeber | Offen | Beeinflusst `SMTP_MAX_PER_MINUTE`. |
| A5 | Welche Verfügbarkeitsanforderung (RTO) gilt für das Portal während Großstörungen? | IT-Betrieb / Risk | Offen | Notfall-Versand-Prozedur in RUNBOOK vorbereitet. |
| A6 | Soll die **Adminrolle aus dem IdP weiterhin gelten**, oder ist allein das Portal zuständig? | Auftraggeber | **Beantwortet (2026-08-11): allein das Portal.** Umgesetzt in ADR-0022. | **Folgepflicht für den Betrieb:** Ein Offboarding im Verzeichnisdienst entzieht das Adminrecht nicht mehr automatisch — es muss im Portal nachgezogen werden (Empfänger deaktivieren oder Recht entziehen). Gehört in die Betriebsübergabe und in ein Berechtigungsreview. |

---

## Kategorie B — Blockiert den Go-Live (Parallel klärbar dank DEV-Mocks)

| # | Frage | Adressat | Status |
|---|---|---|---|
| B1 | IdP konkret: Entra ID / Keycloak / ADFS? Prozess & Ansprechpartner für App-Registrierung. | IAM-Team | Offen |
| B2 | Relay: Hostname, Port (25/587), IP-Allowlist-Verfahren — und vor allem das **Auth-Verfahren**: interner Receive-Connector ohne Auth (bevorzugt), Basic Auth, oder erzwingt Exchange Online **Modern Auth/OAuth2**? Hintergrund: Microsoft hat Basic Auth für SMTP AUTH abgeschaltet (am 2026-08-10 an einem Consumer-Konto verifiziert: `535 5.7.139`); OAuth2 in der App ist bewusst nicht gebaut und wäre ~1–2 PT Nacharbeit (ADR-0012). Zusätzlich: Rate-/Empfänger-/Größenlimits. | Exchange-Team | Offen |
| B3 | Externe DB: MySQL oder MariaDB, Version, TLS-Pflicht, User-Rechte & Cutover-Termin. | DB-Betrieb | Offen |
| B4 | Proxy-Zwang für ausgehendes HTTPS & Zertifikatsprozess der Konzern-PKI. | Netzwerk / Security | Offen |
| B5 | Betriebsrat (§87 BetrVG Mitbestimmung, Pflicht-Abo Zulässigkeit, Audit-Log Schalter). | Betriebsrat / HR | Offen |
| B6 | Datenschutz: Retention-Fristen für `dispatch_recipients`, Art.-13-Hinweis & Art.-30-Eintrag. | DSB | Offen |
| B7 | Betriebs-Owner der Linux-VM (OS-Patching, Log-Rotation, Backup-Verantwortung). | IT-Betrieb | Offen |
| B8 | Registry & CI-Runner Verfügbarkeit. | DevOps | Offen |
| B9 | Change-Prozess & CMDB App-ID Registrierung. | Change Mgmt | Offen |
| B10 | Security-Freigabe (Pentest / Schwachstellenscan Slots). | InfoSec | Offen |
| B11 | Aufbewahrung der **für alle sichtbaren Meldungshistorie** (Teilfrage zu B6): Wie lange bleiben versendete Meldungen im Portal lesbar? `dispatches` überlebt die Retention bislang dauerhaft (Datenquelle für Dashboards, ADR-0014) — mit der Leseansicht für alle (ADR-0023) ist das keine reine Betriebsentscheidung mehr. Keine Frist gesetzt, bis B6 beantwortet ist. | DSB / Betriebsrat | Offen |
