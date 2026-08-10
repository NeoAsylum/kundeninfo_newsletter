# [ADR-0001] FastAPI als Backend-Framework

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Auswahl des Backend-Frameworks für das Self-Service-Portal.

## Entscheidung

Verwendung von Python 3.12+ mit **FastAPI** und uvicorn/gunicorn.

## Konsequenzen

* **Positiv:** Asynchroner I/O für Outbox-Worker und HTTP-Mocks, automatische OpenAPI/Swagger-Dokumentation, native Integration von Pydantic für Einstellungen und Request-Validierung.
* **Negativ:** Geringfügig mehr Boilerplate bei Datenbank-Sessions im Vergleich zu Full-Stack-Frameworks wie Django.

## Verworfene Alternativen

* **Flask:** Fehlt asynchrone I/O-Unterstützung nativ, veraltete Async-Pattern.
* **Django:** Zu mächtig (ORM/Admin UI für MVP überdimensioniert, widerspricht Einfachheits-Prinzip).
