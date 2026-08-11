"""Health-Endpunkte (Plan 3.3): /healthz = Liveness, /readyz = externes Monitoring."""

import asyncio
import logging
import os
import time
from datetime import timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import select, text

from app.core.clock import utcnow
from app.db.models import Dispatch, DispatchStatus

log = logging.getLogger(__name__)
router = APIRouter()

BACKLOG_MAX_AGE_S = 900  # Rückstau: ältester offener Versand > 15 min → degraded
_SMTP_CACHE_TTL_S = 60
_smtp_cache: dict[str, object] = {"at": 0.0, "ok": True, "error": ""}


@router.get("/healthz")
async def healthz() -> dict:
    return {
        "status": "ok",
        "version": os.getenv("APP_VERSION", "dev"),
        "git_sha": os.getenv("GIT_SHA", "unknown"),
    }


async def _check_smtp(host: str, port: int) -> tuple[bool, str]:
    now = time.time()
    if now - float(_smtp_cache["at"]) < _SMTP_CACHE_TTL_S:  # type: ignore[arg-type]
        return bool(_smtp_cache["ok"]), str(_smtp_cache["error"])
    ok, error = True, ""
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=3)
        writer.close()
    except Exception as exc:
        ok, error = False, str(exc)
    _smtp_cache.update({"at": now, "ok": ok, "error": error})
    return ok, error


@router.get("/readyz")
async def readyz(request: Request, response: Response) -> dict:
    settings = request.app.state.settings
    checks: dict[str, str] = {}

    # Nach außen nur generische Zustände — /readyz ist unauthentifiziert erreichbar,
    # Verbindungsfehler enthielten sonst DB-/Relay-Hosts aus dem DSN.
    # Details stehen im Log.
    try:
        async with request.app.state.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:
        log.warning("readyz: DB-Check fehlgeschlagen: %s", exc)
        checks["db"] = "fehler"

    smtp_ok, smtp_error = await _check_smtp(settings.smtp_host, settings.smtp_port)
    if not smtp_ok:
        log.warning("readyz: SMTP-Check fehlgeschlagen: %s", smtp_error)
    checks["smtp"] = "ok" if smtp_ok else "fehler"

    checks["outbox"] = "ok"
    if checks["db"] == "ok":
        try:
            threshold = utcnow() - timedelta(seconds=BACKLOG_MAX_AGE_S)
            async with request.app.state.sessionmaker() as session:
                oldest_open = (
                    await session.execute(
                        select(Dispatch.id)
                        .where(
                            Dispatch.status.in_([DispatchStatus.pending, DispatchStatus.sending]),
                            Dispatch.created_at < threshold,
                        )
                        .limit(1)
                    )
                ).scalar_one_or_none()
            if oldest_open is not None:
                checks["outbox"] = f"rückstau: Versand {oldest_open} älter als {BACKLOG_MAX_AGE_S}s"
        except Exception as exc:
            log.warning("readyz: Outbox-Check fehlgeschlagen: %s", exc)
            checks["outbox"] = "fehler"

    degraded = any(v != "ok" for v in checks.values())
    if degraded:
        response.status_code = 503
    return {"status": "degraded" if degraded else "ok", "checks": checks}
