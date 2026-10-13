# Self-Service-Portal „Störungsinfos“

Das Portal **Störungsinfos** ersetzt manuelle Outlook-E-Mail-Verteiler des zentralen Problemmanagements durch ein datenbankgestütztes Self-Service-Portal. Mitarbeiter melden sich per Konzern-SSO (OIDC) an und pflegen ihre Benachrichtigungs-Abonnements selbst. Das Problemmanagement versendet Störungs-, Einschränkungs- und Entwarnungsmeldungen über ein Administrations-Portal mit E-Mail-Outbox und Live-Vorschau.

---

## 🚀 Live-Instanz (Pilot/Demo)

**https://kunden-stoerungs-info.com**

Öffentlich erreichbarer Pilotbetrieb auf einer eigenen Linux-VM: NGINX mit
Let’s-Encrypt-Zertifikat, FastAPI-Backend, PostgreSQL, Keycloak als IdP unter `/idp`,
echter Mailversand. Vor dem Origin steht Cloudflare (Proxy-Modus); die Server-IP nimmt
HTTPS ausschließlich aus Cloudflare-Netzen an. Aufbau, Betrieb und Absicherung:
[docs/RUNBOOK.md](docs/RUNBOOK.md), Abschnitt 3c.

### Demo-Zugang

Zugangsdaten stehen **nicht** im öffentlichen Repository — sie werden auf Anfrage über
einen privaten Kanal weitergegeben. Die Selbstregistrierung ist offen, ein Zugang lässt
sich also auch selbst anlegen (Adress-Endung frei wählbar).

> ℹ️ Ein früher hier dokumentiertes Demo-Passwort steht noch in der Git-Historie, ist aber
> **rotiert und damit wertlos**. Der Demo-Zugang hat Adminrechte (echte Mails über das
> konfigurierte Postfach, Einsicht aller Empfängeradressen) — deshalb außerhalb von
> Vorführungen den Stack gestoppt halten (`demo-mode.sh stop`) und für Demophasen mit
> `MAIL_REDIRECT_TO=<eigene@adresse>` in der `.env` der VM alle Mails auf eine Adresse
> umleiten.

Zugang nach der Demo sperren (Abos und Historie bleiben erhalten), weitere anlegen:

```bash
ssh root@<vm> 'cd /opt/stoerungsinfo && bash deploy/vm/create-user.sh <mail> --disable'
ssh root@<vm> 'cd /opt/stoerungsinfo && bash deploy/vm/create-user.sh <mail>'
```

### Betrieb nur bei Bedarf

Die Instanz läuft nicht dauerhaft: Außerhalb von Vorführungen wird der Stack gestoppt —
das ist die wirksamste Absicherung, weil dann keine Anmeldung, keine Registrierung und
kein Mailversand möglich sind. Daten bleiben erhalten.

```bash
ssh root@<vm> 'cd /opt/stoerungsinfo && bash deploy/vm/demo-mode.sh start'   # vor der Demo
ssh root@<vm> 'cd /opt/stoerungsinfo && bash deploy/vm/demo-mode.sh stop'    # danach
```

`stop` sichert vorher die Datenbanken, `start` erneuert bei Bedarf das Zertifikat — beide
Cron-Jobs brauchen einen laufenden Stack und kämen bei längeren Pausen sonst nicht zum
Zug. Cloudflare meldet bei gestopptem Stack **521**, das ist erwartet.

---

## ⚡ Quickstart (< 15 Minuten)

### Voraussetzungen
* Docker Engine & Docker Compose (V2)
* Python 3.13 oder 3.14 (Image und CI laufen auf 3.14) und `make` (auf Windows: PowerShell Wrapper `.\make.ps1 <target>`); für
  Lint und Tests einmalig `make install`
* Für `make check`: Node.js 22+ und Edge oder Chrome — die Frontend-Tests laufen im
  Browser ([ADR-0029](docs/adr/0029-frontend-verhaltenstests-mit-playwright.md)); einmalig
  `make install-frontend`

### 1. Repository klonen & Dev-Stack starten

```bash
# 1. Repository klonen
git clone <REPO_URL>
cd kundeninfo_newsletter

# 2. Konfigurationsdatei anlegen
cp .env.example .env

# 3. DEV-Stack bauen & starten (NGINX, FastAPI, PostgreSQL, Keycloak, Mailpit)
make dev
```

Sobald der Command erfolgreich beendet ist, laufen alle 5 Docker-Container im Entwicklungsmodus.

---

## 🌐 Entwicklungs-URLs & Demo-Zugänge

| Dienst | URL | Anmerkung / Demo-Credentials |
|---|---|---|
| **Abo-Self-Service (UI)** | [http://localhost:8080/abos.html](http://localhost:8080/abos.html) | Login via SSO (Keycloak) |
| **Meldungen (UI)** | [http://localhost:8080/meldungen.html](http://localhost:8080/meldungen.html) | Für alle Angemeldeten: verschickte Meldungen aller Verteiler, ohne Empfänger-/Absenderdaten ([ADR-0023](docs/adr/0023-meldungshistorie-fuer-alle.md)) |
| **Versand-Maske (Admin UI)** | [http://localhost:8080/versand.html](http://localhost:8080/versand.html) | Nur für Benutzer mit Rolle `admin` |
| **Empfänger-Verwaltung (Admin UI)** | [http://localhost:8080/empfaenger.html](http://localhost:8080/empfaenger.html) | Nur für Benutzer mit Rolle `admin` |
| **Verteiler-Verwaltung (Admin UI)** | [http://localhost:8080/verteiler.html](http://localhost:8080/verteiler.html) | Nur für Benutzer mit Rolle `admin` — Verteiler anlegen, umbenennen, deaktivieren, löschen ([ADR-0024](docs/adr/0024-verteiler-crud-in-der-oberflaeche.md)) |
| **Rollen-Verwaltung (Admin UI)** | [http://localhost:8080/rollen.html](http://localhost:8080/rollen.html) | Nur für Benutzer mit Rolle `admin` — Adminrechte im Portal vergeben/entziehen ([ADR-0022](docs/adr/0022-adminrechte-im-portal.md)) |
| **Datenschutz-Hinweis** | [http://localhost:8080/datenschutz.html](http://localhost:8080/datenschutz.html) | Statische Infoseite (Art. 13 DSGVO) |
| **REST-API Dokumentation** | [http://localhost:8080/docs](http://localhost:8080/docs) | Swagger UI (OpenAPI) — nur bei `APP_ENV=dev` |
| **Mailpit Web-UI (Mock-Outlook)** | [http://localhost:8025](http://localhost:8025) | Alle versendeten Mails landen hier |
| **Keycloak Admin Console** | [http://localhost:8081](http://localhost:8081) | Admin: `admin` / `admin` |

### Anmelden am Portal

**Selbstregistrierung:** Auf der Anmeldeseite führt ein „Registrieren“-Link direkt zum
Keycloak-Formular. Es fragt nur E-Mail und Passwort ab
([ADR-0028](docs/adr/0028-nur-email-und-passwort.md)). Neue Nutzer sind nach der Registrierung
angemeldet, werden automatisch als Empfänger angelegt und erhalten Pflicht-Verteiler
sofort — Rolle `employee` ([ADR-0021](docs/adr/0021-selbstregistrierung-im-idp.md)). Adminrechte
entstehen dabei nicht, mit einer Ausnahme für Vorführungen: Adressen auf `@demo.invalid` werden
beim Login Admin (Demo-Regel, [RUNBOOK 3c](docs/RUNBOOK.md)). Eine Bestätigungsmail verlangt
Keycloak nur mit `--verify-email` (braucht SMTP in der `.env`); Ein-/Ausschalten und SMTP
setzen: `python ops/configure_dev_realm.py [--verify-email] [--no-registration]`.

**Vorhandene DEV-Testuser** (Realm `dev`, Passwort jeweils **`test`**):

* **Mitarbeiter:** `mitarbeiter1`, `mitarbeiter2` (`*@example.corp`)
* **Problemmanager (Admin):** `admin1` (`admin1@example.corp`)

Diese Adressen existieren nicht — beim Versand über einen echten SMTP-Server erzeugen sie
Unzustellbarkeitsberichte (siehe [RUNBOOK 3b](docs/RUNBOOK.md)).

**Eigenen Account anlegen** (z. B. mit echter Adresse), reproduzierbar nach
jedem Container-Neuaufbau:

```bash
python ops/create_dev_user.py --email <adresse>
```

**Adminrechte kommen ausschließlich aus dem Portal** ([ADR-0022](docs/adr/0022-adminrechte-im-portal.md)):
aus `users.is_admin`, geprüft bei jeder Anfrage. Eine Rolle im IdP bewirkt nichts — deshalb
gibt es an den Konto-Skripten auch kein `--admin` mehr. Wer schon Admin ist, vergibt weitere
Rechte in der Maske „Rollen“. Zum *ersten* Admin führt `ADMIN_BOOTSTRAP_EMAILS` in der `.env`
(im DEV-Standard `admin1@example.corp`): Diese Adressen bekommen das Recht beim Login, aber
nur solange kein aktiver Admin existiert — damit ist die Liste im Normalbetrieb wirkungslos.
Das ist zugleich der Ausweg, falls sich niemand mehr anmelden kann, der Rechte vergeben darf
([RUNBOOK 6b](docs/RUNBOOK.md)).

---

## ⚙️ Konfiguration

Die Datei [**.env.example**](.env.example) ist die **einzige Konfigurations-Wahrheit** des Projekts. Sie ist vollständig kommentiert.

Wichtige Parameter:
* `DATABASE_URL`: Verbindung zur Datenbank — in jeder Umgebung der PostgreSQL-Container `postgres:5432` im Compose-Netz, auch in PROD ([ADR-0030](docs/adr/0030-postgresql-im-container-auch-in-prod.md)).
* `OIDC_ISSUER_URL`: Issuer-URL für Entra ID / Keycloak.
* `SMTP_HOST` / `SMTP_PORT`: E-Mail-Relay Endpunkt.
* `AUDIT_SUBSCRIPTIONS`: Schalter für Verhaltensdaten-Protokollierung (`false` im MVP).

---

## 🛠️ Prozesse: wie man sie anstößt und wo das Ergebnis liegt

Alle Befehle laufen aus dem Wurzelverzeichnis des Repos; unter Windows `.\make.ps1 <target>`
statt `make <target>`. Was ein Target genau ausführt, steht im [`Makefile`](Makefile).

### Prüfen und Testen

| Prozess | Anstoßen | Was geprüft wird, wo das Ergebnis steht | Einzelheiten |
|---|---|---|---|
| **Alles vor dem Abschluss einer Änderung** | `make check` | Lint, Unit-, Frontend- und API-Tests nacheinander; Ergebnis in der Konsole. Die CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) fährt dieselben Schritte bei jedem Push auf `main` und jedem Pull Request, dazu das Abdeckungs-Gate (80 %) und das Konfig-Gate; auf `main` zusätzlich die Integrationstests | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Lint und Typprüfung | `make lint` | ruff und mypy über `backend/` und `ops/governance.py` (Regeln: `backend/pyproject.toml`) | |
| Unit-Tests | `make test` | `backend/tests/unit` — ohne Docker, Datenbank und Netz | |
| API-Tests | `make test-db` | `backend/tests/api` gegen eine Wegwerf-PostgreSQL, die das Target selbst startet (`make test-db-down` stoppt sie) | |
| Frontend-Verhaltenstests | `make test-frontend` | `frontend/tests/*.spec.js` im echten Browser, ohne Server; einmalig `make install-frontend` | [frontend/tests/README.md](frontend/tests/README.md), [ADR-0029](docs/adr/0029-frontend-verhaltenstests-mit-playwright.md) |
| Integrationstests | `make test-integration` | `backend/tests/integration` gegen den ganzen DEV-Stack: Anmeldung über Keycloak, Versand bis zur Mail in Mailpit. Bricht ab, solange die `.env` auf einen echten Mailserver zeigt | [RUNBOOK](docs/RUNBOOK.md) 3b |
| Konfiguration vollständig dokumentiert? | `python backend/scripts/check_env_example.py` | jedes Settings-Feld steht in `.env.example` | |
| Mailserver erreichbar? | `python backend/scripts/check_smtp.py` | Verbindung und Anmeldung am SMTP-Server der `.env` — ohne eine Mail zu senden | [RUNBOOK](docs/RUNBOOK.md) 3b |
| Smoke-Test nach einem Deployment | `make smoke BASE_URL=https://…` | Erreichbarkeit der ausgerollten Instanz, ohne Login und ohne Versand | [RUNBOOK](docs/RUNBOOK.md) 1 |

### Lieferkette und Compliance

| Prozess | Anstoßen | Ergebnis | Einzelheiten |
|---|---|---|---|
| Abhängigkeiten festschreiben | `pip-compile` im Basis-Image (Schritt 1 in RUNBOOK 5b) | `backend/requirements.lock` — jede Version mit Prüfsumme; der Image-Bau installiert nur daraus | [RUNBOOK](docs/RUNBOOK.md) 5b, [ADR-0026](docs/adr/0026-lieferkette-lockfile-sbom.md) |
| **Stücklisten (SBOM) erzeugen** | `make governance` | `docs/governance/stoerungsinfo-app.cdx.json` und je Image `stoerungsinfo-image-<name>.cdx.json` (CycloneDX); lesbar mit Komponenten, Urhebern und Lizenzen: [`KOMPONENTEN.md`](docs/governance/KOMPONENTEN.md) | [docs/governance/](docs/governance/README.md) |
| **Schwachstellenanalyse** | `make governance` (derselbe Lauf) | Bericht mit Bewertung der Lücken CRITICAL, HIGH und ohne Einstufung: [`SCHWACHSTELLEN.md`](docs/governance/SCHWACHSTELLEN.md); alle Funde: `docs/governance/schwachstellen.json` | [RUNBOOK](docs/RUNBOOK.md) 5b |
| Bewertung einer Lücke eintragen | `docs/governance/schwachstellen-bewertung.toml` ändern, dann `python ops/governance.py bericht` | `SCHWACHSTELLEN.md` neu geschrieben, ohne neuen Scan | Kopf der TOML-Datei |
| Scan als Release-Gate | `make scan` | bricht ab, sobald ein Image einen Fund HIGH oder CRITICAL hat; braucht ein lokal installiertes `trivy` und kennt die Bewertungen nicht | Frage B10 im [Register](docs/open-questions.md) |

`make governance` braucht Docker und Netz (gut 1 GB Download) und ist nach jeder Änderung an
Abhängigkeiten oder Basis-Images fällig — `make test` erinnert daran.

### Entwickeln und Betreiben

| Befehl | Zweck |
|---|---|
| `make install` | Lint- und Testwerkzeuge für das Backend installieren (einmalig, nach jedem Anheben erneut) |
| `make dev` / `make dev-down` | DEV-Stack bauen und starten (`--build --wait`) / stoppen |
| `make logs SERVICE=api` | Logs eines Containers |
| `make prod` | PROD-Konfiguration starten (NGINX, FastAPI, PostgreSQL-Container); `make prod-localdb` ist ein zweiter Name dafür |

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
| Keycloak-Admin: `HTTPS required` (403) | Keycloak hält die Verbindung vom Host für extern — Docker Desktop reicht sie je nach Netzkonfiguration mit einer nicht-privaten Absenderadresse durch | Einmal je Keycloak-Container im Container freischalten; die beiden Befehle gibt `python ops/create_dev_user.py` in diesem Fall aus. |

---

## 🌍 Öffentlich deployen

Der Pilotbetrieb im Internet läuft über ein eigenes Compose-Overlay
(`compose.public.yaml`) und drei Skripte — vollständige Anleitung inklusive
Absicherung in [docs/RUNBOOK.md](docs/RUNBOOK.md) Abschnitt 3c:

```bash
# 1. VM grundausstatten: Docker, Swap, Firewall, SSH nur per Schlüssel, fail2ban
scp deploy/vm/bootstrap.sh root@<vm>:/tmp/ && ssh root@<vm> bash /tmp/bootstrap.sh

# 2. DNS: A-Record der Domain auf die VM-IP (bei Cloudflare zunächst "DNS only",
#    sonst schlägt die Zertifikatsausstellung fehl)

# 3. Ausrollen: erzeugt .env mit frischen Secrets, legt die Keycloak-Datenbank an,
#    holt das Zertifikat, konfiguriert den Realm auf die öffentliche Adresse
ssh root@<vm> 'cd /opt/stoerungsinfo && export PUBLIC_HOST=<domain> ACME_EMAIL=<mail> \
    SMTP_HOST=… SMTP_USER=… SMTP_PASSWORD=… MAIL_FROM=… && bash deploy/vm/deploy.sh'

# 4. Origin auf Cloudflare beschränken (erst NACH dem Umschalten auf Proxy-Modus)
ssh root@<vm> 'cd /opt/stoerungsinfo && bash deploy/vm/firewall.sh'
```

Alle Skripte sind idempotent. Nach jeder Firewall-Änderung drei Wege prüfen:
Direktzugriff auf die IP muss scheitern, die Domain muss antworten, SSH muss gehen.

---

## 📚 Wo steht was

* 🏗️ **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Systemarchitektur, Ingress/Egress Firewall-Matrix & Container-Komposition.
* 📖 **[docs/RUNBOOK.md](docs/RUNBOOK.md)** — Betriebs- und Notfallhandbuch (Deploy, Backup/Restore, Notfall-Versand, Lockfile und Stücklisten).
* 📝 **[docs/adr/](docs/adr/)** — Architecture Decision Records (ADRs): warum etwas so gebaut ist.
* 🗒️ **[CHANGELOG.md](CHANGELOG.md)** — was sich geändert hat, je Release und unter *Unreleased*.
* ❓ **[docs/open-questions.md](docs/open-questions.md)** — Priorisiertes Register offener Stakeholder-Fragen.
* 🧾 **[docs/governance/](docs/governance/)** — Compliance-Unterlagen: Stücklisten (SBOM) mit Komponenten, Urhebern und Lizenzen, Ergebnis der Schwachstellenanalyse.
* ⚖️ **[docs/betriebsrat-briefing.md](docs/betriebsrat-briefing.md)** — Betriebsrat- & DSB-Argumentationsunterlage.
* 🔐 **[docs/dsgvo-operations.md](docs/dsgvo-operations.md)** — Prozeduren für Auskunft & Löschung (Art. 15 / 17 DSGVO).
* ⚙️ **[.env.example](.env.example)** — jede Einstellung mit Bedeutung und Vorgabe; die einzige Quelle für die Konfiguration.
* 🧪 **Tests** — `backend/tests/` (unit, api, integration) und `frontend/tests/`; Arbeitsweise und Definition of Done: **[CONTRIBUTING.md](CONTRIBUTING.md)**.
* 📄 **[docs/mvp-umsetzungsplan-stoerungsinfos.md](docs/mvp-umsetzungsplan-stoerungsinfos.md)** — ursprünglicher Umsetzungsplan (Planungsstand, historisch).
