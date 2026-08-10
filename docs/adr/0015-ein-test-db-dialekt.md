# [ADR-0015] Ein Test-DB-Dialekt: MariaDB (tmpfs) statt SQLite-Zweigleisigkeit

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** API-Tests brauchen eine DB; SQLite-in-memory wäre bequem, weicht aber vom PROD-Dialekt ab (Plan 8.1/8.3).

## Entscheidung

API-Tests laufen gegen einen **MariaDB-Container mit tmpfs-Datenverzeichnis** (`mariadb-test`, Compose-Profil `test`, Host-Port 3307), Schema via `alembic upgrade head`. Unit-Tests laufen ganz ohne DB (< 30 s). Bewusst ohne testcontainers-Bibliothek — `docker compose --profile test up -d --wait mariadb-test` im Makefile tut dasselbe transparent.

## Konsequenzen

* **Positiv:** Dialekt-Fallen (ENUM, `ON UPDATE CURRENT_TIMESTAMP`, Kollation, Constraints) werden im Entwickler-Loop gefangen, nicht erst in der Pipeline; das DDL darf MySQL-Features nutzen.
* **Negativ:** API-Tests brauchen Docker (ist ohnehin DEV-Grundvoraussetzung).

## Verworfene Alternativen

* **SQLite parallel:** zwei dauerhaft kompatibel zu haltende Dialekte = zwei Mechanismen für ein Ziel (Leitplanke 1).
* **testcontainers-python:** Image-Pull-Magie hinter Konzern-Proxy, ohne Mehrwert gegenüber Compose.
