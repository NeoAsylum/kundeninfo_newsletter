# RUNBOOK — Betriebs- und Notfallhandbuch „Störungsinfos“

Dieses Dokument richtet sich an Entwickler und Systemadministratoren zur Durchführung von Deploys, Updates, Backups, Notfall-Maßnahmen und Wartungsarbeiten.

---

## 1. Schnellstart & Deployment (PROD Phase 1: Lokale Docker-DB)

### Erst-Deployment auf der VM

1. **Repository klonen**:
   ```bash
   git clone <REPO_URL> /opt/stoerungsinfo
   cd /opt/stoerungsinfo
   ```
2. **Konfiguration erstellen**:
   ```bash
   cp .env.example .env
   chmod 600 .env
   # .env mit korrekten Werten für PROD anpassen
   ```
3. **PROD-Stack starten**:
   ```bash
   make prod-localdb
   ```
4. **Smoke-Test durchführen**:
   ```bash
   make smoke BASE_URL=https://stoerungsinfo.konzern.example
   ```

---

## 2. Migration zur externen Datenbank (Phase 2 Cutover)

Sobald die zentrale Datenbank-Infrastruktur freigeschaltet ist:

1. **Versand pausieren / Wartungsfenster ankündigen**.
2. **Finalen mysqldump ziehen**:
   ```bash
   ./ops/backup.sh
   ```
3. **Dump auf externer DB einspielen** (durch DB-Betrieb).
4. **`.env` anpassen**:
   `DATABASE_URL` auf externen Host umstellen.
5. **Stack ohne DB-Overlay neu starten**:
   ```bash
   make prod
   ```
6. **Egress-Verbindung & Readyz prüfen**:
   ```bash
   ./ops/check-egress.sh
   curl -fsS https://localhost/readyz
   ```

---

## 3. Backup & Restore (Lokale DB-Phase)

* **Automatisches Backup**: Cron-Job läuft täglich um 02:00 Uhr via `ops/backup.sh`. Dumps werden unter `/var/backups/stoerungsinfo/` mit Dateirechten `600` abgelegt.
* **Restore-Prozedur**:
  ```bash
  gunzip -c /var/backups/stoerungsinfo/dump_YYYYMMDD.sql.gz | \
    docker compose exec -T mariadb mariadb -u app -p<PASSWORD> newsletter
  ```

---

## 3b. Versand über ein echtes Postfach (Abnahme/Demo)

Drei **unabhängige** Schalter in der `.env` — nicht verwechseln:

| Schalter | Bedeutung |
|---|---|
| `MAIL_FROM` / `MAIL_FROM_NAME` | **Absender** der Mails (`From:`-Header) |
| `SMTP_*` | **Wer transportiert** — Mailpit (sammelt, stellt nicht zu) oder ein echter Server |
| `MAIL_REDIRECT_TO` | **Umleitung aller Mails** an eine Adresse statt an die Abonnenten (Default: aus) |

### Absender setzen

Reine Konfiguration, sofort wirksam nach Neustart:

```dotenv
MAIL_FROM=<absender@example.de>
MAIL_FROM_NAME=Störungsinfo (Test)
```

Solange über Mailpit versendet wird, ist jede Absenderadresse erlaubt — Mailpit prüft
nichts. Ein echter Server akzeptiert dagegen nur Absender, die zum authentifizierten
Konto passen (Microsoft antwortet sonst mit `5.7.x`).

### Wirklich zustellen (echter SMTP-Server)

```dotenv
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_AUTH_MODE=login
SMTP_USER=<konto>
SMTP_PASSWORD=<passwort/app-passwort/api-key>
MAIL_FROM=<absender>                # muss zum authentifizierten Konto passen
```

> **Outlook.com / Microsoft 365 funktioniert so NICHT.** Am 2026-08-10 verifiziert:
> `smtp-mail.outlook.com:587` mit App-Passwort antwortet
> `535 5.7.139 Authentication unsuccessful, basic authentication is disabled`.
> Microsoft hat Basic Auth für SMTP AUTH abgeschaltet — App-Passwörter beruhen darauf
> und funktionieren deshalb ebenfalls nicht mehr; für Consumer- und M365-Postfächer ist
> **OAuth2 (Modern Auth, XOAUTH2)** Pflicht. Das ist im MVP bewusst nicht implementiert
> (siehe ADR-0012, Erweiterungspunkt).

Praktikable Wege für einen echten Testversand:

| Weg | Aufwand | Anmerkung |
|---|---|---|
| **Mailpit** (Standard) | keiner | Zustellung nicht nötig, um Inhalt/Empfängerauflösung zu prüfen — Web-UI zeigt jede Mail |
| **Transaktions-Mail-Dienst** (Brevo, Mailjet, SMTP2GO …) | ~15 min | SMTP mit API-Key/Passwort, Free Tier reicht; die eigene Absenderadresse wird per Klick-Mail verifiziert — damit ist Versand *von* der eigenen Adresse möglich |
| **Gmail** mit App-Passwort | ~10 min | funktioniert weiterhin, Absender ist dann die Gmail-Adresse |
| **Konzern-Exchange-Relay** | Antrag | der eigentliche Zielweg — üblicherweise IP-Allowlist ohne Auth (`SMTP_AUTH_MODE=none`), klärt Frage B2 |
| **OAuth2 für Outlook/M365** | 1–2 PT | Azure-App-Registrierung + Token-Handling; nur bauen, wenn der Konzern-Relay es fordert |

**Vorsicht Bounces:** Die Demo-Empfänger (`*@example.corp`) existieren nicht. Beim
Versand über einen echten Server kommen für jeden davon Unzustellbarkeitsberichte
zurück. Vor einem echten Test entweder nur an einen Verteiler mit erreichbaren
Adressen senden oder die Demo-Empfänger lokal umschreiben:

```sql
-- lokale DEV-DB, reversibel:
UPDATE users SET email = '<echte@adresse.de>' WHERE oidc_sub = 'seed-demo-1';
```

### Umleitung (nur wenn gewünscht)

`MAIL_REDIRECT_TO=<zieladresse>` schickt **alle** Mails an diese eine Adresse; die
Versandhistorie behält die echten Empfänger, jede Mail trägt zusätzlich
`X-Original-Recipient`. Nützlich für Demos, ohne reale Verteiler anzuschreiben —
erzeugt aber weiterhin **eine Mail je Empfänger** und flutet bei großen Verteilern
das Zielpostfach. **In Produktion leer lassen.**

**Immer:** Nach `.env`-Änderungen neu starten (`make dev` bzw. `make prod-localdb`) —
die Konfiguration wird beim Start gelesen. Nach Codeänderungen zusätzlich `--build`,
weil Code und Frontend ins Image gebacken sind.

## 4. Notfall-Versand bei Systemausfall

Fällt während einer Großstörung das Portal, die DB oder der IdP aus:

1. **Empfängerlisten-Export**: Tägliche Exporte liegen unter `/var/backups/stoerungsinfo/recipients_*.csv`.
2. **Manueller Versand**: Das Problemmanagement versendet die Benachrichtigung manuell über Outlook / Funktionspostfach an die exportierte CSV-Verteilerliste.

---

## 5. Secret- & Zertifikats-Management

* **Notfall-Session-Invalidierung**: Falls ein Secret kompromittiert wurde, `SESSION_SECRET` in `.env` ändern und `make prod` ausführen. Alle aktiven Sessions werden sofort ungültig.
* **Zertifikatsablauf**: Das Ablaufdatum des TLS-Zertifikats wird über `/readyz` überwacht (Warnung bei < 30 Tagen Restlaufzeit).

---

## 6. Topic-Pflege per SQL (ADR-016)

Neue Topics oder Beschreibungsänderungen werden direkt in der Datenbank gepflegt:

```sql
-- Neues Topic anlegen
INSERT INTO topics (id, name, description, is_mandatory, is_active)
VALUES ('sap-hr', 'SAP HR Störungen', 'Benachrichtigungen zu HR-Systemen', 0, 1);

-- Topic deaktivieren (wird sofort im UI ausgeblendet)
UPDATE topics SET is_active = 0 WHERE id = 'interflex';
```

---

## 7. Störungsbehebung (Troubleshooting Matrix)

| Symptom | Mögliche Ursache | Diagnose-Befehl | Maßnahme |
|---|---|---|---|
| `/readyz` zeigt `degraded` (outbox) | Stau unversendeter Mails | `docker compose logs api` | Relay-Erreichbarkeit prüfen, Rate-Limit prüfen |
| Login schlägt fehl (502) | IdP nicht erreichbar / OIDC-Secret falsch | `curl -vk $OIDC_ISSUER_URL` | Zertifikate, Proxy-Einstellungen & Secret prüfen |
| Platte voll | Docker Logs / Backup-Verzeichnis zu groß | `df -h`, `docker system df` | Pruning durchführen, alte Dumps aufräumen |
