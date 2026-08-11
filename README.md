# Self-Service-Portal „Störungsinfos“

Das Portal **Störungsinfos** ersetzt manuelle Outlook-E-Mail-Verteiler des zentralen Problemmanagements durch ein datenbankgestütztes Self-Service-Portal. Mitarbeiter melden sich per Konzern-SSO (OIDC) an und pflegen ihre Benachrichtigungs-Abonnements selbst. Das Problemmanagement versendet Störungs-, Einschränkungs- und Entwarnungsmeldungen über ein Administrations-Portal mit E-Mail-Outbox und Live-Vorschau.

---

## 🚀 Live-Instanz (Pilot/Demo)

**https://kunden-stoerungs-info.com**

Öffentlich erreichbarer Pilotbetrieb auf einer eigenen Linux-VM: NGINX mit
Let’s-Encrypt-Zertifikat, FastAPI-Backend, MariaDB, Keycloak als IdP unter `/idp`,
echter Mailversand. Vor dem Origin steht Cloudflare (Proxy-Modus); die Server-IP nimmt
HTTPS ausschließlich aus Cloudflare-Netzen an. Aufbau, Betrieb und Absicherung:
[docs/RUNBOOK.md](docs/RUNBOOK.md), Abschnitt 3c.

### Demo-Zugang

| | |
|---|---|
| Benutzer | `plaaslinkadrian@gmail.com` |
| Passwort | `Demo-Stoerungsinfo-2026` |
| Rechte | Mitarbeiter **und** Admin (Abo-Maske, Versand, Empfänger-Verwaltung) |

> ⚠️ **Dieses Repository ist öffentlich.** Damit sind diese Zugangsdaten nach einem
> `git push` im Netz auffindbar — inklusive der Adresse des Portals, das damit
> administriert werden kann. Vor dem Push entweder das Repository auf privat
> umstellen oder das Passwort hier entfernen und separat weitergeben.

**Was der Admin-Zugang kann** — vor der Weitergabe abwägen:

* **alle Empfängeradressen einsehen** (bei offener Selbstregistrierung auch fremde,
  personenbezogene Adressen),
* **echte Mails an alle Abonnenten verschicken**, über das konfigurierte Postfach und auf
  dessen Tageskontingent,
* **Empfänger deaktivieren** und damit vom Versand ausschließen.

Eingrenzung für Demophasen: `MAIL_REDIRECT_TO=<eigene@adresse>` in der `.env` der VM
setzen — dann landen alle Mails ausschließlich dort, die Historie zeigt weiterhin die
gedachten Empfänger, und niemand Fremdes wird angemailt.

Zugang nach der Demo sperren (Abos und Historie bleiben erhalten):

```bash
ssh root@<vm> 'cd /opt/stoerungsinfo && \
    bash deploy/vm/create-user.sh plaaslinkadrian@gmail.com --disable'
```

Weitere Zugänge anlegen: `bash deploy/vm/create-user.sh <mail> --admin --name "Vor Nach"`
(ohne `--password` wird eines erzeugt, das beim ersten Anmelden geändert werden muss).

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
| **REST-API Dokumentation** | [http://localhost:8080/docs](http://localhost:8080/docs) | Swagger UI (OpenAPI) — nur bei `APP_ENV=dev` |
| **Mailpit Web-UI (Mock-Outlook)** | [http://localhost:8025](http://localhost:8025) | Alle versendeten Mails landen hier |
| **Keycloak Admin Console** | [http://localhost:8081](http://localhost:8081) | Admin: `admin` / `admin` |

### Anmelden am Portal

**Selbstregistrierung:** Auf der Anmeldeseite führt ein „Registrieren“-Link direkt zum
Keycloak-Formular (E-Mail dient als Benutzername). Neue Nutzer sind nach der Registrierung
angemeldet, werden automatisch als Empfänger angelegt und erhalten Pflicht-Verteiler
sofort — Rolle `employee`, keine Adminrechte ([ADR-0021](docs/adr/0021-selbstregistrierung-im-idp.md)).
Ist Realm-SMTP konfiguriert, verlangt Keycloak eine Bestätigungsmail; Ein-/Ausschalten und
SMTP setzen: `python ops/configure_dev_realm.py [--verify-email] [--no-registration]`.

**Vorhandene DEV-Testuser** (Realm `dev`, Passwort jeweils **`test`**):

* **Mitarbeiter:** `mitarbeiter1`, `mitarbeiter2` (`*@example.corp`)
* **Problemmanager (Admin):** `admin1` (`admin1@example.corp`)

Diese Adressen existieren nicht — beim Versand über einen echten SMTP-Server erzeugen sie
Unzustellbarkeitsberichte (siehe [RUNBOOK 3b](docs/RUNBOOK.md)).

**Eigenen Account anlegen** (z. B. mit echter Adresse und Adminrechten), reproduzierbar nach
jedem Container-Neuaufbau:

```bash
python ops/create_dev_user.py --email <adresse> --admin
```

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

## 📚 Weiterführende Dokumentation

* 🏗️ **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Systemarchitektur, Ingress/Egress Firewall-Matrix & Container-Komposition.
* 📖 **[docs/RUNBOOK.md](docs/RUNBOOK.md)** — Betriebs- und Notfallhandbuch (Deploy, Cutover, Backup/Restore, Notfall-Versand).
* ❓ **[docs/open-questions.md](docs/open-questions.md)** — Priorisiertes Register offener Stakeholder-Fragen.
* ⚖️ **[docs/betriebsrat-briefing.md](docs/betriebsrat-briefing.md)** — Betriebsrat- & DSB-Argumentationsunterlage.
* 🔐 **[docs/dsgvo-operations.md](docs/dsgvo-operations.md)** — Prozeduren für Auskunft & Löschung (Art. 15 / 17 DSGVO).
* 📝 **[docs/adr/](docs/adr/)** — Architecture Decision Records (ADRs).
