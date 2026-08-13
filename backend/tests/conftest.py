import asyncio
import pathlib
import sys

import pytest

# psycopg3 (async) läuft unter Windows nicht mit dem Default-ProactorEventLoop — nur der
# SelectorEventLoop unterstützt die nötigen Socket-Reader. Betrifft NUR die lokale
# Testausführung auf Windows; im Linux-Container/CI ein No-op. Die Anwendung selbst läuft
# ausschließlich im Container.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.core.config import Settings  # noqa: E402

TEST_DB_URL_DEFAULT = "postgresql+psycopg://postgres:test@localhost:3307/newsletter_test"


def make_settings(**overrides) -> Settings:
    import os

    defaults = dict(
        app_env="dev",
        public_base_url="http://testserver",
        database_url=os.environ.get("TEST_DATABASE_URL", TEST_DB_URL_DEFAULT),
        oidc_issuer_url="http://idp.test/realms/test",
        oidc_client_id="test-client",
        oidc_client_secret="test-secret",
        session_secret="unit-test-session-secret-0123456789",
        smtp_host="127.0.0.1",
        smtp_port=1025,
        mail_from="stoerungsinfo@test.local",
        mail_from_name="Störungsinfo (Test)",
        worker_enabled=False,
        worker_poll_interval_s=0.05,
    )
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.fixture
def settings() -> Settings:
    return make_settings()
