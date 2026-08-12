# [ADR-0026] Lieferkette: gepinntes Lockfile mit Hashes und SBOM

* **Status:** Akzeptiert
* **Datum:** 2026-08-12
* **Kontext:** `requirements.txt` führte die Laufzeit-Abhängigkeiten nur mit
  Untergrenzen (`>=`). Zwei Builds desselben Git-Stands konnten damit verschiedene
  Versionen ziehen (nicht reproduzierbar), und es gab keine Stückliste der tatsächlich
  ausgelieferten Komponenten. Für die RZ-Aufnahme und den Governance-/IS-Blick sind
  beide erwartbar. Vorhandene Bausteine: Base-Image per Digest gepinnt (Dockerfile),
  Trivy-Scan-Gate im Build (`make scan`).

## Entscheidung

`requirements.txt` bleibt die **menschenlesbare Quelle** (die 12 direkten Abhängigkeiten
mit Untergrenzen). Daraus wird ein **vollständig aufgelöstes, gepinntes und gehashtes**
Lockfile erzeugt:

```
pip-compile --generate-hashes --strip-extras -o requirements.lock requirements.txt
```

Erzeugt in `python:3.12-slim` (dem Laufzeit-Image), damit die aufgelösten Versionen
zum Pilot passen. `--generate-hashes` nimmt die Hashes **aller** Wheels je Version auf
(inkl. `manylinux`), das Lockfile ist damit plattformübergreifend prüfbar.

Der Container installiert ausschließlich aus dem Lockfile mit Hash-Zwang:

```
pip install --no-cache-dir --require-hashes -r requirements.lock
```

Als **Software Bill of Materials** liegt eine CycloneDX-1.6-Stückliste bei:
`docs/governance/stoerungsinfo-app.cdx.json` — die Laufzeit-Closure der Python-Abhängigkeiten,
je Komponente mit Version, `purl` und Lizenz, Wurzelkomponente = die Anwendung mit
Git-Stand. Regeneration und der Weg zur **Voll-Image-Stückliste** (inkl. OS-Pakete des
Base-Image, über `trivy image --format cyclonedx`) stehen im RUNBOOK, Abschnitt
„Lockfile & SBOM".

## Konsequenzen

* **Positiv:** Reproduzierbarer Build (gleicher Git-Stand → gleiche Artefakte);
  verifizierte Herkunft (`--require-hashes`); prüfbare Lizenz- und Komponentenlage für
  Governance/IS; die SBOM ist ein Release-Artefakt, kein Sonderauftrag.
* **Negativ:** Eine neue oder aktualisierte Abhängigkeit erfordert einen bewussten
  Zwischenschritt — `requirements.txt` ändern, Lockfile und SBOM neu erzeugen (RUNBOOK).
  Das ist gewollt: Änderungen an der Lieferkette werden sichtbar statt beiläufig.
* Das Base-Image bleibt per Digest gepinnt (Dockerfile); Trivy prüft weiterhin auf
  bekannte Schwachstellen.

## Verworfene Alternativen

* **Weiter nur `requirements.txt` mit `>=`:** einfach, aber nicht reproduzierbar und ohne
  Stückliste — genau die Lücke, die dieser ADR schließt.
* **Versionen direkt in `requirements.txt` pinnen (ohne Lockfile):** verliert die
  Trennung „gewollte direkte Abhängigkeit" ↔ „aufgelöste transitive Closure" und die
  Hashes; die direkte Liste würde mit 37 statt 12 Zeilen unlesbar.
* **SBOM erst bei RZ-Aufnahme:** verschenkt den billigen Zeitpunkt am Projektanfang und
  den Vertrauensvorschuss beim ersten Governance-Blick.
