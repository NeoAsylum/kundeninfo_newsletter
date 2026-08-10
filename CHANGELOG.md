# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) · Versionierung: SemVer light (`v0.x.y` im MVP, `v1.0.0` zum Produktivgang).

## [Unreleased]

### Hinzugefügt

**Kern (Meilensteine M0–M3b des Plans):**
- Docker-Stack mit Compose-Schichtung: `compose.yaml` (Basis) + `compose.db.yaml` (lokale DB) + `compose.dev.yaml` (Keycloak-/Mailpit-Mocks, Test-DB) + `compose.prod.yaml` (TLS, Limits, Härtung) + optionales `compose.dev.reload.yaml`; Aufruf über `Makefile` (Linux/CI/VM) und `make.ps1` (Windows).
- SSO per OIDC/BFF (Authorization Code + PKCE) gegen konfigurierbaren IdP; Fernet-verschlüsseltes HttpOnly-Session-Cookie; CSRF-Schutz (SameSite=Lax + `X-Requested-With`-Pflichtheader); JIT-Provisioning mit E-Mail-Kollisionsbehandlung; Logout mit IdP-End-Session.
- Datenmodell (users, topics, subscriptions, dispatches, dispatch_recipients, audit_log) via Alembic-Migrationen 0001/0002 inkl. Topic-Seed; Pflicht-Topics implizit (ADR-0009).
- Abo-Maske: Topics mit Toggles, Pflicht-Badge + Schloss, Auto-Save mit Rollback bei Fehlern.
- Versand-Maske: Ziel-Verteiler mit Empfängerzahl, Schweregrad (Störung/Einschränkung/Entwarnung), Betreff-Automatik mit Titel-Zähler (max. 150), E-Mail-Live-Vorschau (echtes Template), Versandhistorie mit Status-Polling.
- Versandpfad: DB-Outbox + asyncio-Worker (atomares Claiming, Fortschritts-Heartbeat, Stale-Recovery, Retry mit Backoff, Einzelmails mit Verbindungs-Batching, Abschlussstatus); Jinja2-Templates HTML+Plaintext, Outlook-tauglich, Farbbalken je Schweregrad, Null-Tracking-Footer.
- Health-Endpunkte `/healthz` (Liveness, Version/Git-SHA) und `/readyz` (DB, SMTP, Outbox-Rückstau); Retention-Cleanup als Konfigwert (Default aus).

**Qualität & Betrieb (M4-Anteile):**
- Test-Suite: Unit (ohne Docker), API gegen MariaDB-tmpfs, Integration gegen den echten Stack (Keycloak-Login-Roundtrip, E2E-Versand mit Mailpit-Assertions); Coverage-Gate 80 % auf `app/domain` + `app/mail`; Smoke-Test-Skript.
- CI-Hülle (GitHub Actions) um `make`-Targets; Konfig-Doku-Gate (`check_env_example.py`); ruff + mypy.
- Ops-Skripte: `backup.sh` (nächtlicher Dump), `export-recipients.sh` (Notfall-CSV je Topic), `check-egress.sh` (Firewall-Vorabtest); Base-Images per Digest gepinnt.
- Dokumentation: README (Quickstart), ARCHITECTURE (inkl. Egress-/Ingress-Matrix), RUNBOOK, 20 ADRs, DSGVO-Operations, Betriebsrat-Briefing, Fragenregister, CONTRIBUTING, CLAUDE.md.

- **Empfänger-Verwaltung (Admin-Maske `empfaenger.html`), verteiler-zentriert:** zuerst Verteiler per Dropdown wählen, dann aktive Empfänger per E-Mail-Filter durchsuchen (Paging) und das Abonnement pro Zeile per „Abonniert“-Checkbox pflegen; Pflicht-Verteiler zeigen alle aktiven Empfänger mit gesperrter Checkbox (implizites Abo, ADR-0009). API: `GET /api/v1/admin/users` (E-Mail-Suche mit Wildcard-Escaping, `is_active`-Filter), `PUT/DELETE /api/v1/admin/users/{id}/subscriptions/{topic}`; zusätzlich `PATCH /api/v1/admin/users/{id}` zum Deaktivieren/Reaktivieren (API-only, Selbst-Deaktivierung gesperrt; erneuter SSO-Login reaktiviert — Offboarding-Semantik, ADR-0010). Admin-Fremdänderungen werden bei echter Änderung auditiert; bewusst ohne Verhaltensdaten (`last_login_at`) im UI/Payload (B5).

- **Selbstregistrierung über den IdP:** Die Anmeldeseite bietet einen „Registrieren“-Link (Keycloak, E-Mail als Benutzername, optional mit Bestätigungsmail); neue Nutzer werden im Portal automatisch als Empfänger angelegt und erhalten Pflicht-Verteiler sofort. Bewusst **ohne** eigene Registrierungsmaske und Passwortverwaltung im Portal (ADR-0021). Konfiguration: `ops/configure_dev_realm.py`.
- **DEV-Benutzer per Skript:** `ops/create_dev_user.py --email <adresse> [--admin]` legt Keycloak-Benutzer inklusive Admin-Rolle an — reproduzierbar nach Container-Neuaufbau, da der DEV-Keycloak seinen Datenstand nicht persistiert.
- **`ops/check_smtp.py`** prüft Verbindung, TLS und Anmeldung am SMTP-Server ohne Versand (optional `--send-to` für eine Testmail).
- **SMTP-Auth per OAuth2 (`SMTP_AUTH_MODE=oauth2`):** Microsoft Modern Auth / SASL-XOAUTH2 für Outlook.com und Exchange Online, die Passwörter und App-Passwörter ablehnen (`535 5.7.139`). Access-Tokens holt und cacht das Backend selbst aus dem Refresh-Token; `backend/scripts/get_oauth_token.py` beschafft diesen einmalig per Device-Code-Flow (kein Client-Secret, kein Redirect-URI). Einrichtung inkl. Azure-App-Registrierung: RUNBOOK 3b; Entscheidung: ADR-0012.
- **Test-Umleitung `MAIL_REDIRECT_TO`:** Leitet alle ausgehenden Mails an eine einzelne Adresse um (Default aus). Die Versandhistorie behält die echten Empfänger, jede Mail trägt zusätzlich `X-Original-Recipient`. Gedacht für Abnahme-/Demozwecke mit einem echten Postfach — in PROD leer lassen.

### Geändert
- CSP wieder strikt (`script-src 'self'`): Seiten-Skripte in externe Dateien ausgelagert (`abos.js`, `versand.js`), Inline-Handler entfernt (ADR-0020; ersetzt die Zwischenlösung `'unsafe-inline'`).
- DEV-Stack ohne Bind-Mounts (Docker-Desktop-File-Sharing-Falle auf Windows/OneDrive); Live-Reload optional über `compose.dev.reload.yaml`; Keycloak-Realm ins Image gebacken.

- NGINX reicht `/docs` und `/openapi.json` durch — die Swagger-UI war über den Reverse Proxy nicht erreichbar (404), obwohl die README sie nannte. Das Backend liefert sie weiterhin nur bei `APP_ENV=dev`.

### Behoben (adversariales Code-Review, 19 Befunde — alle „mittel“ + 10 „niedrig“ gefixt)
- **Worker:** Fehlerisolation pro Versandauftrag (ein defekter Auftrag konnte alle weiteren blockieren — Starvation); „Poison-Empfänger“ (nicht erstellbare Nachricht, z. B. Headerzeichen in der Adresse) läuft jetzt auf `failed` statt den Auftrag ewig in `sending` zu halten.
- **Zeitbasis:** DB-Session-Zeitzone fest auf UTC gepinnt (`init_command`) — Rückstau-Check, Retention und Datumsanzeige bleiben auch korrekt, wenn die externe Konzern-DB nicht in UTC läuft.
- **AuthZ:** Admin-Endpunkte prüfen zusätzlich den DB-User (`is_active`) — offboardete Admins verlieren den Zugriff sofort, nicht erst nach Session-Ablauf.
- **Logout:** POST mit CSRF-Header statt GET (kein Drive-by-Logout); Frontend navigiert zur IdP-End-Session-URL.
- **Härtung:** `/readyz` liefert nach außen nur generische Fehlzustände (keine DSN-/Host-Details); `export-recipients.sh` validiert Topic-Slugs (SQL-/Shell-Injection-Schutz); Betreff-Überlauf (> 255) → 422 statt 500; Entrypoint wiederholt bei DB-Warten keine fehlgeschlagenen Migrationen.
- **Frontend:** 401-Redirect mit Schleifenschutz; Hintergrund-Requests (Vorschau/Polling) navigieren bei Sitzungsablauf nicht mehr weg (Formularinhalt bleibt erhalten); Historie-Polling überlebt transiente Fehler; Attribut-Injection über Topic-Namen beseitigt (DOM-API statt String-HTML); Enum-Felder werden escaped; Leerzustand der Versand-Maske; kein DEV-Testuser-Name im PROD-UI.

### Bekannte Abweichungen vom Plan (je mit ADR)
- Handgeschriebenes CSS statt Tailwind (ADR-0018); aiomysql + `pool_recycle` statt asyncmy + `pool_pre_ping` (ADR-0019); `Secure`-Cookie-Flag nur bei https (ADR-0003); `/readyz` ohne TLS-Restlaufzeit-Check (Überwachung via RUNBOOK-Inventar).

### Sicherheit (Befunde aus dem Review des öffentlichen Deployments)

- **Demo-Konten werden bei jedem Deploy entfernt.** Der importierte Realm enthält DEV-Testnutzer mit dem Passwort `test`, einer davon mit Adminrolle — öffentlich erreichbar wäre das ein offener Zugang zur Versandmaske und zur Empfängerliste. `configure-realm.sh` löscht sie und bricht ab, falls eines übrig bleibt.
- **`/idp` per Allowlist statt Blockliste.** Die vorherige Regex-Sperre für `/idp/admin` war per Matrix-Parameter umgehbar (`/idp/admin;x/...` erreichte die Keycloak-Admin-API). Jetzt werden nur Anmelde-, Registrierungs-, Protokoll- und Theme-Pfade des Realms `dev` durchgereicht; Adminkonsole, Admin-API, `master`-Realm, Metriken und Health enden mit 404.
- **Ratenlimits** für Registrierung und Passwort-Reset (dort löst jeder Aufruf eine Mail aus — `SMTP_MAX_PER_MINUTE` greift nicht, weil Keycloak eigenständig versendet), moderatere Limits für die übrigen Anmeldeschritte, Verbindungslimit pro IP.
- **X-Forwarded-For wird gesetzt statt angehängt** — verhindert, dass ein Client Brute-Force-Zähler und Ratenlimits auf eine fremde IP umlenkt.
- **Weniger Geheimnisse im internetseitigen Container:** Der API-Container bekommt nur die von ihm benötigten Variablen statt der kompletten `.env` (kein Datenbank-Root- und Keycloak-Adminpasswort mehr).
- **Kontingent-Fehler des Mailanbieters** (`550 5.4.5 Daily user sending limit exceeded` und Verwandte) gelten als vorübergehend — sonst hätte ein erreichtes Tageslimit alle restlichen Empfänger endgültig als fehlgeschlagen verbucht und die Mails wären verloren.
- **Backup sichert beide Datenbanken** (`newsletter` und `keycloak`) mit Plausibilitätsprüfung; `deploy.sh` zieht vor jedem Ausrollen einen Dump, weil Migrationen beim Containerstart automatisch laufen.
- **Unbekannte Hostnamen** werden abgewiesen (Default-Serverblöcke), OpenAPI-Doku im öffentlichen Betrieb hart auf 404, Sicherheits-Header werden pro Location gesetzt statt serverweit (sonst überschrieben sie die Header der Keycloak-Seiten).
- **DEV-Skripte** (`ops/create_dev_user.py`, `ops/configure_dev_realm.py`) brechen ab, wenn die `.env` `APP_ENV=prod` enthält.
- Speicherlimits an 1,8 GB RAM angepasst, Keycloak-Healthcheck ergänzt, `.env` wird mit restriktiven Rechten angelegt (statt nachträglich gesetzt), Platten-Aufräumen nach dem Ausrollen.
- **Paketfilter für den öffentlichen Betrieb** (`deploy/vm/firewall.sh`): Port 443 nur aus Cloudflare-Bereichen (IPv4 und IPv6, mit Zwischenspeicher als Rückfalloption), SSH mit Verbindungsbremse, Port 80 bewusst offen für die Zertifikatsprüfung. Die Regeln liegen in einer eigenen iptables-Kette innerhalb von `DOCKER-USER` — ufw allein wäre wirkungslos, weil Docker veröffentlichte Ports über eigene DNAT-Regeln an ufw vorbeischleust. Persistenz über eine systemd-Unit (nach `docker.service`), verifiziert nach einem Docker-Neustart.
- **Echte Client-IP hinter Cloudflare** (`deploy/nginx/includes/cloudflare-real-ip.inc`): Ohne diese Datei sahen die Ratenlimits nur Cloudflare-Adressen — echte Nutzer hätten sich gegenseitig ausgesperrt, während ein Angreifer sich über mehrere Standorte verteilt hätte. `deploy/vm/update-cloudflare-ranges.sh` aktualisiert Bereichsliste und Firewall in einem Schritt.
