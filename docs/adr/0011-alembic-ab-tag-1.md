# [ADR-0011] Alembic ab Tag 1, Migrationen nur additiv

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Die DB soll später ohne Umbau auf die zentrale Konzern-Infrastruktur wandern; Rollbacks müssen billig sein (Plan 4.3, 3.7).

## Entscheidung

Das Schema entsteht **ausschließlich** über Alembic-Migrationen (kein `create_all()`): 0001 = komplettes Schema, 0002 = idempotenter Topic-Seed. Der Container-Entrypoint führt `alembic upgrade head` mit DB-Warteschleife aus; die Test-Suite nutzt denselben Weg. **Migrationen dürfen nur additiv sein** (Regel in CONTRIBUTING.md).

## Konsequenzen

* **Positiv:** Migrationsstand kann nie von der Realität abweichen; DB-Cutover ist wirklich nur `DATABASE_URL` + Overlay weglassen (RUNBOOK 2); Release-Rollback = alter Image-Tag, ohne DB-Restore.
* **Negativ:** Destruktive Schemaänderungen brauchen einen expliziten Zwei-Schritt-Prozess (erst deprecaten, später aufräumen).

## Verworfene Alternativen

* **`Base.metadata.create_all()` im App-Start:** kein Migrationspfad, kein reproduzierbarer Stand.

## Nachtrag (2026-10-07)

Der oben genannte DB-Cutover entfällt: PostgreSQL läuft auch in PROD als Container auf der VM der Anwendung ([ADR-0030](0030-postgresql-im-container-auch-in-prod.md)). Die Entscheidung dieses ADR gilt unverändert.
