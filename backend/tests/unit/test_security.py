import time

from app.core.security import (
    Identity,
    decode_payload,
    encode_payload,
    read_session,
    session_cookie_value,
)
from tests.conftest import make_settings


def test_session_roundtrip(settings):
    identity = Identity(sub="abc", email="a@b.c", display_name="A", roles=["employee"])
    cookie = session_cookie_value(settings, identity)
    restored = read_session(settings, cookie)
    assert restored == identity
    # Das Cookie trägt bewusst KEINE Berechtigung — Adminrechte stehen in der Datenbank
    # und werden je Anfrage geprüft (ADR-0022). Ein Recht im Cookie wäre unwiderrufbar.
    assert not hasattr(restored, "is_admin")


def test_manipuliertes_cookie_wird_verworfen(settings):
    cookie = session_cookie_value(settings, Identity(sub="x", email="x@y.z"))
    assert read_session(settings, cookie[:-4] + "AAAA") is None
    assert read_session(settings, "unsinn") is None
    assert read_session(settings, None) is None


def test_anderes_secret_invalidiert_sessions(settings):
    cookie = session_cookie_value(settings, Identity(sub="x", email="x@y.z"))
    other = make_settings(session_secret="anderes-secret-0123456789abcdef")
    assert read_session(other, cookie) is None  # Notfallhebel SESSION_SECRET-Rotation (9.5)


def test_abgelaufene_payload(settings):
    token = encode_payload(settings.session_secret, {"sub": "x"}, max_age=-1)
    assert decode_payload(settings.session_secret, token) is None


def test_payload_exp_in_zukunft(settings):
    token = encode_payload(settings.session_secret, {"sub": "x"}, max_age=60)
    data = decode_payload(settings.session_secret, token)
    assert data is not None and data["exp"] > time.time()
