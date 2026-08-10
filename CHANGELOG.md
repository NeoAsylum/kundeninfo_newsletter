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

### Geändert
- CSP wieder strikt (`script-src 'self'`): Seiten-Skripte in externe Dateien ausgelagert (`abos.js`, `versand.js`), Inline-Handler entfernt (ADR-0020; ersetzt die Zwischenlösung `'unsafe-inline'`).
- DEV-Stack ohne Bind-Mounts (Docker-Desktop-File-Sharing-Falle auf Windows/OneDrive); Live-Reload optional über `compose.dev.reload.yaml`; Keycloak-Realm ins Image gebacken.

### Bekannte Abweichungen vom Plan (je mit ADR)
- Handgeschriebenes CSS statt Tailwind (ADR-0018); aiomysql + `pool_recycle` statt asyncmy + `pool_pre_ping` (ADR-0019); `Secure`-Cookie-Flag nur bei https (ADR-0003); `/readyz` ohne TLS-Restlaufzeit-Check (Überwachung via RUNBOOK-Inventar).
