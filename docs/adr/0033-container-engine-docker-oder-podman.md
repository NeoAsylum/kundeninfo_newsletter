# [ADR-0033] Container-Engine: Docker oder Podman

* **Status:** Akzeptiert
* **Datum:** 2026-10-13
* **Kontext:** Makefile, Skripte und CI riefen fest `docker` auf. Im Unternehmen des
  Auftraggebers läuft statt Docker Podman (Angabe vom 2026-10-13). Welche Distribution und
  Podman-Version, ob mit oder ohne Root-Rechte (rootless) und welches Compose-Werkzeug dort
  zugelassen sind, ist nicht bekannt (Frage B13). Podman versteht dieselben Images und
  Compose-Dateien, weicht aber in Punkten ab, die den Betrieb treffen — am deutlichsten:
  Podman hat keinen Daemon; den mitgelieferten Dienst `podman-restart.service`, der
  Container nach einem Neustart der VM wieder startet, muss man erst einschalten.

## Entscheidung

Der Stack läuft mit beiden Engines aus denselben Compose-Dateien; Docker bleibt die
Voreinstellung.

* **Eine Variable wählt die Engine:** `CONTAINER_ENGINE` (`docker` oder `podman`) in
  `Makefile`, `make.ps1`, `ops/backup.sh` und `ops/governance.py`. Sie kommt aus der
  Umgebung oder als Argument von `make` — nicht aus der `.env`.
* **Compose unter Podman:** `podman compose` ruft ein fremdes Compose-Werkzeug auf.
  Unterstützt ist Docker Compose (das eigenständige Programm `docker-compose`, geprüft mit
  5.1.0); es spricht mit Podman über dessen Docker-kompatible Schnittstelle
  (`podman.socket`).
* **Jedes bezogene Image nennt seine Registry** (`docker.io/library/postgres:…` statt
  `postgres:…`) — in Dockerfiles, Compose-Dateien, `pg-umzug.sh` und im Generator. Docker
  ergänzt Kurznamen immer zu Docker Hub. Podman tut das nur über die Docker-kompatible
  Schnittstelle: Mit `docker-compose` startete der Stack auch mit Kurznamen. Bei direktem
  `podman build` oder `podman run` — so arbeiten podman-compose und der Generator — fragt
  Podman die `registries.conf` des Hosts; auf AlmaLinux brach der Bau des Datenbank-Image
  ohne Terminal ab (`postgres` steht dort in keiner Alias-Liste). Ausgeschrieben meinen
  beide Engines dasselbe Image, der Digest bleibt derselbe. Die Unterlagen in
  `docs/governance/` nennen weiter die Kurzform.
* **Der Generator der Governance-Unterlagen** fragt die Registry selbst, ob ein Basis-Image
  noch aktuell ist (bisher `docker buildx imagetools`, das es unter Podman nicht gibt).
* **Zwei Anpassungen für älteres Podman** (geprüft mit 5.6.0, dem Stand von RHEL 9.7),
  beide auch unter Docker gültig:
  * Der Healthcheck der API steht in der Form `CMD-SHELL`. Die Form `CMD` zerlegt Podman
    vor 5.8 an jedem Leerzeichen, wenn sie über die Docker-kompatible Schnittstelle kommt;
    der Container galt nie als gesund, und `up --wait` brach ab.
  * `compose.prod.yaml` setzt für alle drei Dienste `restart: always` statt
    `unless-stopped`. Nach einem Neustart der VM bringt Podman vor 5.8.2 nur Container mit
    dieser Policy zurück (die Grenze laut Versionshinweisen). Folge für jede Engine: Ein mit
    `stop` angehaltener PROD-Stack läuft nach einem Neustart der VM wieder — unter Docker
    laut dessen Dokumentation schon nach einem Neustart des Docker-Dienstes; `down` hält
    ihn aus. Der Pilot bleibt bei `unless-stopped` (`demo-mode.sh stop` soll einen Neustart
    überdauern).
* **Unverändert bei Docker bleiben** die Skripte der öffentlichen Pilot-VM (`deploy/vm/`):
  `bootstrap.sh` richtet dort Docker ein, `firewall.sh` hängt an dessen Kette `DOCKER-USER`.
  Das gilt auch für den Umzug 16 → 18 (`pg-umzug.sh`): Er betrifft nur Bestände, die unter
  Docker entstanden sind. Die CI läuft weiter mit Docker.

Was der Host unter Podman zusätzlich braucht, steht im RUNBOOK (Abschnitt 1b).

## Geprüft

Am 2026-10-13, jeweils mit `.env.example` (Mails an Mailpit):

| Umgebung | Lauf | Ergebnis |
|---|---|---|
| Podman 6.1.4, Podman-Maschine unter Windows (WSL 2), rootless | `make.ps1 dev`, `test-db`, `test-integration` | Stack gesund, 201 API-Tests, 6 Integrationstests |
| dieselbe Maschine, rootful | PROD-Aufbau; Neustart der Maschine | läuft mit Grenzen, Nur-Lese-Dateisystem und TLS; kommt nur mit `podman-restart.service` wieder hoch — beobachtet am Stand vor den Änderungen dieses ADR (Kurznamen, Healthcheck `CMD`, `unless-stopped`), danach nicht wiederholt |
| Podman 5.8.2 aus AlmaLinux 9.8 (der Stand von RHEL 9.8 und 10.2), unter WSL 2, rootless | `make dev`, Integrationssuite, `make prod`, `ops/backup.sh` samt Rückspiel, Neustart | läuft, sobald die Voraussetzungen aus RUNBOOK 1b erfüllt sind; die Fehlerbilder ohne sie stehen dort |
| Podman 5.6.0 aus AlmaLinux 9.7 (der Stand von RHEL 9.7), unter WSL 2, rootless | `make dev`, Integrationssuite, `make prod`, Neustart | läuft mit den zwei Anpassungen; davor wurde `api` nie gesund, und der Stack blieb nach einem Neustart trotz Neustart-Dienst aus |
| Docker 29.2.1 (Docker Desktop) | `make.ps1 dev`, `test-db`, `test-integration` | unverändert: 201 API-Tests, 6 Integrationstests |

**Nicht geprüft:** SELinux (der WSL-Kernel hat keins), firewalld, Podman vor 5.6 (RHEL 8
und SLES 15 liefern 4.9), eine echte VM und der Pilotbetrieb unter Podman — außerdem die
Logbegrenzung, die beschreibbaren Pfade `/run` und `/var/tmp`, die Sitzung nach `su` oder
`sudo -u` und die Adresse des Clients mit Root-Rechten. Die Aussagen im RUNBOOK dazu stammen
aus den Quellen von Podman und sind dort als ungeprüft gekennzeichnet. Ebenfalls nicht
geprüft: `make scan`. Das Target ruft ein lokal installiertes Trivy auf, das
`CONTAINER_ENGINE` nicht liest und ein Image laut seiner Dokumentation zuerst bei Docker
sucht.

## Konsequenzen

* **Positiv:** Die Konzern-VM braucht kein Docker. Auf einem Host ohne Docker fällt ein
  Aufruf ohne die Variable sofort auf (`docker: command not found`); wo beide Engines
  installiert sind, läuft er gegen den Bestand von Docker. Die Registry-Abfrage des
  Generators braucht kein `buildx` mehr.
* **Negativ / Risiken:**
  * Unter Podman gelten Voraussetzungen, die Docker nicht kennt (Neustart-Dienst; rootless
    zusätzlich Freigaben für CPU-Grenzen und die Ports 80/443). Fehlen sie, startet der
    Stack nicht oder kommt nach einem Neustart der VM nicht wieder.
  * Rootless sieht NGINX nicht die Adresse des Clients, sondern für alle dieselbe interne.
    Das Zugriffslog verliert damit seine Aussage; die Ratenlimits des Pilots (je Adresse)
    träfen alle Nutzer gemeinsam — der Pilot bleibt deshalb bei Docker.
  * Die Logbegrenzung ist schwächer: Podman schneidet das Log eines Containers bei 10 MB
    ab, statt fünf Dateien zu rotieren (laut Dokumentation, nicht geprüft).
  * Zwei Engines heißt zwei Prüfwege. Die CI prüft nur Docker; Podman ist von Hand geprüft
    und kann unbemerkt brechen.

## Verworfene Alternativen

* **Nichts ändern und auf dem Host `docker` auf Podman umleiten** (Paket `podman-docker`):
  hängt an einem Paket des Hosts, löst die Kurznamen nicht und lässt den Generator ohne
  `buildx` zurück.
* **podman-compose als Compose-Werkzeug:** Version 1.5.0 (EPEL 9 und 10) kennt `up --wait`
  nicht, `make dev` bricht sofort ab. Mit 1.6.0 liefen `make dev` und `make dev-down`,
  `make test-db-down` nicht (kein `rm`). Nicht weiter verfolgt.
* **Quadlet oder eigene systemd-Units statt Compose:** der Weg, den Red Hat für Dienste
  beschreibt, und er löste Neustart und Logs ohne Zusatzschritt. Es wäre aber ein zweiter
  Betriebsweg neben Compose, der getrennt gepflegt und geprüft werden müsste — erst, wenn
  das Unternehmen Compose nicht zulässt (Frage B13).
* **Die Restart-Policy über eine Einstellung wählbar machen** (`unless-stopped` als
  Voreinstellung, `always` nur für älteres Podman): Der Betrieb müsste dafür die
  Podman-Version kennen und richtig eintragen — ein falscher Wert fiele erst beim nächsten
  Neustart der VM auf.
* **Die Datei-Mounts in `compose.prod.yaml` fest mit `:z` versehen** (SELinux): hier nicht
  prüfbar, und rootless scheitert die Umetikettierung an Dateien, die root gehören. Die
  Etikettierung steht stattdessen als Voraussetzung im RUNBOOK.
