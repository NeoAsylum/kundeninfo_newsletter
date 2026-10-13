# Leitplanken für KI-Sessions in diesem Repo

**Projekt:** Self-Service-Portal „Störungsinfos“ — ersetzt händisch gepflegte Outlook-Verteiler
durch DB-gepflegte Abos; Versand von Störungs-/Entwarnungsmails an bis zu ~5.000 Empfänger.
Maßgeblich für den Ist-Stand: die ADRs in [docs/adr/](docs/adr/), [README](README.md) und
[docs/RUNBOOK.md](docs/RUNBOOK.md). Der
[Umsetzungsplan](docs/mvp-umsetzungsplan-stoerungsinfos.md) ist der ursprüngliche
Planungsstand — bei Widersprüchen gewinnen Code und ADRs.

## Pflichten (Definition of Done gilt pro Change)

- `make check` grün vor Abschluss (Windows: `.\make.ps1 check`); Tests für neue Logik ergänzen.
- Doku mitpflegen: README, `docs/ARCHITECTURE.md` (inkl. **Egress-/Ingress-Matrix bei jeder
  neuen Netzverbindung**), `docs/RUNBOOK.md` bei Betriebsänderungen, `CHANGELOG.md` (Unreleased).
- `.env.example` ist die **einzige** Konfig-Wahrheit — bei jedem neuen Settings-Feld ergänzen
  (CI-Gate: `backend/scripts/check_env_example.py`).
- Architekturentscheidungen als ADR dokumentieren (`docs/adr/0000-template.md`).

## Verbote

- **Keine neue Infrastrukturkomponente** (Broker, Cache, zweiter Store, Framework) ohne ADR
  und explizite Rückfrage — Einfachheit ist Anforderung des Auftraggebers.
- **`uvicorn --workers 1` nicht ändern** (ADR-0004): Outbox-Worker setzt Single-Process voraus;
  mehrere Prozesse erzeugen Massen-Doppelversand.
- **Migrationen nur additiv** (ADR-0011).
- **Kein Tracking**: keine Lese-/Klick-Auswertung, keine personalisierten Mail-Links, keine
  Empfänger-Mailadressen in Logs (ADR-0014, Betriebsrats-Prinzip).
- **Keine Inline-Skripte/-Handler im Frontend** — CSP ist `script-src 'self'` (ADR-0020);
  Seiten-JS gehört in eigene Dateien (`abos.js`, `versand.js`, `app.js`).
- **Keine Secrets ins Repo**; reale `.env` nie committen.

## Kontext, der Fehlentscheidungen verhindert

- Regulatorik (DSGVO/Betriebsrat/Retention) und Firewall-Details sind **bewusst offen** —
  nicht raten, sondern konfigurierbar halten; offene Punkte gehören in `docs/open-questions.md`.
- Pflicht-Topics sind **implizit** (keine subscriptions-Zeilen, ADR-0009); Topic-Pflege läuft
  über die Admin-Maske (ADR-0024, löst ADR-0016 ab), das RUNBOOK-SQL ist nur noch Notfallweg.
- Adminrecht steht **nur** in `users.is_admin` (ADR-0022, löst ADR-0013 dafür ab); Rollen
  aus dem IdP-Token werden nicht gelesen. `require_admin` prüft je Anfrage die DB, ein
  Entzug wirkt sofort. Ersten Admin/Aussperrung: `ADMIN_BOOTSTRAP_EMAILS`, RUNBOOK 6b.
- DEV-Stack läuft ohne Bind-Mounts (Docker-Desktop/OneDrive-Falle), also kein Live-Reload.
  Code, Frontend und Realm sind in Images eingebacken → nach Änderungen `make dev`
  (baut neu, dauert Sekunden).
- Windows-Entwicklung: `make` existiert nicht — `.\make.ps1 <target>` verwenden.
- Docker ist die Voreinstellung, Podman die zweite Engine (`CONTAINER_ENGINE=podman`,
  ADR-0033). In Makefile, `make.ps1` und `ops/` keine Engine fest nennen; bezogene Images
  immer mit Registry (`docker.io/library/…`). Die CI prüft nur Docker — was den Start des
  Stacks betrifft, unter Podman von Hand gegenprüfen (RUNBOOK 1b).
