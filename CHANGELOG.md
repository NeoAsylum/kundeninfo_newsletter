# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) · Versionierung: SemVer light (`v0.x.y` im MVP, `v1.0.0` zum Produktivgang).

## [Unreleased]

### Anwendung

- **Meldungen (für alle):** Nachschlagesicht über die verschickten Störungs- und Entwarnungsmeldungen unter `/meldungen.html`, mit Verteiler-Filter und Blättern. Eigener Endpunkt `GET /api/v1/dispatches` mit reduziertem Schema statt Freigabe der Admin-Historie: keine Empfängerzahlen, keine Zustell-/Fehlerzähler, kein Absender — Zähler wären Auswertungsdaten über Empfänger (ADR-0014), der Absender ein personenbezogenes Datum eines Beschäftigten (ADR-0023). Sichtbar sind nur abgeschlossene Versände, dafür die aller Verteiler (bei einer Großstörung ist der Blick auf das Nachbarsystem der Punkt der Ansicht).
- **Verteiler-Verwaltung (Admin):** Anlegen, Umbenennen, Beschreibung und Pflicht-Kennzeichen ändern, Deaktivieren/Reaktivieren und Löschen unter `/verteiler.html` — löst die RUNBOOK-SQL-Prozedur als Regelweg ab (ADR-0024, löst ADR-0016 ab). Der Slug bleibt unveränderlich (Primärschlüssel mit Referenzen), Löschen geht nur ohne Versandhistorie (sonst Deaktivieren, die Historie ist unveränderlich), Umbenennen ist bei laufendem Versand gesperrt (der Worker rekonstruiert den Titel über den aktuellen Verteilernamen aus dem Betreff). Jede Änderung im Audit-Log, inklusive der Zahl beim Löschen verlorener Abos.
- **Rollen-Verwaltung (Admin):** Adminrechte im Portal vergeben und entziehen unter `/rollen.html`. Das Recht steht ab jetzt **allein** in `users.is_admin` (ADR-0022, löst ADR-0013 dafür ab); Rollen aus dem IdP-Token werden nicht mehr gelesen, `OIDC_ROLES_CLAIM` und `ADMIN_ROLE_VALUE` sind entfallen. Ein Entzug wirkt sofort, weil die Autorisierung bei jeder Anfrage die Datenbank liest statt das Session-Cookie — auch gegenüber einem noch gültigen Cookie. Selbstentzug ist gesperrt (Aussperr-Schutz).
  - **Kehrseite für den Betrieb:** Eine Deaktivierung im Verzeichnisdienst entzieht das Adminrecht nicht mehr von selbst. Offboarding läuft über das Portal (Empfänger deaktivieren oder Recht entziehen).
  - **Erster Admin:** Migration 0003 übernimmt, wer belegbar bereits als Admin gehandelt hat (Ersteller von Versänden, Akteure im Audit-Log — mit Zeitachsen-Prüfung, weil E-Mail-Adressen recycelt werden). Darüber hinaus `ADMIN_BOOTSTRAP_EMAILS`: gelistete Adressen bekommen beim Login das Recht, aber nur solange kein aktiver Admin existiert. Damit ist die Liste im Normalbetrieb wirkungslos und taugt nicht als Hintertür (RUNBOOK 6b).
  - Der Schalter `--admin` in `deploy/vm/create-user.sh` und `ops/create_dev_user.py` ist entfallen: Ein IdP-Konto anzulegen vergibt keine Rechte mehr.

### Dokumentation

- Drei neue ADRs (0022 Adminrechte im Portal, 0023 Meldungshistorie für alle, 0024 Verteiler-CRUD); ADR-0016 abgelöst, ADR-0013 teilweise abgelöst, ADR-0017 um die neuen Audit-Aktionen erweitert.
- RUNBOOK 6 auf die Oberfläche umgeschrieben, SQL bleibt als Notfallweg (ohne Audit-Eintrag); neuer Abschnitt 6b: per SQL wieder an Adminrechte kommen.
- Betriebsrat-Briefing um die für alle sichtbare Meldungshistorie und die neuen Audit-Aktionen ergänzt; zwei neue Punkte im Fragenregister (Geltung der IdP-Rolle, Aufbewahrung der Lesehistorie).

## [0.1.0] — MVP mit öffentlichem Pilotbetrieb

Erster funktionsfähiger Stand: Selbstverwaltung der Verteiler statt händisch gepflegter
Outlook-Postfächer, betrieben unter <https://kunden-stoerungs-info.com> (Demo-Betrieb, siehe README).

### Anwendung

- **Abo-Maske:** Verteiler mit Toggles, Pflicht-Verteiler mit Badge und Schloss, Auto-Save mit Rollback bei Fehlern.
- **Versand-Maske:** Ziel-Verteiler mit Empfängerzahl, Schweregrad (Störung/Einschränkung/Entwarnung), Betreff-Automatik mit Titel-Zähler (max. 150), E-Mail-Live-Vorschau aus dem echten Template, Versandhistorie mit Status-Polling.
- **Empfänger-Verwaltung (Admin), verteiler-zentriert:** erst Verteiler per Dropdown wählen, dann aktive Empfänger per E-Mail-Filter durchsuchen und das Abonnement pro Zeile per Checkbox pflegen. Pflicht-Verteiler zeigen alle aktiven Empfänger mit gesperrter Checkbox (implizites Abo, ADR-0009). Deaktivieren/Reaktivieren per API (`PATCH /api/v1/admin/users/{id}`, Selbst-Deaktivierung gesperrt; erneuter SSO-Login reaktiviert — Offboarding-Semantik, ADR-0010). Bewusst ohne Verhaltensdaten (`last_login_at`) im UI (offene Frage B5).
- **Versandpfad:** DB-Outbox + asyncio-Worker mit atomarem Claiming, Fortschritts-Heartbeat, Stale-Recovery und Retry mit Backoff. Einzelmails pro Empfänger (ADR-0005) über eine wiederverwendete SMTP-Verbindung; Jinja2-Templates HTML+Plaintext, Outlook-tauglich, Farbbalken je Schweregrad, Footer ohne Tracking.
- **Selbstregistrierung über den IdP:** „Registrieren“-Link auf der Anmeldeseite (Keycloak, E-Mail als Benutzername, optional mit Bestätigungsmail). Neue Nutzer werden im Portal automatisch als Empfänger angelegt und erhalten Pflicht-Verteiler sofort — bewusst ohne eigene Registrierungsmaske und Passwortverwaltung im Portal (ADR-0021).
- **Test-Umleitung `MAIL_REDIRECT_TO`:** leitet alle ausgehenden Mails an eine einzelne Adresse um (Default aus). Die Historie behält die echten Empfänger, jede Mail trägt `X-Original-Recipient`.

### Plattform

- **SSO per OIDC/BFF** (Authorization Code + PKCE) gegen konfigurierbaren IdP; Fernet-verschlüsseltes HttpOnly-Session-Cookie ohne Session-Store; CSRF-Schutz über SameSite=Lax + Pflichtheader `X-Requested-With`; JIT-Provisioning mit E-Mail-Kollisionsbehandlung; Logout mit IdP-End-Session.
- **Datenmodell** (users, topics, subscriptions, dispatches, dispatch_recipients, audit_log) ausschließlich über Alembic-Migrationen inkl. Topic-Seed; Pflicht-Topics implizit ohne Abo-Zeilen (ADR-0009).
- **Docker-Stack mit Compose-Schichtung:** `compose.yaml` (Basis) + `compose.db.yaml` (lokale DB) + `compose.dev.yaml` (Keycloak/Mailpit) + `compose.prod.yaml` (TLS, Limits) + `compose.public.yaml` (öffentlicher Pilot). Aufruf über `Makefile` bzw. `make.ps1` auf Windows.
- **Health-Endpunkte** `/healthz` (Liveness, Version/Git-SHA) und `/readyz` (DB, SMTP, Outbox-Rückstau); Retention-Cleanup als Konfigwert, Default aus.
- **Test-Suite:** Unit (ohne Docker), API gegen MariaDB-tmpfs, Integration gegen den echten Stack inklusive Keycloak-Login-Roundtrip und E2E-Versand mit Mailpit-Assertions; Coverage-Gate 80 % auf `app/domain` + `app/mail`; Smoke-Test nach Deploy.
- **Dokumentation:** README (Quickstart), ARCHITECTURE, RUNBOOK, 21 ADRs, DSGVO-Operations, Betriebsrat-Briefing, Fragenregister, CONTRIBUTING.

### Öffentlicher Pilotbetrieb

- **Deploy auf die Linux-VM** (`deploy/vm/deploy.sh`): Images auf der VM gebaut (ADR-0008), TLS von Let's Encrypt mit automatischer Erneuerung, Keycloak unter `/idp` mit MariaDB-Backend, Datenbank-Dump vor jedem Ausrollen.
- **Demo-Betriebsschalter** (`deploy/vm/demo-mode.sh start|stop|status`): Ein gestoppter Stack hat keine Angriffsfläche. `stop` sichert vorher die Datenbanken, `start` erneuert das Zertifikat bei unter 30 Tagen Restlaufzeit — beide Cron-Jobs brauchen einen laufenden Stack und kämen bei längeren Pausen sonst nicht zum Zug. Nach VM-Neustart kommen Container und Paketfilter von allein zurück.
- **Paketfilter** (`deploy/vm/firewall.sh`): Port 443 nur aus Cloudflare-Bereichen (IPv4+IPv6, mit Zwischenspeicher als Rückfall), SSH mit Verbindungsbremse, Port 80 bewusst offen für die Zertifikatsprüfung. Die Regeln liegen in einer eigenen iptables-Kette in `DOCKER-USER`, weil Docker veröffentlichte Ports per DNAT an ufw vorbeischleust; Persistenz über eine systemd-Unit nach `docker.service`.
- **Echte Client-IP hinter Cloudflare** (`deploy/nginx/includes/cloudflare-real-ip.inc`): ohne diese Zuordnung sähen die Ratenlimits nur Cloudflare-Adressen — echte Nutzer hätten sich gegenseitig ausgesperrt, ein Angreifer hätte sich über mehrere Standorte verteilt. `deploy/vm/update-cloudflare-ranges.sh` aktualisiert Bereichsliste und Firewall in einem Schritt.
- **Zugriff auf `/idp` per Allowlist statt Blockliste:** nur Anmelde-, Registrierungs-, Protokoll- und Theme-Pfade des Realms sind erreichbar; Adminkonsole, Admin-API, `master`-Realm, Metriken und Health enden mit 404. Eine Regex-Blockliste war per Matrix-Parameter umgehbar (`/idp/admin;x/...`).
- **Ratenlimits** für Registrierung und Passwort-Reset (dort löst jeder Aufruf eine Mail über Keycloak selbst aus, an `SMTP_MAX_PER_MINUTE` vorbei), moderatere Limits für die übrigen Anmeldeschritte, Verbindungslimit pro IP.
- **Demo-Konten werden bei jedem Deploy entfernt:** der importierte DEV-Realm enthält Testnutzer mit dem Passwort `test`, einer davon mit Adminrolle. `configure-realm.sh` löscht sie und bricht ab, falls eines übrig bleibt. `create-user.sh --disable/--enable` sperrt Zugänge ohne Datenverlust.
- **Weniger Geheimnisse im internetseitigen Container:** der API-Container bekommt nur die von ihm benötigten Variablen statt der kompletten `.env`. Unbekannte Hostnamen werden abgewiesen, OpenAPI-Doku ist im öffentlichen Betrieb hart auf 404, Sicherheits-Header werden pro Location gesetzt (serverweit hätten sie die Header der Keycloak-Seiten überschrieben).
- **Backup** (`ops/backup.sh`) sichert beide Datenbanken (`newsletter`, `keycloak`) mit Plausibilitätsprüfung.
- **DEV-Skripte** (`ops/create_dev_user.py`, `ops/configure_dev_realm.py`) brechen ab, wenn die `.env` `APP_ENV=prod` enthält.

### Robustheit

- **Fehlerisolation pro Versandauftrag:** ein defekter Auftrag blockierte alle weiteren (Starvation). Ein „Poison-Empfänger“ — eine Adresse, aus der sich keine Nachricht bauen lässt — läuft jetzt auf `failed`, statt den Auftrag dauerhaft in `sending` zu halten.
- **Kontingent-Fehler des Mailanbieters** (`550 5.4.5 Daily user sending limit exceeded` und Verwandte) gelten als vorübergehend; sonst hätte ein erreichtes Tageslimit alle restlichen Empfänger endgültig als fehlgeschlagen verbucht.
- **Zeitbasis:** DB-Session-Zeitzone fest auf UTC gepinnt — Rückstau-Check, Retention und Datumsanzeige bleiben korrekt, auch wenn die externe Konzern-DB nicht in UTC läuft.
- **AuthZ:** Admin-Endpunkte prüfen zusätzlich den DB-User (`is_active`) — offboardete Admins verlieren den Zugriff sofort, nicht erst mit Session-Ablauf. Logout ist POST mit CSRF-Header (kein Drive-by-Logout).
- **Härtung:** `/readyz` liefert nach außen nur generische Fehlzustände ohne DSN-/Host-Details; Betreff-Überlauf über 255 Zeichen ergibt 422 statt 500; der Entrypoint wiederholt bei DB-Warten keine fehlgeschlagenen Migrationen.
- **Frontend:** 401-Redirect mit Schleifenschutz; Hintergrund-Requests (Vorschau, Polling) navigieren bei Sitzungsablauf nicht weg, der Formularinhalt bleibt erhalten; Historie-Polling überlebt transiente Fehler; Topic-Namen werden über die DOM-API statt per String-HTML gesetzt (Attribut-Injection).
- **Strikte CSP** (`script-src 'self'`): Seiten-Skripte in eigenen Dateien, keine Inline-Handler (ADR-0020).

### Bewusste Abweichungen vom Plan (je mit ADR)

Handgeschriebenes CSS statt Tailwind (ADR-0018) · aiomysql mit `pool_recycle` statt asyncmy mit `pool_pre_ping` (ADR-0019) · `Secure`-Cookie-Flag nur bei https (ADR-0003) · `/readyz` ohne TLS-Restlaufzeit-Check (stattdessen prüft `demo-mode.sh start` die Restlaufzeit) · SMTP-Auth nur `none` und `login`; verlangt der Konzern-Relay Modern Auth/OAuth2, ist das Nacharbeit (ADR-0012, offene Frage B2).
