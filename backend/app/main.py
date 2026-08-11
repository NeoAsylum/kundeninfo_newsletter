"""App-Fabrik (Plan 8.1): create_app(settings) — alle externen Endpunkte im Settings-Objekt."""

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import (
    admin,
    admin_topics,
    admin_users,
    auth,
    dispatches,
    health,
    me,
    subscriptions,
    topics,
)
from app.api.errors import ApiError
from app.core.config import Settings
from app.core.logging import request_id_var, setup_logging
from app.core.oidc import OidcClient
from app.db.base import make_engine, make_sessionmaker
from app.mail.worker import OutboxWorker, retention_loop

log = logging.getLogger(__name__)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def create_app(settings: Settings | None = None) -> FastAPI:
    # Pflichtfelder kommen aus der Umgebung (.env) — pydantic validiert laut beim Start
    settings = settings or Settings()  # type: ignore[call-arg]
    setup_logging(settings.log_level)

    engine = make_engine(settings.database_url)
    sessionmaker = make_sessionmaker(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks: list[asyncio.Task] = []
        worker = OutboxWorker(sessionmaker, settings)
        app.state.worker = worker
        if settings.worker_enabled:
            tasks.append(asyncio.create_task(worker.run(), name="outbox-worker"))
            tasks.append(
                asyncio.create_task(retention_loop(sessionmaker, settings), name="retention")
            )
        yield
        worker.stop()
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        await engine.dispose()

    app = FastAPI(
        title="Störungsinfo-Portal",
        version=os.getenv("APP_VERSION", "dev"),
        lifespan=lifespan,
        docs_url="/docs" if settings.is_dev else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.is_dev else None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = sessionmaker
    app.state.oidc = OidcClient(settings)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id_var.set(request.headers.get("x-request-id", "-"))
        return await call_next(request)

    @app.middleware("http")
    async def csrf_protect(request: Request, call_next):
        """Ein CSRF-Mechanismus (Plan 5.6): SameSite=Lax + Custom-Header-Pflicht.

        Cross-Site kann ein Browser beides nicht kombinieren, ohne am CORS-Preflight
        zu scheitern; der fetch-Wrapper des Frontends setzt den Header zentral.
        """
        if (
            request.url.path.startswith("/api/")
            and request.method in MUTATING_METHODS
            and request.headers.get("x-requested-with") != "fetch"
        ):
            return JSONResponse(
                {"detail": "CSRF-Schutz: Header X-Requested-With fehlt", "code": "CSRF"},
                status_code=403,
            )
        return await call_next(request)

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return JSONResponse(
            {
                "detail": f"Ungültige Eingabe ({field}): {first.get('msg', 'Validierungsfehler')}",
                "code": "VALIDATION_ERROR",
            },
            status_code=422,
        )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router, prefix="/api/v1")
    app.include_router(topics.router, prefix="/api/v1")
    app.include_router(subscriptions.router, prefix="/api/v1")
    app.include_router(dispatches.router, prefix="/api/v1")
    app.include_router(admin.router, prefix="/api/v1/admin")
    app.include_router(admin_users.router, prefix="/api/v1/admin")
    app.include_router(admin_topics.router, prefix="/api/v1/admin")
    return app
