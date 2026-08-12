# Governance-Unterlagen

Gesammelte Unterlagen für den EMA-/Governance-Blick. Maßgeblich bleiben Code und ADRs;
dieser Ordner bündelt nur, was für ein Gespräch gebraucht wird.

| Datei | Inhalt |
|---|---|
| `Stoerungsinfos-BlueZone.pptx` | Gesprächsgrundlage: was die Software macht, Aufbau, IDV-Einordnung, offene Fragen |
| `stoerungsinfo-app.cdx.json` | SBOM (CycloneDX 1.6) der Python-Laufzeit-Abhängigkeiten, je Komponente mit Lizenz |

## SBOM — Umfang und Grenzen

- Deckt die **Python-Laufzeit-Closure** der Anwendung ab (aus `backend/requirements.lock`),
  erzeugt in `python:3.12-slim`. Erzeugung und Aktualisierung: [RUNBOOK](../RUNBOOK.md),
  Abschnitt „Lockfile & SBOM" ([ADR-0026](../adr/0026-lieferkette-lockfile-sbom.md)).
- **Nicht** enthalten: OS-Pakete des Base-Image. Eine Voll-Image-Stückliste über
  `trivy image --format cyclonedx` ist im RUNBOOK beschrieben, aber noch **nicht erzeugt**.

## Weiterführend (maßgeblich)

- Architekturentscheidungen: [`docs/adr/`](../adr/)
- Egress-/Ingress-Matrix für Firewall-Anträge: [ARCHITECTURE.md](../ARCHITECTURE.md), Abschnitt 4
- Offene Fragen und bewusst offen gehaltene Punkte: [open-questions.md](../open-questions.md)
