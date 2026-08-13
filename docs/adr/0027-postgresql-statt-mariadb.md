# [ADR-0027] PostgreSQL statt MariaDB (Treiber psycopg3)

* **Status:** Akzeptiert (löst [ADR-0019](0019-aiomysql-und-pool-recycle.md) ab, aktualisiert [ADR-0015](0015-ein-test-db-dialekt.md))
* **Datum:** 2026-08-13
* **Kontext:** Entscheidung des Auftraggebers, von MariaDB auf **PostgreSQL** zu wechseln. Betroffen sind die Anwendung *und* Keycloak. Der Plan (3.4) und ADR-0019 gingen von MySQL/MariaDB aus; die Migrationskette und der Betrieb waren darauf ausgelegt.

## Entscheidung

**PostgreSQL 16** als Speicher, Treiber **psycopg3** (`postgresql+psycopg://`). Ein Treiber deckt beides ab: die asynchrone Laufzeit (`create_async_engine`) **und** die synchronen Alembic-Migrationen (`create_engine`) — das URL-Umschreiben `+aiomysql`→`+pymysql` aus ADR-0019 entfällt.

* **Image mit Init-Skript, gebacken statt Bind-Mount** (R10): `deploy/postgres/` baut `postgres:16-alpine` plus `docker-entrypoint-initdb.d/10-init.sh`. Das Skript legt beim ersten Start die App-Rolle (Eigentümerin der DB `newsletter`, **kein** Superuser) und — nur wo Keycloak an Postgres hängt (`KC_DB_PASSWORD` gesetzt) — eine getrennte `keycloak`-Rolle samt eigener DB an. Damit bleibt das Trennungsmodell aus dem MariaDB-Aufbau erhalten (eine Lücke im api-Container reicht nicht bis an Keycloaks Passwort-Hashes), ohne manuelles SQL im Deploy.
* **`pool_pre_ping` wieder aktiv:** psycopg3 hat die aiomysql-Ping-Inkompatibilität (ADR-0019) nicht. `pool_recycle=1800` bleibt als zweite Absicherung gegen von Firewalls getrennte Idle-Verbindungen.
* **Native Typen:** Booleans (`true`/`false` statt `0`/`1`), Enum-Typen (`CREATE TYPE`), `Text` statt `MEDIUMTEXT`. Upserts über `ON CONFLICT … DO NOTHING` statt `ON DUPLICATE KEY UPDATE`.
* **Transaktionales DDL:** Eine fehlgeschlagene Migration rollt vollständig zurück; die Idempotenz-Prüfung in Migration 0003 (ADR gegen den „Spalte da, Revision nicht"-Zwischenzustand unter MariaDB) bleibt als harmloser Gürtel-und-Hosenträger.
* **Backup:** `pg_dump` je Datenbank (Schema + Daten, ohne Rollen/`CREATE DATABASE`); die Rollen und leeren DBs stellt beim Restore das Init-Skript des frischen Clusters. Kein Passwort-Material im Dump (RUNBOOK 3).

## Konsequenzen

* **Positiv:** Ein Treiber statt zwei (aiomysql + PyMySQL), kein URL-Rewriting mehr; `pool_pre_ping` ohne Workaround; transaktionale Migrationen; native Boolean-/Enum-Typen.
* **Negativ / Risiken:**
  * **Bestehende VM-Daten sind ein separater Schritt.** Das `db_data`-Volume der laufenden Demo-VM enthält MariaDB-Daten; PostgreSQL startet darauf nicht. Der Cutover erfordert dort entweder einen frischen Start (Demo-Daten neu anlegen) oder eine Dump-basierte Datenmigration — **hier nicht durchgeführt**, die VM bleibt vorerst auf MariaDB, bis der Umstieg dort bewusst vollzogen wird.
  * **Die externe Konzern-DB (Frage B3) muss PostgreSQL-kompatibel sein.** Stellt der Konzern nur MySQL/MariaDB bereit, wäre ein erneuter Treiber-/Dialektwechsel nötig.
  * **Windows-Testlauf:** psycopg3-async braucht dort den `WindowsSelectorEventLoopPolicy` (in `tests/conftest.py` gesetzt) — reine Testsache, im Linux-Container ohne Wirkung.

## Verworfene Alternativen

* **asyncpg:** schnell, aber kein synchroner Zwilling für Alembic → wieder zwei Treiber und URL-Rewriting; die abweichenden `connect_args`/Typen-Adapter bringen ohne Lastbedarf keinen Mehrwert.
* **Bei MariaDB bleiben:** widerspricht der Auftraggeber-Entscheidung.
* **Keycloak weiter auf eigener Engine (z. B. H2/MariaDB), nur die App auf Postgres:** zwei DB-Technologien im selben Stack ohne Not — die getrennte `keycloak`-Rolle in derselben Postgres-Instanz erfüllt die Isolationsanforderung einfacher.
