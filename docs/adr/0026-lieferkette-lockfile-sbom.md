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

## Nachtrag (2026-10-12)

Alle Abhängigkeiten wurden auf den neuesten stabilen Stand gehoben, getestet und gepinnt (Entscheidung des Auftraggebers). Was sich an diesem ADR dadurch ändert:

* **Laufzeit-Image** ist `python:3.14.8-slim`; Lockfile und SBOM entstehen dort (RUNBOOK 5b).
* **Auch die Testwerkzeuge sind exakt gepinnt** (`backend/requirements-dev.txt`) — bisher standen dort nur Untergrenzen, und jede Installation zog den Stand des Tages.
* **Jedes Basis-Image steht mit Digest da**, jetzt auch `certbot` im Pilot-Overlay; die Actions der CI mit Commit-Hash, Python und Node dort mit voller Version.
* **Ein Paket bleibt bewusst unter dem neuesten Stand** (Grund in RUNBOOK 5c): Playwright bei 1.63.0 (1.64.0 lässt eine mit 204 beantwortete Navigation hängen — genau die Regel, mit der die Tests Seitenwechsel abfangen). Die zunächst gesetzte Obergrenze `pydantic<2.14` ist seit 2026-10-13 gelöst; die Suite läuft mit 2.14.1.
* **Neu in der Closure:** `opentelemetry-api`, seit FastAPI 0.142 eine feste Abhängigkeit. Die Anwendung schaltet die Telemetrie von FastAPI ausdrücklich ab (`app/main.py`); ein SDK oder Exporter steht nicht im Lockfile.

## Nachtrag (2026-10-13): Urheber, Stücklisten der Images, Schwachstellenbericht

Der Auftraggeber verlangt einen Ordner mit Compliance-Unterlagen: eine Stückliste, die
Komponenten, Urheber und Lizenzen nennt, und das Ergebnis einer Schwachstellenanalyse.
`docs/governance/` ist dieser Ordner; `ops/governance.py` (`make governance`) erzeugt ihn.

* **Urheber stehen mit Namen da, ohne E-Mail-Adresse.** Sie kommen aus den Metadaten der
  Pakete (Author, ersatzweise Maintainer) bzw. bei Betriebssystem-Paketen vom Betreuer in der
  Distribution. BSI TR-03183-2 erwartet als Ersteller eine Adresse oder URL; dagegen steht,
  dass ein öffentliches Repository sonst die Adressen einiger Dutzend Dritter führte. Die
  Abweichung ist als Frage B12 festgehalten.
* **Je gebautem Image eine eigene Stückliste**, gelesen mit Trivy. Die Stückliste der
  Anwendung bleibt die von `cyclonedx-py`, ergänzt um Autoren und um das, was Pakete in
  ihrer eigenen Stückliste nennen. Was aus dem Quelltext gebaut ist (Python, PostgreSQL),
  listet Trivy nicht — das Skript trägt es von Hand in die Stückliste des Image ein.
* **Trivy läuft als Container, per Digest gepinnt, ohne Docker-Socket**; das Image geht als
  Archiv hinein, der Scan läuft ohne Netz. Anlass für die Strenge: Im März 2026 lagen unter
  drei Versions-Tags manipulierte Trivy-Images (GHSA-69fq-xp46-6x23). Das Werkzeug der
  Stückliste (`cyclonedx-bom`) wird dagegen in fester Version, aber ohne Hash-Prüfung und
  mit frei aufgelösten Abhängigkeiten in einen Wegwerf-Container installiert — hingenommen,
  weil dort kein Geheimnis liegt und das Ergebnis nur gelesen, nicht ausgeführt wird.
* **Schwachstellen stehen nicht in der Stückliste**, sondern in einem eigenen Bericht
  (so auch TR-03183-2, Abschnitt 3.1). Bewertet wird je Lücke mit den Statuswörtern von VEX;
  die Bewertungen liegen in `schwachstellen-bewertung.toml` und überleben damit jeden neuen
  Scan — eine neue Lücke erscheint als „in Prüfung“, eine erledigte Bewertung als
  gegenstandslos. Ein VEX- oder CSAF-Dokument entsteht nicht (Frage B12).
* **Tests halten Daten und Dokumente zusammen:** Die Markdown-Dokumente müssen dem
  entsprechen, was der Generator aus den Dateien schreibt, und der Scan muss die Basis-Images
  aus den Dockerfiles der vier untersuchten Images beschreiben. Wer eines davon anhebt,
  bekommt einen roten Test, bis `make governance` gelaufen ist.
* **Negativ:** Der Ordner wächst um rund 1,5 MB erzeugter Dateien. `make governance` braucht
  Docker, Netz und gut 1 GB Download je Lauf. Die Bewertungen sind Handarbeit und veralten
  mit jedem Scan.

## Nachtrag (2026-10-13): Docker oder Podman

`make governance` läuft mit beiden Engines
([ADR-0033](0033-container-engine-docker-oder-podman.md)). Ob ein Basis-Image noch aktuell
ist, fragt der Generator dafür selbst bei der Registry ab statt über `docker buildx`. Ein
Lauf unter Podman 6.1.4 ergab dieselben Komponenten und dieselben 304 Funde wie der unter
Docker; die Stücklisten nennen die selbst gebauten Images in beiden Fällen ohne Registry.
