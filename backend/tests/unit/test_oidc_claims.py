import dataclasses

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


def test_identity_aus_claims():
    identity = _client().identity_from_claims(BASE_CLAIMS)
    assert identity.roles == ["employee"]
    assert identity.email == "mia.muster@example.corp"  # normalisiert
    assert identity.sub == "user-123"


def test_rollen_aus_dem_token_werden_ignoriert():
    """Adminrechte führt das Portal (users.is_admin, ADR-0022) — ein Rollen-Claim im
    Token darf keine Berechtigung erzeugen, auch nicht den früheren Wert
    `stoerungsinfo-admin`. Sonst entstünde eine Rolle, die niemand mehr widerrufen kann.
    """
    for rollen in (["stoerungsinfo-admin"], ["admin"], [], ["uma_authorization"]):
        claims = dict(BASE_CLAIMS, realm_access={"roles": rollen})
        assert _client().identity_from_claims(claims).roles == ["employee"]


def test_email_claim_konfigurierbar():
    claims = {"sub": "s", "preferred_username": "upn@example.corp"}
    identity = _client(oidc_email_claim="preferred_username").identity_from_claims(claims)
    assert identity.email == "upn@example.corp"


def test_fehlender_email_claim_wirft():
    with pytest.raises(OidcError):
        _client().identity_from_claims({"sub": "s"})


@pytest.mark.parametrize(
    "email",
    [
        ["mia@example.corp"],
        {"value": "mia@example.corp"},
        True,
        12345,
        " ",
        "mia.example.corp",
        "@example.corp",
        "mia@",
        "mia@example.corp, chef@example.corp",
        "Mia <mia@example.corp>",
        "mia muster@example.corp",
        "mia@example.corp\r\nBcc: x@example.corp",
        "mia@example.corp\x00",
        "m" * 310 + "@example.corp",
    ],
    ids=[
        "liste",
        "objekt",
        "true",
        "zahl",
        "leer",
        "ohne-at",
        "ohne-lokalteil",
        "ohne-domain",
        "zwei-adressen",
        "mit-anzeigename",
        "leerzeichen",
        "zeilenumbruch",
        "nullzeichen",
        "ueberlang",
    ],
)
def test_email_claim_muss_eine_adresse_sein(email):
    """Der Wert wird als Empfängeradresse gespeichert. Per str() entstünde aus einer Liste
    die Scheinadresse "['mia@example.corp']" statt eines Anmeldefehlers."""
    with pytest.raises(OidcError) as fehler:
        _client().identity_from_claims({"sub": "s", "email": email})
    # Die Meldung wird geloggt — der Wert des Claims gehört nicht hinein (ADR-0014)
    assert "example.corp" not in str(fehler.value)


def test_email_claim_wird_von_leerraum_befreit():
    identity = _client().identity_from_claims({"sub": "s", "email": " Mia@Example.Corp\n"})
    assert identity.email == "mia@example.corp"


@pytest.mark.parametrize(
    "email",
    [
        "mia+portal@example.corp",
        "m.muster-2@sub.example.corp",
        "MIA@EXAMPLE.CORP",
        "ö@bücher.example",
    ],
)
def test_uebliche_adressformen_werden_angenommen(email):
    """Die Prüfung soll Listen und Müll abweisen, nicht echte Adressen."""
    assert _client().identity_from_claims({"sub": "s", "email": email}).email == email.lower()


def test_namen_aus_dem_token_werden_nicht_uebernommen():
    """ADR-0025/0028: Auch wenn ein IdP Namens-Claims mitschickt, trägt die Identität
    nur sub, Adresse und Basisrolle."""
    claims = dict(BASE_CLAIMS, given_name="Mia", family_name="Muster", preferred_username="mm")
    assert dataclasses.asdict(_client().identity_from_claims(claims)) == {
        "sub": "user-123",
        "email": "mia.muster@example.corp",
        "roles": ["employee"],
    }


def test_fehlender_sub_claim_wirft():
    """sub ist der Identitätsanker (ADR-0010) — ohne ihn OidcError statt KeyError/500."""
    with pytest.raises(OidcError):
        _client().identity_from_claims({"email": "x@y.z"})


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
