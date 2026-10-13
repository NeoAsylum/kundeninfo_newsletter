# Ergebnis der Schwachstellenanalyse

<!-- Erzeugt von ops/governance.py — nicht von Hand ändern. Die Bewertungen stehen in
     schwachstellen-bewertung.toml; danach: python ops/governance.py bericht -->

**Scan vom 2026-10-13** mit Trivy 0.75.0, Schwachstellen-Datenbank vom 2026-10-13 (Java: 2026-10-13), Code `895b4d7`.

Ein Scan gilt für den Tag, an dem er lief: Neue Meldungen kommen täglich hinzu. Die Bewertungen sind die Einschätzung des Entwicklungsteams, keine Freigabe der Informationssicherheit (offene Frage B10).

## 1. Umfang

| Image | Inhalt | Basis-Image | Stand des Basis-Image | Betriebssystem | Image-ID |
|---|---|---|---|---|---|
| api | Anwendung (FastAPI, Versand-Worker) | `python:3.14.8-slim` | aktuell | debian 13.7 | `a3ea970e2fa8` |
| nginx | Reverse Proxy, liefert die Oberfläche aus | `nginx:stable-alpine` | aktuell | alpine 3.24.2 | `54d229ac1b2a` |
| postgres | Datenbank | `postgres:18-alpine` | aktuell | alpine 3.24.2 | `0aa91c157874` |
| keycloak | Anmeldung in DEV und im Pilot (in PROD: der IdP des Konzerns) | `quay.io/keycloak/keycloak:26.8.0` | aktuell | redhat 9.8 | `95b30ed4cb44` |

Die Basis-Images sind per Digest gepinnt; „Stand“ sagt, ob die Registry am Tag des Scans unter demselben Tag schon ein neueres Image führte.

Untersucht sind die Images der Tabelle (linux/amd64): Betriebssystem-Pakete, Python-Pakete, Java-Bibliotheken und Go-Programme darin, dazu die Bibliotheken, die Python-Pakete in ihrer eigenen Stückliste nennen. **Nicht** untersucht: das NGINX-Image des Pilotbetriebs (`deploy/nginx/Dockerfile.public` — dasselbe Basis-Image, andere Konfiguration), die unverändert bezogenen Images (Mailpit und die Test-Datenbank in DEV, Certbot im Pilot, PostgreSQL 16 als einmaliger Helfer in `deploy/vm/pg-umzug.sh`), die Testwerkzeuge (sie erreichen kein Image) und der eigene Code der Anwendung. Was der Scan grundsätzlich nicht sieht, steht in Abschnitt 4.

## 2. Ergebnis in Zahlen

| Image | CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN | Einzeln bewertet: verschiedene Lücken | davon mit Korrektur |
|---|---|---|---|---|---|---|---|
| api | 0 | 48 | 60 | 61 | 3 | 15 | 6 |
| nginx | 0 | 3 | 3 | 0 | 0 | 3 | 3 |
| postgres | 1 | 24 | 29 | 3 | 5 | 31 | 31 |
| keycloak | 0 | 6 | 29 | 29 | 0 | 3 | 0 |

Die Spalten der Schweregrade zählen wie der Scanner: jede Lücke je betroffenem Paket. Pakete aus demselben Quelltext melden dieselbe Lücke mehrfach; „verschiedene Lücken“ zählt sie einmal. Alle Funde einzeln, auch MEDIUM und LOW: `schwachstellen.json`. Einzeln bewertet sind CRITICAL und HIGH, dazu UNKNOWN (Meldungen, die noch niemand eingestuft hat) und was darunter eigens einen Eintrag hat.

## 3. Bewertung je Lücke

| Bewertung | Lücken |
|---|---|
| nicht betroffen (`not_affected`) | 52 |
| betroffen (`affected`) | 0 |
| behoben (`fixed`) | 0 |
| in Prüfung (`under_investigation`) | 0 |

Statuswörter wie bei VEX (CISA). Eine Lücke ohne Eintrag in der Bewertung gilt als „in Prüfung“. Die Tabelle zählt, was der Scanner gemeldet hat — was er nicht meldet, steht in Abschnitt 4; dort ist ein Punkt in Prüfung. „Laut Quelle“ gibt den Stand der Scanner-Datenbank vom Tag des Scans wieder.

Geprüft ist je Lücke am gebauten Image: an den Dateien, an den Abhängigkeiten der Programme und in Wegwerf-Containern (welche Prozesse Entrypoint, Kommando und Healthcheck starten, welche Bibliotheken der Python-Prozess beim Import der Anwendung lädt, wer eine Bibliothek einbindet) — nicht an einem laufenden Stack. Jede Bewertung ist in einem zweiten Durchgang gegengeprüft, der sie zu widerlegen suchte.

### api

**acl 2.3.2-2+b1** (Debian-Paket; installiert als: libacl1)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-54369](https://avd.aquasec.com/nvd/cve-2026-54369) | HIGH | – | keine Korrektur verfügbar | acl: Symlink traversal privilege escalation via libacl functions |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — Die Lücke betrifft die pfadbasierten Funktionen von libacl und setzt einen privilegierten Aufrufer voraus, der einen vom Angreifer beeinflussbaren Pfad verarbeitet. Im Image binden nur cp, mv, install, sed, tar, useradd und usermod libacl ein; keines ist setuid, keines wird im Betrieb aufgerufen, und der Python-Prozess lädt libacl nicht. Alle Prozesse laufen als Nutzer app ohne Capabilities. (Stand 2026-10-13)

**msgpack 1.1.2** (Python-Paket, in `pip (mitgeliefert)`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [GHSA-6v7p-g79w-8964](https://github.com/advisories/GHSA-6v7p-g79w-8964) | HIGH | 1.2.1 | Korrektur verfügbar | MessagePack for Python: Out-of-bounds read / crash on Unpacker reuse after a caught error |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücke liegt in der C-Erweiterung von msgpack. pip liefert unter pip/_vendor/msgpack nur die reine Python-Fassung mit; eine kompilierte Erweiterung gibt es im Image nicht. (Stand 2026-10-13)

**ncurses 6.5+20250216-2** (Debian-Paket; installiert als: libncursesw6, libtinfo6, ncurses-base, ncurses-bin)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2025-69720](https://avd.aquasec.com/nvd/cve-2025-69720) | HIGH | – | keine Korrektur verfügbar | ncurses: ncurses: Buffer overflow vulnerability may lead to arbitrary code execution. |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — Der Überlauf steckt im Kommandozeilenprogramm infocmp (Aufruf „infocmp -i“ auf einen präparierten terminfo-Eintrag), nicht in den Bibliotheken; libncursesw6, libtinfo6 und ncurses-base sind nur wegen desselben Quellpakets gemeldet. infocmp ist nicht setuid und wird von nichts aufgerufen; der Python-Prozess lädt weder libtinfo noch libncursesw. (Stand 2026-10-13)

**perl 5.40.1-6+deb13u1** (Debian-Paket; installiert als: perl-base)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-9538](https://avd.aquasec.com/nvd/cve-2026-9538) | HIGH | – | Korrektur zurückgestellt | perl-Archive-Tar: perl-Archive-Tar: Denial of Service via crafted tar header with large entry size |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Betroffen ist das Perl-Modul Archive::Tar; es gehört in Debian zum Paket perl-modules-5.40, das nicht installiert ist. Aus dem Quellpaket perl liegt im Image nur perl-base, eine Datei Archive/Tar.pm gibt es nicht. (Stand 2026-10-13)

**setuptools 70.3.0** (Python-Paket, in `pip (mitgeliefert)`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2025-47273](https://avd.aquasec.com/nvd/cve-2025-47273) | HIGH | 78.1.1 | Korrektur verfügbar | setuptools: Path Traversal Vulnerability in setuptools PackageIndex |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücke liegt in setuptools/package_index.py. pip liefert aus setuptools 70.3.0 nur das Modul pkg_resources mit; package_index.py und das Paket setuptools selbst sind im Image nicht vorhanden. (Stand 2026-10-13)

**systemd 257.13-1~deb13u1** (Debian-Paket; installiert als: libsystemd0, libudev1)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-16742](https://avd.aquasec.com/nvd/cve-2026-16742) | HIGH | – | keine Korrektur verfügbar | systemd: systemd-homed: Local privilege escalation via missing home-record signature verification |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücke liegt im Dienst systemd-homed. Aus dem Quellpaket systemd sind im Image nur die Bibliotheken libsystemd0 und libudev1 installiert; systemd-homed, homectl und pam_systemd_home.so fehlen, und im Container läuft kein systemd. (Stand 2026-10-13)

**urllib3 2.7.0** (Python-Paket, in `pip (mitgeliefert)`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-97687](https://avd.aquasec.com/nvd/cve-2026-97687) | HIGH | 2.8.0 | Korrektur verfügbar | urllib3: urllib3: Traffic interception via HTTPS proxy TLS configuration override |
| [CVE-2026-97689](https://avd.aquasec.com/nvd/cve-2026-97689) | HIGH | 2.8.0 | Korrektur verfügbar | urllib3: urllib3: Denial of Service via unbounded memory allocation in chunk parser |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — urllib3 2.7.0 liegt nur als Kopie in pip/_vendor und wird nur von pip geladen. Im laufenden Container startet nichts pip: Entrypoint und Kommando rufen alembic und uvicorn auf, der Healthcheck nutzt urllib.request, kein installiertes Paket importiert pip, und „import urllib3“ findet kein Modul. pip selbst läuft mit dieser Kopie beim Bau des Image (mit --require-hashes) und in „make governance“; dort müsste ein Angreifer PyPI bzw. den Spiegel oder die TLS-Verbindung dorthin kontrollieren. Ob pip hinter einem HTTPS-Proxy von CVE-2026-97687 betroffen ist, ist nicht geprüft. Maßnahme: Keine für den Betrieb. Ein pip mit urllib3 ab 2.8.0 gibt es am 2026-10-13 nicht; Basis-Image anheben, sobald es eines enthält. (Stand 2026-10-13)

**util-linux 1:2.41.5-0+deb13u1 / 1:4.16.0-2+really2.41.5-0+deb13u1 / 2.41.5-0+deb13u1** (Debian-Paket; installiert als: bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-76642](https://avd.aquasec.com/nvd/cve-2026-76642) | HIGH | – | keine Korrektur verfügbar | util-linux: util-linux: failed external mount helper still runs privileged X-mount post-hooks |
| [CVE-2026-78410](https://avd.aquasec.com/nvd/cve-2026-78410) | HIGH | – | keine Korrektur verfügbar | util-linux: util-linux: restricted bind mounts do not pin the source, allowing X-mount.owner/grou… |

Bewertung: **nicht betroffen** (Angreifer kann den verwundbaren Code nicht ansteuern) — Beide Lücken liegen in libmount und setzen voraus, dass ein Nicht-Root-Nutzer über das setuid-Programm mount einen von root in /etc/fstab freigegebenen Eintrag einhängt (Option user/users mit X-mount.*; bei CVE-2026-76642 zusätzlich ein Hilfsprogramm /sbin/mount.<typ>, bei CVE-2026-78410 ein bind-Eintrag). Im Image enthält /etc/fstab nur eine Kommentarzeile (root, 0644), es gibt kein /sbin/mount.*, und in den geprüften Aufrufen als Nutzer app wurde nichts eingehängt. Nichts im Container startet mount (geprüft am Code und beim Import der Anwendung, nicht an laufenden Anfragen); der Python-Prozess lädt aus util-linux nur libuuid. (Stand 2026-10-13)

**util-linux 1:2.41.5-0+deb13u1 / 1:4.16.0-2+really2.41.5-0+deb13u1 / 2.41.5-0+deb13u1** (Debian-Paket; installiert als: bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-78408](https://avd.aquasec.com/nvd/cve-2026-78408) | HIGH | – | keine Korrektur verfügbar | util-linux: util-linux: nsenter --join-cgroup leaks root cgroup migration authority |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — Verwundbar ist nur das Programm nsenter mit der Option --join-cgroup, und nur wenn ein Aufrufer mit root-Rechten bzw. CAP_SYS_ADMIN es gegen ein vom Angreifer kontrolliertes Ziel startet. /usr/bin/nsenter liegt im Image (0755, nicht setuid), wird aber von nichts aufgerufen; als Nutzer app scheitert es am fehlenden Recht (geprüft). Wer vom Host aus nsenter gegen den Container richtet, benutzt das nsenter des Hosts. (Stand 2026-10-13)

**util-linux 1:2.41.5-0+deb13u1 / 1:4.16.0-2+really2.41.5-0+deb13u1 / 2.41.5-0+deb13u1** (Debian-Paket; installiert als: bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-78409](https://avd.aquasec.com/nvd/cve-2026-78409) | HIGH | – | keine Korrektur verfügbar | util-linux: util-linux: X-mount.subdir detached-tree resolution can escape via intermediate symlinks |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Der verwundbare Schnellpfad von X-mount.subdir kam erst mit util-linux 2.42 (Advisory: betroffen ab 2.42). Die installierte libmount 2.41.5 lehnt X-mount.subdir für Nicht-Root-Nutzer ab; die Meldung dazu steht in der Bibliothek, der Code des Schnellpfads nicht. (Stand 2026-10-13)

**perl 5.40.1-6+deb13u1** (Debian-Paket; installiert als: perl-base)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-82560](https://avd.aquasec.com/nvd/cve-2026-82560) | UNKNOWN | – | keine Korrektur verfügbar | Pod::Text versions before 6.1.1 for Perl allow CPU and memory exhausti ... |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Betroffen ist das Perl-Modul Pod::Text. Im Image liegt aus dem Quellpaket perl nur perl-base; eine Datei Pod/Text.pm gibt es nicht (geprüft). (Stand 2026-10-13)

**xz-utils 5.8.1-1+deb13u1** (Debian-Paket; installiert als: liblzma5)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| DSA-6549-1 | UNKNOWN | 5.8.1-1+deb13u2 | Korrektur verfügbar | xz-utils - security update |
| [TEMP-1147318-639065](https://security-tracker.debian.org/tracker/TEMP-1147318-639065) | UNKNOWN | 5.8.1-1+deb13u2 | Korrektur verfügbar | [GHSA-5qpq-xqfv-j9pg: Invalid write if a decoder is reinitialized after allocation failure] |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — Die Lücke liegt in den Dekodierern für .lzma-, .lz- und MicroLZMA-Daten und setzt laut Hersteller voraus, dass ein Programm denselben Dekodierer nach einem Speicherfehler erneut initialisiert; .xz-Daten und Rohströme sind nicht betroffen. liblzma ist im Python-Prozess geladen, dekodiert wird damit aber nur, wenn Code LZMA-Daten öffnet (lzma, tarfile, shutil; zipfile nutzt Rohströme). Weder die Anwendung noch ein installiertes Paket außer pip tut das, und der HTTP-Client httpx kennt nur gzip, deflate, brotli und zstd; pip läuft im Betrieb nicht. Maßnahme: Debian hat die Korrektur am 2026-10-07 veröffentlicht (liblzma5 5.8.1-1+deb13u2); das gepinnte Basis-Image ist einen Tag älter. Sie kommt mit dem nächsten Basis-Image oder mit einem Paket-Upgrade im Dockerfile (siehe „Mögliche Maßnahmen“). (Stand 2026-10-13)

### nginx

**expat 2.8.4-r0** (Alpine-Paket; installiert als: libexpat)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-93990](https://avd.aquasec.com/nvd/cve-2026-93990) | HIGH | 2.8.5-r0 | Korrektur verfügbar | expat: Expat: XML Injection via Malformed UTF-16 Input |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — libexpat wird im Image nur von libfontconfig geladen, diese nur von libgd, und libgd nur vom dynamischen Modul ngx_http_image_filter_module.so. Die Konfiguration lädt kein Modul, und kein Einstiegsskript ruft die fc-Hilfsprogramme auf — libexpat gelangt in keinen laufenden Prozess. (Stand 2026-10-13)

**pcre2 10.48-r0** (Alpine-Paket)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-103111](https://avd.aquasec.com/nvd/cve-2026-103111) | HIGH | 10.49-r0 | Korrektur verfügbar | pcre2: pcre2: Out-of-bounds write via crafted regular expression |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — Der Fehler liegt im JIT-Matching mit einem wachsenden JIT-Stack, den eine Anwendung über pcre2_jit_stack_create/-assign anlegt, und braucht ein vom Angreifer geliefertes Muster. /usr/sbin/nginx importiert keine dieser Funktionen; selbst mit „pcre_jit on“ liefe das Matching auf dem Standard-Stack, den das Advisory als nicht betroffen nennt. Muster stammen bei nginx nur aus der Konfiguration; die im Repo enthält weder pcre_jit noch einen regulären Ausdruck (der Wert von PUBLIC_HOST für server_name wurde nicht eingesehen). (Stand 2026-10-13)

**tiff 4.7.1-r0** (Alpine-Paket)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-4775](https://avd.aquasec.com/nvd/cve-2026-4775) | HIGH | 4.7.2-r0 | Korrektur verfügbar | libtiff: libtiff: Arbitrary code execution or denial of service via signed integer overflow in TI… |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — libtiff wird nur von libgd geladen und libgd nur vom dynamischen Modul ngx_http_image_filter_module.so; die Konfiguration lädt kein Modul (kein load_module, kein image_filter). nginx liefert hier statische Dateien aus und reicht Anfragen durch; Bilder werden nicht dekodiert. (Stand 2026-10-13)

### postgres

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2025-68121](https://avd.aquasec.com/nvd/cve-2025-68121) | CRITICAL | 1.24.13, 1.25.7, 1.26.0-rc.3 | Korrektur verfügbar | crypto/tls: crypto/tls: Incorrect certificate validation during TLS session resumption |
| [CVE-2026-32283](https://avd.aquasec.com/nvd/cve-2026-32283) | HIGH | 1.25.9, 1.26.2 | Korrektur verfügbar | crypto/tls: golang: Go crypto/tls: Denial of Service via multiple TLS 1.3 key update messages |
| [CVE-2026-56862](https://avd.aquasec.com/nvd/cve-2026-56862) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | crypto/tls: golang: Golang crypto/tls: Denial of Service via indefinite KeyUpdate messages |
| [CVE-2026-97031](https://avd.aquasec.com/nvd/cve-2026-97031) | HIGH | 1.26.9, 1.27.2 | Korrektur verfügbar | crypto/tls: golang: crypto/tls: Denial of Service via multiple ECH outer extension references |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücken liegen in crypto/tls (Sitzungswiederaufnahme, KeyUpdate in TLS 1.3, ECH) und setzen eine TLS-Verbindung voraus. Das gosu-Binary enthält crypto/tls nicht und öffnet keine Netzverbindung. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2025-61726](https://avd.aquasec.com/nvd/cve-2025-61726) | HIGH | 1.24.12, 1.25.6 | Korrektur verfügbar | golang: net/url: Memory exhaustion in query parameter parsing in net/url |
| [CVE-2026-25679](https://avd.aquasec.com/nvd/cve-2026-25679) | HIGH | 1.25.8, 1.26.1 | Korrektur verfügbar | net/url: Incorrect parsing of IPv6 host literals in net/url |
| [CVE-2026-56860](https://avd.aquasec.com/nvd/cve-2026-56860) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | net/url: golang: golang net/url: Denial of Service from quadratic complexity in path resolution |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücken liegen in net/url. Das gosu-Binary enthält net/url nicht und verarbeitet keine URLs; den Benutzernamen wertet moby/sys/user mit strings- und strconv-Funktionen aus. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2025-61729](https://avd.aquasec.com/nvd/cve-2025-61729) | HIGH | 1.24.11, 1.25.5 | Korrektur verfügbar | crypto/x509: golang: Denial of Service due to excessive resource consumption via crafted certificate |
| [CVE-2026-27145](https://avd.aquasec.com/nvd/cve-2026-27145) | HIGH | 1.25.11, 1.26.4 | Korrektur verfügbar | crypto/x509: golang: golang crypto/x509: Denial of Service via excessive processing of DNS SAN en… |
| [CVE-2026-32280](https://avd.aquasec.com/nvd/cve-2026-32280) | HIGH | 1.25.9, 1.26.2 | Korrektur verfügbar | crypto/x509: crypto/tls: golang: Go: Denial of Service vulnerability in certificate chain building |
| [CVE-2026-32281](https://avd.aquasec.com/nvd/cve-2026-32281) | HIGH | 1.25.9, 1.26.2 | Korrektur verfügbar | crypto/x509: golang: Go crypto/x509: Denial of Service via inefficient certificate chain validation |
| [CVE-2026-33818](https://avd.aquasec.com/nvd/cve-2026-33818) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | encoding/asn1: golang: Go encoding/asn1: Denial of Service via excessive recursion in Unmarshal |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücken liegen in crypto/x509 (Zertifikatsprüfung, Hostname-Abgleich, Kettenbau, Policy-Prüfung) und encoding/asn1. Das gosu-Binary enthält keines der beiden Pakete und verarbeitet weder Zertifikate noch ASN.1-Daten. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-33811](https://avd.aquasec.com/nvd/cve-2026-33811) | HIGH | 1.25.10, 1.26.3 | Korrektur verfügbar | net: golang: Go net package: Denial of Service via long CNAME response in LookupCNAME |
| [CVE-2026-39836](https://avd.aquasec.com/nvd/cve-2026-39836) | HIGH | 1.25.10, 1.26.3 | Korrektur verfügbar | net: golang: Go net package: Denial of Service via NUL byte in Dial and LookupPort on Windows |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Beide Lücken liegen im Paket net (LookupCNAME mit cgo-Resolver; Dial/LookupPort unter Windows). Das gosu-Binary enthält das Paket net nicht. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-33814](https://avd.aquasec.com/nvd/cve-2026-33814) | HIGH | 1.25.10, 1.26.3 | Korrektur verfügbar | net/http/internal/http2: golang: golang.org/x/net: Go HTTP/2: Denial of Service via malformed SET… |
| [CVE-2026-39821](https://avd.aquasec.com/nvd/cve-2026-39821) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | golang.org/x/net/idna: golang: net/http: golang.org/x/net/idna: Privilege escalation via incorrec… |
| [CVE-2026-56853](https://avd.aquasec.com/nvd/cve-2026-56853) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | net/http: golang: Go net/http: Unencrypted HTTP/2 connections vulnerable to Denial of Service |
| [CVE-2026-78667](https://avd.aquasec.com/nvd/cve-2026-78667) | HIGH | 1.26.9, 1.27.2 | Korrektur verfügbar | net/http: golang: golang: Denial of Service via crafted HTTP Range headers |
| [CVE-2026-78669](https://avd.aquasec.com/nvd/cve-2026-78669) | HIGH | 1.26.9, 1.27.2 | Korrektur verfügbar | net/http: net/http/internal/http2: golang: golang.org/x/net/http2: net/http: Denial of Service vi… |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücken liegen in net/http einschließlich HTTP/2 und der dort eingebundenen idna-Verarbeitung. Das gosu-Binary enthält weder net/http noch golang.org/x/net; es ist weder HTTP-Client noch HTTP-Server und lauscht auf keinem Port. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-39820](https://avd.aquasec.com/nvd/cve-2026-39820) | HIGH | 1.25.10, 1.26.3 | Korrektur verfügbar | net/mail: golang: Go net/mail: Denial of Service via crafted email inputs |
| [CVE-2026-42499](https://avd.aquasec.com/nvd/cve-2026-42499) | HIGH | 1.25.10, 1.26.3 | Korrektur verfügbar | net/mail: golang: net/mail: Denial of Service via pathological email address parsing |
| [CVE-2026-42504](https://avd.aquasec.com/nvd/cve-2026-42504) | HIGH | 1.25.11, 1.26.4 | Korrektur verfügbar | mime: golang: Golang MIME: Denial of Service via maliciously-crafted MIME header |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücken liegen in net/mail und mime. Das gosu-Binary enthält keines der beiden Pakete; der Mailversand des Projekts läuft im api-Container in Python. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-39822](https://avd.aquasec.com/nvd/cve-2026-39822) | HIGH | 1.25.12, 1.26.5, 1.27.0-rc.2 | Korrektur verfügbar | golang: Go os.Root: Symlink following vulnerability allows directory traversal |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücke betrifft os.Root, also das Öffnen von Dateien relativ zu einem abgeschotteten Verzeichnis. Das Paket os ist im gosu-Binary gelinkt, aber keine os.Root-Funktion ist enthalten; gosu öffnet /etc/passwd und /etc/group mit os.Open. Beide Dateien gehören root (0644), und gosu hat kein setuid-Bit. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-56858](https://avd.aquasec.com/nvd/cve-2026-56858) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | html/template: golang: Go html/template: Cross-Site Scripting via pathological input |
| [CVE-2026-56859](https://avd.aquasec.com/nvd/cve-2026-56859) | HIGH | 1.25.13, 1.26.6, 1.27.0-rc.3 | Korrektur verfügbar | encoding/xml: golang: Go: Denial of Service via XML decoding recursion depth issue |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücken liegen in html/template und encoding/xml. Das gosu-Binary enthält keines der beiden Pakete; es rendert keine Templates und liest kein XML. (Stand 2026-10-13)

**github.com/moby/sys/user v0.1.0** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-61801](https://avd.aquasec.com/nvd/cve-2026-61801) | MEDIUM | 0.4.1 | Korrektur verfügbar | github.com/moby/sys/user: moby/sys/user: Denial of Service via crafted user or group database files |

Bewertung: **nicht betroffen** (Angreifer kann den verwundbaren Code nicht ansteuern) — MEDIUM, hier eigens bewertet, weil es der einzige Fund in Code ist, den gosu bei jedem Start ausführt: Das Einlesen einer präparierten passwd- oder group-Datei kann den Prozess am Speicher scheitern lassen. Dazu müsste ein Angreifer die Datei liefern; gosu liest /etc/passwd und /etc/group des Image, beide gehören root (0644), und gosu läuft einmal beim Start, bevor der Datenbankprozess läuft. (Stand 2026-10-13)

**golang.org/x/sys v0.1.0** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-39824](https://avd.aquasec.com/nvd/cve-2026-39824) | UNKNOWN | 0.44.0 | Korrektur verfügbar | Invoking integer overflow in NewNTUnicodeString in golang.org/x/sys/windows |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die Lücke liegt in NewNTUnicodeString, einer Funktion des Windows-Teils von golang.org/x/sys. Das Binary ist für Linux gebaut und enthält aus dem Modul nur golang.org/x/sys/unix. (Stand 2026-10-13)

**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-78659](https://avd.aquasec.com/nvd/cve-2026-78659) | UNKNOWN | 1.26.9, 1.27.2 | Korrektur verfügbar | When "Trailer" headers are sent by a client, the HTTP server internall ... |
| [CVE-2026-78660](https://avd.aquasec.com/nvd/cve-2026-78660) | UNKNOWN | 1.26.9, 1.27.2 | Korrektur verfügbar | Historically, we have been rather lax about malformed framing-related  ... |
| [CVE-2026-94440](https://avd.aquasec.com/nvd/cve-2026-94440) | UNKNOWN | 1.26.9, 1.27.2 | Korrektur verfügbar | Parsing a multipart form can bypass memory limits and read an arbitrar ... |
| [CVE-2026-97030](https://avd.aquasec.com/nvd/cve-2026-97030) | UNKNOWN | 1.26.9, 1.27.2 | Korrektur verfügbar | A trusted template author may have previously written a valid template ... |

Bewertung: **nicht betroffen** (verwundbarer Code nicht enthalten) — Die vier Meldungen (noch ohne Einstufung) liegen laut Go-Schwachstellendatenbank in net/http (HTTP/2, Server und Client), in net/textproto und mime/multipart (Multipart-Formulare) und in html/template. Das gosu-Binary enthält keines dieser Pakete. (Stand 2026-10-13)

### keycloak

**pcre2 10.40-6.el9** (RPM-Paket; installiert als: pcre2, pcre2-syntax)

| Kennung | Schweregrad | Korrigiert in | Laut Quelle | Kurzbeschreibung |
|---|---|---|---|---|
| [CVE-2026-103111](https://avd.aquasec.com/nvd/cve-2026-103111) | HIGH | – | keine Korrektur verfügbar | pcre2: pcre2: Out-of-bounds write via crafted regular expression |
| [CVE-2026-86145](https://avd.aquasec.com/nvd/cve-2026-86145) | HIGH | – | wird nicht korrigiert | pcre2: PCRE2: Out-of-bounds write allows arbitrary code execution via crafted regular expressions |
| [CVE-2026-89161](https://avd.aquasec.com/nvd/cve-2026-89161) | HIGH | – | keine Korrektur verfügbar | pcre2: PCRE2: Memory corruption vulnerability in pcre2_jit_match |

Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — libpcre2-8 wird im Image nur von libselinux und libpcre2-posix gebunden und darüber beim Start kurz in uname, readlink, dirname und sed geladen; die JVM, ihre eigenen Dateien und die Linux-Bibliotheken in den JARs binden sie nicht. Außer libpcre2-8 selbst enthält keine Datei des Image die Funktionen, in denen die drei Fehler liegen (JIT-Übersetzung und -Stack, pcre2_dfa_match); libselinux ruft nur pcre2_compile und pcre2_match auf, und zwar für SELinux-Regeldateien, die im Container fehlen. Geprüft an den Dateien, nicht an einem laufenden Keycloak. Maßnahme: Red Hat hat die drei Lücken mit RHSA-2026:81532 (pcre2-10.40-7.el9_8) am 2026-10-12 behoben; die Datenbank des Scanners kannte das am Tag des Scans noch nicht. Digest in deploy/keycloak/Dockerfile anheben, sobald ein Keycloak-Image vorliegt, das dieses Paket laut Scan enthält; am 2026-10-13 gab es noch keines. (Stand 2026-10-13)

## 4. Was der Scan nicht sieht

Der Scanner kennt, was in einem Paketverzeichnis des Images oder in einer mitgelieferten Stückliste steht, und meldet, was seine Datenbank dazu führt. Zu Programmen, die im Image aus dem Quelltext gebaut sind, zu fest eingebauten Bibliotheken ohne eigene Angabe und zu Korrekturen, die eine Distribution noch nicht als Sicherheitsmeldung führt, meldet er nichts — auch dann nicht, wenn es Meldungen gibt. Dafür gilt die Angabe von Hand; vollständig ist auch sie nicht.

| Komponente | Version | Angabe | Stand |
|---|---|---|---|
| Python (CPython), aus dem Quelltext gebaut | 3.14.8 | 3.14.8 vom 2026-09-30 ist die neueste Version der Reihe 3.14. Darin sind mindestens vier veröffentlichte Lücken offen: CVE-2026-87910 (tarfile) und CVE-2026-12345 (tempfile.TemporaryDirectory) — im 3.14-Zweig korrigiert, aber erst nach 3.14.8 —, CVE-2025-15367 (poplib) und CVE-2025-12781 (base64 mit eigenem Alphabet). Nicht betroffen: Im Betrieb lädt nichts tarfile oder poplib, und TemporaryDirectory wird nicht aufgerufen; bei base64 weist joserfc die fraglichen Zeichen selbst ab, und beim Sitzungs-Cookie ändert die Schreibweise den geprüften Inhalt nicht. Für die genutzten Teile der Standardbibliothek (email, json, http.cookies, urllib.parse, ssl) ist sonst keine offene Meldung bekannt. | 2026-10-13 |
| libexpat, fest in Python eingebaut | 2.8.5 | Offen sind CVE-2026-77214 und CVE-2026-102633 (nur 32 Bit) — beide in Expat 2.9.0 vom 2026-10-05 behoben — sowie CVE-2025-66382 (Rechenzeit, in keiner Expat-Version behoben); das Expat-Projekt führt daneben weitere, nicht öffentliche Meldungen. Nicht betroffen, solange die Anwendung kein XML verarbeitet: Weder sie noch ein installiertes Paket außer pip lädt pyexpat. | 2026-10-13 |
| mpdecimal und HACL*, fest in Python eingebaut | 2.5.1 | Nicht auf veröffentlichte Meldungen geprüft (Versionsangabe: mpdecimal). | 2026-10-13 |
| PostgreSQL, aus dem Quelltext gebaut | 18.6 | 18.6 vom 2026-08-13 ist die aktuelle Minor-Version der Reihe 18 und behebt 28 CVE. Die Sicherheitsseite von postgresql.org nennt für die Reihe 18 keine Lücke, die erst nach 18.6 behoben oder noch offen ist; der nächste planmäßige Termin ist der 2026-11-12. | 2026-10-13 |
| NGINX (Paket von nginx.org) | 1.30.5 | Der Scanner gleicht das Paket gegen die Datenbank von Alpine ab, obwohl es von nginx.org stammt; deshalb die Gegenprobe beim Hersteller: nginx.org führt 63 Sicherheitsmeldungen, 62 nennen einen verwundbaren Bereich, in dem 1.30.5 nicht liegt. Die Ausnahme ist CVE-2009-4487 (Steuerzeichen im Fehlerlog, vom Hersteller ohne Schweregrad und für alle Versionen geführt). 1.30.5 ist die aktuelle stabile Version. | 2026-10-13 |
| OpenSSL in den Images nginx und postgres (Alpine-Paket) | 3.5.8-r0 | **In Prüfung.** Der Hersteller hat am 2026-09-29 mit 3.5.9 dreizehn Lücken behoben (eine hoch eingestuft: CVE-2026-84782, DTLS; zwölf niedrig). Alpine bietet 3.5.9-r0 an, führt dazu aber noch keine Sicherheitsmeldung — der Scan zeigt deshalb nichts, und die gepinnten Basis-Images enthalten die Korrektur nicht. NGINX beendet in PROD und im Pilot die TLS-Verbindungen mit dieser Bibliothek; DTLS und QUIC nutzt die Konfiguration nicht. PostgreSQL bietet laut Voreinstellung des Image kein TLS an. Welche der zwölf übrigen hier greifen, ist nicht bewertet (siehe „Mögliche Maßnahmen“). Zum Vergleich: Das OpenSSL im api-Image ist ein Debian-Paket (3.5.7 mit zurückportierten Korrekturen), das der Scanner bewertet. | 2026-10-13 |
| OpenSSL in cryptography | 4.0.3 | 4.0.3 vom 2026-09-29 ist die neueste Patchversion der Linie 4.0; die Liste des Herstellers nennt keine Meldung, die sie betrifft. Die Anwendung nutzt diese Kopie für das Sitzungs-Cookie und die Signaturprüfung der ID-Tokens; TLS-Verbindungen laufen über das OpenSSL von Debian. | 2026-10-13 |
| psycopg-binary: libpq 18.6, OpenSSL 3.5.8, OpenLDAP 2.6.14, libcrypt (stehen in keiner Stückliste) | 3.3.6 | libpq 18.6 ist aktuell. OpenSSL 3.5.8 liegt eine Patchversion hinter 3.5.9 (dreizehn Meldungen, siehe oben); zwölf betreffen Funktionen, die libpq nicht nutzt, die dreizehnte (CVE-2026-35189, niedrig) setzt einen TLS-Handshake voraus. Der eigene Datenbank-Container bietet laut Voreinstellung des Image kein TLS an (am laufenden Server nicht nachgesehen); eine Gegenstelle, die sich im Docker-Netz als postgres ausgibt, könnte es. OpenLDAP 2.6.14 wird geladen, aber nur mit einer Service-Datei benutzt, die es im Image nicht gibt. Ein neueres psycopg-binary gibt es nicht. | 2026-10-13 |
| psycopg-binary: Bibliotheken aus CentOS 7 (Kerberos 1.15.1, Cyrus SASL 2.1.26, PCRE 8.32, libselinux 2.5 u. a.) | 3.3.6 | Die Pakete stehen in der Stückliste des Wheels; der Scanner hat sie erhalten und meldet dazu nichts, obwohl CentOS 7 seit 2024-06-30 keine Korrekturen mehr erhält und Red Hat für diese Stände offene Lücken führt (für die Client-Bibliotheken von Kerberos etwa CVE-2024-37370/-37371). Die Dateien werden beim Import von psycopg in den Prozess geladen (libselinux führt dabei eigenen Startcode aus); Eingaben von außen erreichen sie auf dem Weg der Anwendung (TCP, SCRAM-Passwort, eigene Datenbank) nicht — psycopg baut seine libpq mit gssencmode=disable. Erreichbar würden sie, wenn die Gegenstelle eine andere Anmeldemethode verlangte; das schließt require_auth in der DATABASE_URL aus (siehe „Mögliche Maßnahmen“). | 2026-10-13 |
| uvloop: libuv 1.52.1 | 0.23.0 | uvloop 0.23.0 ist die neueste Version und enthält libuv 1.52.1, eine Version hinter 1.53.0 (2026-09-24, ohne genannte CVE). Die bekannten CVE zu libuv betreffen nach ihren Beschreibungen ältere Versionen, Windows oder 32-Bit-Bauten (nicht je CVE gegen 1.52.1 geprüft). Alle Verbindungen der Anwendung laufen über diese Kopie. | 2026-10-13 |
| httptools: llhttp 9.4.3, http-parser 2.9.4 | 0.9.0 | httptools 0.9.0 ist die neueste Version und enthält laut Quellpaket llhttp 9.4.3, die neueste llhttp-Version; für beide ist keine offene Meldung verzeichnet. Zusätzlich liegt http-parser 2.9.4 bei (nur für die Zerlegung von URLs, Quelle seit 2022 archiviert); bekannte Schwächen dieses Stands sind nicht recherchiert. uvicorn parst damit jede Anfrage; Anfragen erreichen den Container nur über NGINX. | 2026-10-13 |
| Weitere fest eingebaute Bibliotheken: libyaml (PyYAML), libffi (cffi), QuickJS und Rust-Bibliotheken in ungeladenen NGINX-Modulen | – | Nicht geprüft. PyYAML wird beim Start der Anwendung nicht geladen, cffi mit libffi dagegen schon; die NGINX-Module njs und acme lädt die Konfiguration nicht. | 2026-10-13 |

## 5. Mögliche Maßnahmen

Was die Funde an der Quelle beseitigt oder ihre Voraussetzungen nimmt. Umgesetzt ist davon nichts, was nicht ausdrücklich so dasteht — die Entscheidung liegt beim Betrieb und der Informationssicherheit (offene Frage B10). Wo nichts anderes steht, ist die Wirkung erwartet, nicht nachgemessen.

| Maßnahme | Wirkung | Aufwand und Kehrseite |
|---|---|---|
| Pakete der Alpine-Images beim Bau nachziehen (`apk upgrade` in den Dockerfiles von nginx und postgres) | Hebt OpenSSL auf 3.5.9 (dreizehn Lücken, die der Scan nicht zeigt) und behebt die drei HIGH-Funde im nginx-Image sowie dessen MEDIUM-Funde. Für das nginx-Basis-Image sind die Pakete am 2026-10-13 als Aktualisierung verfügbar, für postgres ist das nicht nachgesehen. Die Pakete von nginx.org bleiben unberührt. | Klein im Code. Kehrseite: Derselbe Git-Stand ergibt je nach Bautag andere Paketstände — die Digest-Pins (ADR-0026) legen dann nur noch das Basis-Image fest; dazu eine neue Verbindung beim Bau (Paketquellen von Alpine). Alternative ohne diese Kehrseite: warten, bis das Basis-Image neu gebaut ist, und den Digest anheben. |
| NGINX auf das schlanke Basis-Image wechseln (`nginx:stable-alpine-slim`) | Entfernt 50 von 71 Paketen, darunter die ungenutzten Module samt libexpat und tiff (zwei der drei HIGH-Funde) — ohne Paketmanager beim Bau, die Digest-Pins bleiben wirksam. OpenSSL bleibt dabei auf dem Stand des Basis-Image. | Klein: FROM-Zeile in beiden NGINX-Dockerfiles, Konfiguration im Container prüfen. |
| liblzma5 im api-Image nachziehen (`apt-get update && apt-get install -y --only-upgrade liblzma5` im Dockerfile) | Sollte DSA-6549-1 beheben: Die korrigierte Version liegt seit 2026-10-07 in den Sicherheitsquellen von Debian. Sonst mit dem nächsten Basis-Image. | Klein. Dieselbe Kehrseite wie beim Nachziehen der Alpine-Pakete (Paketquellen von Debian beim Bau, kein fester Stand); die Zeile kann entfallen, sobald das Basis-Image die Korrektur enthält. |
| Anmeldeweg zur Datenbank festlegen: `require_auth=scram-sha-256` und `gssencmode=disable` in der DATABASE_URL | libpq lehnt laut Dokumentation jede andere Anmeldemethode ab, auch von einer gefälschten Gegenstelle; der Kerberos-Code der CentOS-7-Bibliotheken in psycopg-binary wäre dann nicht mehr erreichbar. | Etwa 0,25 PT: `.env.example`, README/RUNBOOK, Probe gegen den Server. `sslmode=disable` schlösse zusätzlich den TLS-Code der mitgelieferten OpenSSL-Kopie aus — eine Entscheidung, weil ein späteres TLS am Server dann ohne Wirkung bliebe. |
| gosu aus dem postgres-Image entfernen und den Container als Nutzer postgres starten | Der Scan sollte danach keinen der 60 gosu-Funde mehr melden, und der Container startet nicht mehr als root. | Etwa 0,5 PT: zwei Zeilen im Dockerfile, Start auf frischem und auf bestehendem Volume testen. Die Datei bleibt in der Basisschicht des Image enthalten. |
| Dienst api härten: `security_opt: ["no-new-privileges:true"]` und `cap_drop: ["ALL"]` in compose.yaml | Die setuid-Programme im Image (mount, su, passwd …) verlieren ihre Wirkung; damit entfällt die Voraussetzung der mount-Lücken unabhängig vom Inhalt der fstab, auch für künftige Lücken dieser Art. Die Funde bleiben im Scan stehen. | Klein: zwei Einträge, Integrationstest. |
| psycopg-binary durch die libpq des Betriebssystems ersetzen (`psycopg` ohne Extra plus Debian-Paket libpq5, oder `psycopg[c]`) | Die mitgelieferten Bibliotheken entfallen, darunter die sechs CentOS-7-Pakete und OpenSSL 3.5.8; libpq und ihre Abhängigkeiten kämen dann als Debian-Pakete, die der Scanner sieht und Debian pflegt. | Mittel (0,5–1,5 PT): Dockerfile, Lockfile, Tests. Kehrseiten: `psycopg` ohne Extra ist die reine Python-Fassung und laut psycopg-Dokumentation deutlich langsamer (Versanddurchsatz messen); `psycopg[c]` braucht beim Bau Compiler und libpq-dev. libpq käme als 17.x per apt aus Debian (Paketquellen beim Bau, kein fester Stand) und mit eigenen Scanner-Funden; ihre Vorgabe ist gssencmode=prefer — in der DATABASE_URL abschalten. |
| pip aus dem Laufzeit-Image entfernen | Nimmt die Funde unter „pip (mitgeliefert)“ aus dem Bericht. Der Code bleibt als Wheel für ensurepip im Image und läuft weiter in „make governance“; wirksam ist die Maßnahme erst, wenn auch das Wheel entfällt und das Werkzeug der Stückliste aus einem eigenen Image läuft. | Klein für den ersten Teil, etwa 1 PT für den zweiten. Im Betrieb wird pip in keinem Fall ausgeführt. |
| Nachziehen, sobald neue Stände vorliegen: Keycloak-Image mit der pcre2-Korrektur, python:3.14.9-slim (geplant 2026-12-01), psycopg-binary mit OpenSSL ab 3.5.9 | Erwartet: Die Keycloak-Funde entfallen; von den vier in Python 3.14.8 offenen Lücken die beiden, die im 3.14-Zweig schon korrigiert sind (tarfile, tempfile) — poplib und base64 bleiben; der Rückstand der OpenSSL-Kopie in psycopg-binary schließt sich. | Je Fall klein: Digest bzw. Pin anheben, `make check`, `make governance`. Wer das wie oft tut, ist offen (Frage B10). |
