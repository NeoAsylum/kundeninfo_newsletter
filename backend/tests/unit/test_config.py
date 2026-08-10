import pytest
from pydantic import ValidationError

from tests.conftest import make_settings


def test_retention_leer_bedeutet_aus():
    s = make_settings(retention_days_recipients="", retention_days_audit="")
    assert s.retention_days_recipients is None
    assert s.retention_days_audit is None


def test_retry_backoff_wird_geparst():
    s = make_settings(worker_retry_backoff_s="60,300,900")
    assert s.retry_backoff == [60, 300, 900]


def test_session_secret_muss_lang_sein():
    with pytest.raises(ValidationError):
        make_settings(session_secret="zu-kurz")


def test_smtp_login_erfordert_credentials():
    with pytest.raises(ValidationError):
        make_settings(smtp_auth_mode="login", smtp_user="", smtp_password="")
    s = make_settings(smtp_auth_mode="login", smtp_user="u", smtp_password="p")
    assert s.smtp_auth_mode == "login"


def test_cookie_secure_folgt_https():
    assert make_settings(public_base_url="https://portal.example").cookie_secure is True
    assert make_settings(public_base_url="http://localhost:8080").cookie_secure is False


def test_callback_url():
    s = make_settings(public_base_url="http://localhost:8080")
    assert s.callback_url == "http://localhost:8080/auth/callback"
