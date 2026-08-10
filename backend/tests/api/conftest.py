"""API-Tests: FastAPI in-process (httpx ASGITransport) gegen MariaDB-tmpfs (ADR-015).

Auth läuft über ECHTE Session-Cookies (Fernet mit Test-Secret) — kein
Dependency-Override, die Tests decken damit auch die Cookie-Mechanik ab.
Schema via `alembic upgrade head` (ADR-011); Topics kommen aus Migration 0002
und bleiben stehen, alle anderen Tabellen werden pro Test geleert.
"""

import pathlib

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core.security import Identity, session_cookie_value
from app.db.models import User
from app.main import create_app
from tests.conftest import make_settings

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[2]
CLEAN_TABLES = ("audit_log", "dispatch_recipients", "dispatches", "subscriptions", "users")


@pytest.fixture(scope="session")
def api_settings():
    return make_settings()


@pytest.fixture(scope="session", autouse=True)
def migrated_db(api_settings):
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "app" / "db" / "alembic"))
    cfg.set_main_option(
        "sqlalchemy.url", api_settings.database_url.replace("+aiomysql", "+pymysql")
    )
    command.upgrade(cfg, "head")


@pytest.fixture
async def make_app(api_settings):
    """App-Fabrik pro Test (eigene Engine je Event-Loop, Teardown disposed)."""
    apps = []

    def _make(**overrides):
        settings = make_settings(**overrides) if overrides else api_settings
        application = create_app(settings)
        apps.append(application)
        return application

    yield _make
    for application in apps:
        await application.state.engine.dispose()


@pytest.fixture
async def app(make_app):
    return make_app()


@pytest.fixture(autouse=True)
async def clean_db(app):
    async with app.state.sessionmaker() as session:
        await session.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in CLEAN_TABLES:
            await session.execute(text(f"DELETE FROM {table}"))
        await session.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        await session.commit()
    yield


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def make_user(app):
    async def _make(
        sub: str = "sub-user-1",
        email: str = "user1@example.corp",
        name: str | None = "User Eins",
        active: bool = True,
    ) -> User:
        async with app.state.sessionmaker() as session:
            user = User(oidc_sub=sub, email=email, display_name=name, is_active=active)
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    return _make


@pytest.fixture
def auth_headers(api_settings):
    """Echte Session-Cookies + CSRF-Header, wie sie der fetch-Wrapper setzt."""

    def _headers(sub: str, email: str, roles: list[str] | None = None) -> dict[str, str]:
        identity = Identity(sub=sub, email=email, roles=roles or ["employee"])
        cookie = session_cookie_value(api_settings, identity)
        return {"Cookie": f"session={cookie}", "X-Requested-With": "fetch"}

    return _headers
