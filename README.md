# Self-Service-Portal „Störungsinfos“

Das Portal **Störungsinfos** ersetzt manuelle Outlook-E-Mail-Verteiler des zentralen Problemmanagements durch ein datenbankgestütztes Self-Service-Portal. Mitarbeiter melden sich per Konzern-SSO (OIDC) an und pflegen ihre Benachrichtigungs-Abonnements selbst. Das Problemmanagement versendet Störungs-, Einschränkungs- und Entwarnungsmeldungen über ein Administrations-Portal mit E-Mail-Outbox und Live-Vorschau.

---

## ⚡ Quickstart (< 15 Minuten)

### Voraussetzungen
* Docker Engine & Docker Compose (V2)
* Python 3.12+ und `make` (auf Windows: PowerShell Wrapper `.\make.ps1 <target>`)

### 1. Repository klonen & Dev-Stack starten

```bash
# 1. Repository klonen
git clone <REPO_URL>
cd kundeninfo_newsletter

# 2. Konfigurationsdatei anlegen
cp .env.example .env

# 3. DEV-Stack bauen & starten (NGINX, FastAPI, MariaDB, Keycloak, Mailpit)
make dev
```

Sobald der Command erfolgreich beendet ist, laufen alle 5 Docker-Container im Entwicklungsmodus.

---

## 🌐 Entwicklungs-URLs & Demo-Zugänge

| Dienst | URL | Anmerkung / Demo-Credentials |
|---|---|---|
| **Abo-Self-Service (UI)** | [http://localhost:8080/abos.html](http://localhost:8080/abos.html) | Login via SSO (Keycloak) |
| **Versand-Maske (Admin UI)** | [http://localhost:8080/versand.html](http://localhost:8080/versand.html) | Nur für Benutzer mit Rolle `admin` |
| **Empfänger-Verwaltung (Admin UI)** | [http://localhost:8080/empfaenger.html](http://localhost:8080/empfaenger.html) | Nur für Benutzer mit Rolle `admin` |
| **Datenschutz-Hinweis** | [http://localhost:8080/datenschutz.html](http://localhost:8080/datenschutz.html) | Statische Infoseite (Art. 13 DSGVO) |
| **REST-API Dokumentation** | [http://localhost:8080/docs](http://localhost:8080/docs) | Swagger UI (OpenAPI) |
| **Mailpit Web-UI (Mock-Outlook)** | [http://localhost:8025](http://localhost:8025) | Alle versendeten Mails landen hier |
| **Keycloak Admin Console** | [http://localhost:8081](http://localhost:8081) | Admin: `admin` / `admin` |

### DEV-Testuser (Keycloak Realm `dev`)

Das Passwort für alle DEV-Testuser lautet **`test`**:

* **Mitarbeiter (Standard)**: Username `mitarbeiter1` (E-Mail `mitarbeiter1@example.corp`) · Passwort: **`test`**
* **Problemmanager (Admin)**: Username `admin1` (E-Mail `admin1@example.corp`) · Passwort: **`test`**

---

## ⚙️ Konfiguration

Die Datei [**.env.example**](file:///.env.example) ist die **einzige Konfigurations-Wahrheit** des Projekts. Sie ist vollständig kommentiert.

Wichtige Parameter:
* `DATABASE_URL`: Umschalter zwischen lokaler Docker-DB (`mariadb:3306`) und externer Konzern-DB.
* `OIDC_ISSUER_URL`: Issuer-URL für Entra ID / Keycloak.
* `SMTP_HOST` / `SMTP_PORT`: E-Mail-Relay Endpunkt.
* `AUDIT_SUBSCRIPTIONS`: Schalter für Verhaltensdaten-Protokollierung (`false` im MVP).

---

## 🛠️ Wichtige Makefile-Befehle

| Command | Zweck |
|---|---|
| `make dev` | DEV-Stack vollständig hochfahren (`--build --wait`) |
| `make dev-down` | DEV-Stack stoppen |
| `make check` | CI-Standard lokal ausführen (`lint` + `test`) |
| `make test` | Fast Unit-Tests ausführen (< 30 s) |
| `make test-integration` | Integrationstests gegen echten Docker-Stack inkl. Mailpit |
| `make prod-localdb` | Go-Live-Zustand: PROD mit lokaler Docker-DB starten |
| `make smoke` | Smoke-Test nach Deployment ausführen |

---

## 🔧 Troubleshooting Matrix

| Fehlerbild | Mögliche Ursache | Abhilfe |
|---|---|---|
| `port is already allocated` | Port 8080, 8081 oder 8025 belegt | Belegenden Prozess stoppen oder Ports in `compose.dev.yaml` anpassen. |
| `Keycloak connection refused` | Keycloak-Container startet noch | Keycloak benötigt beim Erststart ~20s; `docker compose logs keycloak` prüfen. |
| Mails erscheinen nicht in Mailpit | E-Mail-Outbox-Worker pausiert | Log des API-Containers prüfen: `make logs SERVICE=api`. |
| Windows CRLF Skriptfehler | Git hat CRLF in Shell-Skripte eingefügt | Git-Attribute prüfen; `dos2unix backend/scripts/entrypoint.sh` ausführen. |
| `403 CSRF Error` bei API-Requests | Header `X-Requested-With` fehlt | Bei manuellen REST-Calls Header `X-Requested-With: fetch` mitsenden. |
| Session abgelaufen / 401 | Secret geändert oder Cookie abgelaufen | Neu über `/auth/login` anmelden oder Cookie im Browser löschen. |

---

## 📚 Weiterführende Dokumentation

* 🏗️ **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Systemarchitektur, Ingress/Egress Firewall-Matrix & Container-Komposition.
* 📖 **[docs/RUNBOOK.md](docs/RUNBOOK.md)** — Betriebs- und Notfallhandbuch (Deploy, Cutover, Backup/Restore, Notfall-Versand).
* ❓ **[docs/open-questions.md](docs/open-questions.md)** — Priorisiertes Register offener Stakeholder-Fragen.
* ⚖️ **[docs/betriebsrat-briefing.md](docs/betriebsrat-briefing.md)** — Betriebsrat- & DSB-Argumentationsunterlage.
* 🔐 **[docs/dsgvo-operations.md](docs/dsgvo-operations.md)** — Prozeduren für Auskunft & Löschung (Art. 15 / 17 DSGVO).
* 📝 **[docs/adr/](docs/adr/)** — Architecture Decision Records (ADRs).
