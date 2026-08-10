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

## 3b. Testversand an ein echtes Postfach (Abnahme/Demo)

Für Abnahmen soll der Versand in einem echten Postfach ankommen, ohne dass reale
Verteiler angeschrieben werden. Zwei unabhängige Schalter in der `.env`:

1. **Umleitung** — `MAIL_REDIRECT_TO=<zieladresse>`: Alle Mails gehen an diese eine
   Adresse. Die Versandhistorie behält die echten Empfänger; jede Mail trägt den
   Header `X-Original-Recipient`. Achtung: Es wird weiterhin **eine Mail je
   Empfänger** erzeugt — bei großen Verteilern flutet das das Zielpostfach.
2. **Echter SMTP-Server** — Mailpit stellt nichts zu, für echte Zustellung braucht es
   einen erreichbaren Server, z. B. für ein Microsoft-Konto:

   ```dotenv
   SMTP_HOST=smtp-mail.outlook.com
   SMTP_PORT=587
   SMTP_SECURITY=starttls
   SMTP_AUTH_MODE=login
   SMTP_USER=<konto@outlook.de>
   SMTP_PASSWORD=<App-Passwort, NICHT das Kontopasswort>
   MAIL_FROM=<konto@outlook.de>          # muss zum authentifizierten Konto passen
   MAIL_REDIRECT_TO=<konto@outlook.de>
   ```

   Das App-Passwort wird unter `account.microsoft.com` → Sicherheit erzeugt und
   erfordert aktivierte Zwei-Faktor-Authentifizierung. Outlook.com drosselt bei
   ~300 Mails/Tag.

**Wichtig:** Nach jeder `.env`-Änderung neu starten (`make dev` bzw.
`make prod-localdb`) — Konfiguration wird beim Start gelesen. Läuft der Stack mit
eingebackenem Code, muss das Image nach Codeänderungen neu gebaut werden (`--build`).
Zum Zurückschalten auf Mailpit die SMTP-Zeilen und `MAIL_REDIRECT_TO` wieder leeren.

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
