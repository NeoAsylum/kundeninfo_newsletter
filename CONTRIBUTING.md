# Mitarbeiten

## Vorgehensmodell

- **Meilenstein = Iteration.** Gearbeitet wird entlang der Meilensteine des Plans ([docs/mvp-umsetzungsplan-stoerungsinfos.md](docs/mvp-umsetzungsplan-stoerungsinfos.md)), immer nur einer in Arbeit. Jeder Meilenstein endet mit einer **Demo seines Abnahmekriteriums** durch das Problemmanagement; erst nach Freigabe wird getaggt (`v0.x.y`).
- **Zwei Stränge:** Der technische Strang läuft hier; der organisatorische (Stakeholder-Fragen, Anträge) läuft über den Konzern-Prozess — Stand im Register [docs/open-questions.md](docs/open-questions.md).

## Definition of Done (pro Change, nicht erst pro Meilenstein)

Ein Change ist fertig, wenn:

1. **Tests** grün und für neue Logik erweitert; `make check` läuft durch (Lint + Unit + API); Coverage-Gate (80 % auf `app/domain` + `app/mail`) gehalten.
2. **`.env.example`** bei jeder ENV-Änderung aktualisiert — das CI-Gate `backend/scripts/check_env_example.py` erzwingt es.
3. **`docs/ARCHITECTURE.md`** aktualisiert bei neuen Komponenten oder Verbindungen — **jede neue Netzverbindung braucht eine Zeile in der Egress-/Ingress-Matrix**.
4. **ADR** geschrieben bei Architekturentscheidungen (`docs/adr/0000-template.md`; nie löschen, nur „abgelöst durch NNNN“).
5. **`CHANGELOG.md`** unter *Unreleased* ergänzt.
6. **`docs/RUNBOOK.md`** aktualisiert, wenn sich Betriebsschritte ändern.

## PR-Checkliste (kopieren)

```markdown
- [ ] make check grün (Lint, Unit, API inkl. Coverage-Gate)
- [ ] Tests für neue Logik ergänzt
- [ ] .env.example aktuell (check_env_example.py grün)
- [ ] ARCHITECTURE.md / Egress-Matrix aktuell (falls Komponenten/Verbindungen geändert)
- [ ] ADR geschrieben (falls Architekturentscheidung)
- [ ] CHANGELOG.md (Unreleased) ergänzt
- [ ] RUNBOOK.md aktuell (falls Betriebsschritte geändert)
```

## Harte Regeln

- **Migrationen nur additiv** (ADR-0011) — Rollback ist ein Image-Tag, nie ein DB-Restore.
- **`uvicorn --workers 1` nicht ändern** (ADR-0004) — mehrere Prozesse ohne `SKIP LOCKED` erzeugen Massen-Doppelversand.
- **Keine neue Infrastrukturkomponente ohne ADR** (Leitplanke 1: die einfachste Lösung gewinnt).
- **Kein Tracking, keine personalisierten Mail-Links** (ADR-0014, Betriebsrats-Prinzip).
- **Keine Inline-Skripte/-Handler im Frontend** (ADR-0020, CSP `script-src 'self'`).
- **Keine Secrets ins Repo** — nur `.env.example` ist versioniert.

## Entwickeln

- Linux/Mac/CI: `make <target>` · Windows: `.\make.ps1 <target>` (identische Targets, Quelle der Wahrheit ist das Makefile).
- Schneller Loop: `make test` (< 30 s, ohne Docker) → `make test-db` (API-Tests) → vor Release `make test-integration`.
- Branch pro Arbeitspaket, kleine Commits, Merge nach grünem `make check`; `main` ist immer lauffähig.
