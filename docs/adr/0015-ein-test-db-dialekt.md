# [ADR-0015] Ein Test-DB-Dialekt: derselbe wie PROD (tmpfs) statt SQLite-Zweigleisigkeit

* **Status:** Akzeptiert · Dialekt seit [ADR-0027](0027-postgresql-statt-mariadb.md) **PostgreSQL** (vorher MariaDB)
* **Datum:** 2026-08-10 (Dialektwechsel 2026-08-13)
* **Kontext:** API-Tests brauchen eine DB; SQLite-in-memory wäre bequem, weicht aber vom PROD-Dialekt ab (Plan 8.1/8.3).

## Entscheidung

Die **Kernentscheidung** bleibt: API-Tests laufen gegen **denselben DB-Dialekt wie PROD**, in einem Container mit tmpfs-Datenverzeichnis (Compose-Profil `test`, Host-Port 3307), Schema via `alembic upgrade head`. Unit-Tests laufen ganz ohne DB (< 30 s). Bewusst ohne testcontainers-Bibliothek — `docker compose --profile test up -d --wait postgres-test` im Makefile tut dasselbe transparent.

Seit ADR-0027 ist dieser Dialekt **PostgreSQL** (`postgres-test`, `postgres:16-alpine`); zuvor MariaDB (`mariadb-test`).

## Konsequenzen

* **Positiv:** Dialekt-Fallen (Enum-Typen, Booleans, `ON CONFLICT`, Constraints) werden im Entwickler-Loop gefangen, nicht erst in der Pipeline; das DDL darf Dialekt-Features nutzen.
* **Negativ:** API-Tests brauchen Docker (ist ohnehin DEV-Grundvoraussetzung).

## Verworfene Alternativen

* **SQLite parallel:** zwei dauerhaft kompatibel zu haltende Dialekte = zwei Mechanismen für ein Ziel (Leitplanke 1).
* **testcontainers-python:** Image-Pull-Magie hinter Konzern-Proxy, ohne Mehrwert gegenüber Compose.

## Nachtrag (2026-10-12)

Die Test-DB `postgres-test` läuft auf `postgres:18-alpine` — demselben, per Digest gepinnten Stand wie `deploy/postgres/Dockerfile` (ein Test hält beide zusammen). Die Entscheidung dieses ADR gilt unverändert.
