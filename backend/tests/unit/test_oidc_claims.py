import pytest

from app.core.oidc import OidcClient, OidcError, claim_path
from tests.conftest import make_settings


def test_claim_path_punktnotation():
    claims = {"realm_access": {"roles": ["a", "b"]}, "email": "x@y.z"}
    assert claim_path(claims, "realm_access.roles") == ["a", "b"]
    assert claim_path(claims, "email") == "x@y.z"
    assert claim_path(claims, "fehlt.auch") is None


def _client(**overrides) -> OidcClient:
    return OidcClient(make_settings(**overrides))


BASE_CLAIMS = {
    "sub": "user-123",
    "email": "Mia.Muster@Example.Corp",
    "name": "Mia Muster",
    "realm_access": {"roles": ["uma_authorization", "stoerungsinfo-admin"]},
}


def test_identity_admin_rolle_wird_gemappt():
    identity = _client().identity_from_claims(BASE_CLAIMS)
    assert identity.roles == ["employee", "admin"]
    assert identity.email == "mia.muster@example.corp"  # normalisiert
    assert identity.sub == "user-123"


def test_identity_ohne_admin_rolle():
    claims = dict(BASE_CLAIMS, realm_access={"roles": ["irgendwas"]})
    identity = _client().identity_from_claims(claims)
    assert identity.roles == ["employee"]
    assert not identity.is_admin


def test_email_claim_konfigurierbar():
    claims = {"sub": "s", "preferred_username": "upn@example.corp"}
    identity = _client(oidc_email_claim="preferred_username").identity_from_claims(claims)
    assert identity.email == "upn@example.corp"


def test_fehlender_email_claim_wirft():
    with pytest.raises(OidcError):
        _client().identity_from_claims({"sub": "s"})


def test_split_horizon_url_rewrite():
    client = _client(
        oidc_issuer_url="http://localhost:8081/realms/dev",
        oidc_internal_base_url="http://keycloak:8081",
    )
    assert (
        client._to_internal("http://localhost:8081/realms/dev/protocol/openid-connect/token")
        == "http://keycloak:8081/realms/dev/protocol/openid-connect/token"
    )
    # Browser-URLs (fremder Host) bleiben unangetastet
    assert client._to_internal("http://other/x") == "http://other/x"


def test_ohne_internal_base_keine_umschreibung():
    client = _client(oidc_issuer_url="https://login.example/tenant/v2.0")
    url = "https://login.example/tenant/v2.0/token"
    assert client._to_internal(url) == url


def test_internal_base_url_mit_pfad_verdoppelt_nicht():
    """Regression: OIDC_INTERNAL_BASE_URL mit Pfad ergab /idp/idp/... → 404.
    Nur der Origin wird ersetzt, der Pfad kommt aus der Issuer-URL."""
    client = _client(
        oidc_issuer_url="https://portal.example/idp/realms/dev",
        oidc_internal_base_url="http://keycloak:8081/idp",
    )
    assert (
        client._to_internal(
            "https://portal.example/idp/realms/dev/.well-known/openid-configuration"
        )
        == "http://keycloak:8081/idp/realms/dev/.well-known/openid-configuration"
    )


def test_internal_base_url_ohne_pfad_bleibt_korrekt():
    client = _client(
        oidc_issuer_url="https://portal.example/idp/realms/dev",
        oidc_internal_base_url="http://keycloak:8081",
    )
    assert client._to_internal("https://portal.example/idp/realms/dev/protocol/token") == (
        "http://keycloak:8081/idp/realms/dev/protocol/token"
    )
