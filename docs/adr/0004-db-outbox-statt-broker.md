# [ADR-0004] DB-Outbox + asyncio-Worker statt Celery/Redis

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Versand von bis zu ~5.000 Einzelmails je Störungsmeldung, wenige Versände pro Tag; Einfachheit ist explizite Anforderung (Plan 6.3).

## Entscheidung

Versandaufträge werden als **Outbox in der DB** persistiert (`dispatches` + `dispatch_recipients`, Status je Empfänger). Ein **asyncio-Worker-Loop im API-Prozess** (FastAPI-Lifespan) pollt, claimt atomar per `UPDATE … WHERE status='pending'`, sendet sequenziell und schreibt einen **Fortschritts-Heartbeat** (`last_progress_at`) bei jedem Tick — auch in Backoff-Wartephasen. Stale-Recovery setzt nur Aufträge mit stehengebliebenem Heartbeat zurück (kein In-Memory-Set nötig, da Single-Process).

**Harte Betriebsbedingung:** genau ein Prozess — `uvicorn --workers 1` ist im Dockerfile verankert und darf nicht „getunt“ werden.

## Konsequenzen

* **Positiv:** Kein Broker, keine zweite Infrastrukturkomponente; Dauerhaftigkeit liefert die DB; Wiederanlauf nach Crash setzt exakt bei verbliebenen Empfängern fort (Integrationstest).
* **Negativ:** Semantik ist **at-least-once** — Crash zwischen SMTP-250 und DB-Update kann eine einzelne Mail doppelt senden (akzeptiert, RUNBOOK).
* **Erweiterungspunkt:** separater Worker-Container mit `SELECT … FOR UPDATE SKIP LOCKED` bei mehreren Konsumenten; Tabellenmodell bleibt identisch.

## Verworfene Alternativen

* **Celery/Redis oder RabbitMQ:** zwei zusätzliche Komponenten mit eigenen Failure-Modes für ein Lastprofil, das ein asyncio-Loop mühelos schafft.
* **FastAPI BackgroundTasks ohne Persistenz:** Aufträge gingen bei Crash verloren.
