"""App-Lebenszyklus (main.lifespan): Start und Stopp von Outbox-Worker und Retention.

Die übrigen API-Tests laufen über httpx.ASGITransport, das keine Lifespan-Ereignisse
sendet — ohne diese Datei liefe der Start-/Stopp-Code in keinem Test.
"""

import asyncio
import logging
from unittest.mock import MagicMock

import httpx
from fastapi import FastAPI
from opentelemetry import _logs, metrics, trace

HINTERGRUND = {"outbox-worker", "retention"}


def _laufende() -> set[str]:
    return {t.get_name() for t in asyncio.all_tasks() if not t.done()} & HINTERGRUND


async def test_start_und_stopp_mit_worker(make_app):
    app = make_app(worker_enabled=True)
    ticks: list[BaseException | None] = []
    zwei_ticks = asyncio.Event()

    async with app.router.lifespan_context(app):
        assert _laufende() == HINTERGRUND

        # Mitzählen statt Logs lesen: run() fängt Tick-Fehler ab und loggt sie nur
        worker = app.state.worker
        echter_tick = worker.tick

        async def tick() -> None:
            try:
                await echter_tick()
                ticks.append(None)
            except Exception as exc:
                ticks.append(exc)
                raise
            finally:
                if len(ticks) >= 2:
                    zwei_ticks.set()

        worker.tick = tick
        # Zwei Ticks gegen die echte DB abwarten (Poll-Intervall im Test: 0,05 s)
        await asyncio.wait_for(zwei_ticks.wait(), timeout=10)
        assert _laufende() == HINTERGRUND

    assert _laufende() == set()  # Stopp räumt beide Tasks ab
    assert ticks == [None] * len(ticks)  # ein leerer Tick läuft fehlerfrei durch


async def test_ohne_worker_startet_kein_hintergrundtask(make_app):
    app = make_app()  # worker_enabled=False ist der Test-Standard
    async with app.router.lifespan_context(app):
        assert _laufende() == set()


def test_migration_im_prozess_schaltet_das_app_logging_nicht_ab():
    """Regression: `fileConfig` in alembic/env.py deaktivierte alle bestehenden Logger.
    Die Session-Fixture `migrated_db` migriert im Testprozess — danach kam aus `app.*`
    kein Log mehr an, und fehlgeschlagene Tests zeigten keine Fehlermeldung der Anwendung.
    """
    for name in ("app.mail.worker", "app.api.auth", "app.core.oidc", "app.domain.users"):
        assert not logging.getLogger(name).disabled, name


async def test_die_telemetrie_von_fastapi_ist_ausgeschaltet(app, client, monkeypatch):
    """FastAPI bringt seit 0.142 OpenTelemetry mit und zeichnete, sobald ein Provider
    eingerichtet ist, zu jeder Anfrage Pfad und Query-String auf — also die Adresse aus der
    Empfängersuche (ADR-0014). Die Anwendung schaltet das ausdrücklich ab. `_telemetry` ist
    privat: Einen öffentlichen Zugriff bietet FastAPI nicht, und fällt das Attribut bei einem
    Upgrade weg, soll dieser Test es melden."""
    eingestellt = app._telemetry
    assert {k: eingestellt[k] for k in ("tracing", "metrics", "logs", "auto_configure")} == {
        "tracing": False,
        "metrics": False,
        "logs": False,
        "auto_configure": False,
    }

    # Die Wirkung, nicht nur die Schlüssel: FastAPI übernimmt sie ungeprüft — hieße einer nach
    # einem Upgrade anders, bliebe die Prüfung oben grün. Deshalb findet FastAPI hier für
    # Traces, Metriken und Logs einen eingerichteten Provider vor. Gesetzt wird keiner (das
    # ginge je Prozess nur einmal und bliebe für alle folgenden Tests), ersetzt wird nur die
    # Abfrage danach.
    spion = MagicMock()
    for modul, abfrage in (
        (trace, "get_tracer_provider"),
        (metrics, "get_meter_provider"),
        (_logs, "get_logger_provider"),
    ):
        monkeypatch.setattr(modul, abfrage, lambda: spion)
    suche = {"query": "person@firma.example"}

    assert app._native_telemetry.enabled() is False
    await client.get("/api/v1/admin/users", params=suche)
    assert spion.mock_calls == []

    # Gegenprobe: Ohne die Angabe in main.py zeichnet FastAPI dieselbe Anfrage über dieselben
    # Provider auf — samt Adresse.
    ohne_angabe = httpx.ASGITransport(app=FastAPI())
    async with httpx.AsyncClient(transport=ohne_angabe, base_url="http://testserver") as c:
        await c.get("/api/v1/admin/users", params=suche)
    assert "query=person%40firma.example" in str(spion.mock_calls)
