# Governance- und Compliance-Unterlagen

Gesammelte Unterlagen für den EMA-/Governance-Blick. Maßgeblich bleiben Code und ADRs;
dieser Ordner bündelt, was eine Prüfung braucht.

| Datei | Inhalt |
|---|---|
| [`KOMPONENTEN.md`](KOMPONENTEN.md) | **Stückliste, lesbar:** die Software-Komponenten mit Version und — soweit sie es nennen — Urheber und Lizenz |
| [`SCHWACHSTELLEN.md`](SCHWACHSTELLEN.md) | **Ergebnis der Schwachstellenanalyse:** Scan von vier Images, Bewertung der Lücken CRITICAL, HIGH und ohne Einstufung, Grenzen des Scans, mögliche Maßnahmen |
| `stoerungsinfo-app.cdx.json` | SBOM (CycloneDX 1.6) der Python-Umgebung der Anwendung: Pakete mit Autoren und Lizenz, dazu was ein Paket in seiner eigenen Stückliste nennt |
| `stoerungsinfo-image-<name>.cdx.json` | SBOM (CycloneDX) je untersuchtem Image — `api`, `nginx`, `postgres`, `keycloak`: Betriebssystem-Pakete und Bibliotheken |
| `schwachstellen.json` | alle Funde des Scans, auch MEDIUM und LOW, mit Stand (Werkzeug, Datenbank, Images) |
| `schwachstellen-bewertung.toml` | die Bewertungen und die Angaben zu dem, was der Scanner nicht sieht — von Hand gepflegt |
| `Stoerungsinfos-BlueZone.pptx` | Gesprächsgrundlage: was die Software macht, Aufbau, IDV-Einordnung, offene Fragen |

## Erzeugen

`make governance` (Windows: `.\make.ps1 governance`) baut die Images und schreibt die
Stücklisten, `schwachstellen.json` und die beiden Markdown-Dokumente neu (nicht die
Bewertung, die Folien und diese Datei); nach einer Änderung an der Bewertung genügt
`python ops/governance.py bericht`. Ablauf und Voraussetzungen: [RUNBOOK](../RUNBOOK.md),
Abschnitt 5b ([ADR-0026](../adr/0026-lieferkette-lockfile-sbom.md)).

Fällig ist das nach jeder Änderung an Abhängigkeiten oder Basis-Images — für das Lockfile
und die Dockerfiles der vier untersuchten Images schlägt `make test` dann fehl, bis es
geschehen ist — und vor jeder Vorlage bei einer Prüfung: Ein Scan gilt für den Tag, an dem
er lief.

## Umfang und Grenzen

- **Images:** vier, die dieses Projekt baut (linux/amd64). `keycloak` läuft nur in DEV und
  im Pilot; in PROD meldet der IdP des Konzerns an. Nicht eigens untersucht ist das
  NGINX-Image des Pilots (`deploy/nginx/Dockerfile.public` — dasselbe Basis-Image, andere
  Konfiguration). Mailpit und die Test-Datenbank (DEV), Certbot (Pilot) und der einmalige
  PostgreSQL-16-Helfer des Umzugs sind unverändert bezogene Images und weder in den
  Stücklisten noch im Scan.
- **Urheber und Lizenzen** stehen so da, wie die Komponenten sie selbst angeben, und nur,
  wo sie es tun: Knapp die Hälfte der Einträge nennt einen Urheber, gut die Hälfte eine
  Lizenz — Java-Bibliotheken und Go-Module meist nichts davon. Dem Lizenztext statt der
  Angabe folgen Jinja2, uvloop und die Pakete von nginx.org; geprüft sind sonst nur die
  Hauptkomponenten (KOMPONENTEN.md, Abschnitt 1). Genannt werden Namen, keine
  E-Mail-Adressen.
- **Was kein Paketverzeichnis kennt, sieht der Scanner nicht:** Python und PostgreSQL (aus
  dem Quelltext gebaut) stehen deshalb von Hand in den Stücklisten ihrer Images;
  Bibliotheken, die fest in einem Paket stecken, ohne dass es sie nennt, fehlen.
  SCHWACHSTELLEN.md, Abschnitt 4, sagt, was zu ihrem Stand bekannt ist.
- **Die Bewertungen** sind die Einschätzung des Entwicklungsteams, keine Freigabe der
  Informationssicherheit ([Frage B10](../open-questions.md)).
- **Stücklisten und Schwachstellen sind getrennte Dokumente**, wie es BSI TR-03183-2
  (Version 2.1.0) verlangt; auch das Format (CycloneDX ab 1.6) folgt ihr, und die Stückliste
  der Anwendung nennt die Lizenz jedes Python-Pakets als SPDX-Kennung. Konform sind die
  Stücklisten damit nicht — ob die Richtlinie hier überhaupt gilt und was dann fehlt, steht als
  [Frage B12](../open-questions.md) im Register.

## Weiterführend (maßgeblich)

- Architekturentscheidungen: [`docs/adr/`](../adr/)
- Egress-/Ingress-Matrix für Firewall-Anträge: [ARCHITECTURE.md](../ARCHITECTURE.md), Abschnitt 4
- Offene Fragen und bewusst offen gehaltene Punkte: [open-questions.md](../open-questions.md)
