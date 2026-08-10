# [ADR-0008] Image-Build auf der VM aus dem Git-Tag (vorläufig)

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Registry-/CI-Zugang im Konzern ungeklärt (Frage B8); deploybar muss es trotzdem sein (Plan 3.7).

## Entscheidung

Bis eine Konzern-Registry verfügbar ist, werden Images **auf der VM aus dem annotierten Git-Tag gebaut** (`git checkout vX.Y.Z` → `make prod-localdb` baut mit). Version und Git-SHA werden als Build-Args ins Image und in `/healthz` gestempelt. Base-Images sind per **Digest gepinnt** (beide Dockerfiles + Compose).

## Konsequenzen

* **Positiv:** Kein Registry-Blocker für den Go-Live; reproduzierbar über Tag + Digest-Pins.
* **Negativ:** Build braucht Docker-Hub-/PyPI-Erreichbarkeit von der VM (Egress-Matrix, ggf. Mirror); kein automatischer CVE-Rebuild → monatliche Rebuild-Kadenz als Betriebsprozess (RUNBOOK, Plan 9.7).
* **Erweiterungspunkt:** CI baut + pusht in Konzern-Registry, VM zieht nur noch (`IMAGE_TAG` + `compose pull`) — im Makefile vorbereitet.

## Verworfene Alternativen

* **Warten auf Registry-Klärung:** blockiert den Pilot ohne Not.
* **Images per Datei-Transfer (`docker save/load`):** fehleranfälliger manueller Prozess ohne Mehrwert gegenüber Build-on-VM.
