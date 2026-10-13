"""OIDC-Client gegen eine IdP-Attrappe: Authorize-URL, Code-Tausch, Token-Validierung.

Kein Netz — die Attrappe hängt als httpx-Transport im Client (tests/fake_idp.py).
"""

import base64
import contextlib
import hashlib
import json
import time

import httpx
import pytest
from joserfc import jwt
from joserfc.jwk import ECKey

from app.core.oidc import OidcClient, OidcError
from tests.conftest import make_settings
from tests.fake_idp import SCHLUESSEL_A, SCHLUESSEL_A_GEFAELSCHT, SCHLUESSEL_B, FakeIdp

KOPF = {"alg": "RS256", "kid": "key-a"}


@pytest.fixture
def idp(settings) -> FakeIdp:
    return FakeIdp(settings)


@pytest.fixture
def oidc(settings, idp) -> OidcClient:
    return OidcClient(settings, transport=idp.transport)


async def _login_starten(oidc: OidcClient, idp: FakeIdp) -> dict:
    url, state = await oidc.build_authorize_redirect()
    idp.erwarte(url)
    return state


def _claims(idp: FakeIdp, **abweichung) -> dict:
    return {
        "iss": idp.issuer,
        "aud": idp.client_id,
        "exp": int(time.time()) + 300,
        "sub": "idp-sub-1",
        **abweichung,
    }


async def test_authorize_url_traegt_state_nonce_und_pkce(oidc, idp, settings):
    url, state = await oidc.build_authorize_redirect()
    assert url.startswith(idp.issuer + "/auth?")
    params = idp.erwarte(url)
    assert params["client_id"] == settings.oidc_client_id
    assert params["response_type"] == "code"
    assert params["redirect_uri"] == "http://testserver/auth/callback"
    assert params["scope"] == "openid email"  # kein `profile`: keine Namen (ADR-0028)
    assert params["state"] == state["state"]
    assert params["nonce"] == state["nonce"]
    assert params["code_challenge_method"] == "S256"
    erwartet = base64.urlsafe_b64encode(hashlib.sha256(state["verifier"].encode()).digest())
    assert params["code_challenge"] == erwartet.rstrip(b"=").decode()
    assert "prompt" not in params


async def test_jeder_login_bekommt_frische_zufallswerte(oidc):
    _, erster = await oidc.build_authorize_redirect()
    _, zweiter = await oidc.build_authorize_redirect()
    for feld in ("state", "nonce", "verifier"):
        assert erster[feld] != zweiter[feld]


async def test_prompt_wird_durchgereicht(oidc, idp):
    url, _ = await oidc.build_authorize_redirect(prompt="login")
    assert idp.erwarte(url)["prompt"] == "login"


async def test_scopes_kommen_aus_der_konfiguration():
    """Ein IdP, der die Adresse nur über `profile` liefert, braucht den Scope weiterhin."""
    settings = make_settings(oidc_scopes="openid profile email")
    idp = FakeIdp(settings)
    url, _ = await OidcClient(settings, transport=idp.transport).build_authorize_redirect()
    assert idp.erwarte(url)["scope"] == "openid profile email"


async def test_code_tausch_liefert_validierte_claims(oidc, idp):
    state = await _login_starten(oidc, idp)
    claims = await oidc.exchange_code("code-1", state["verifier"], state["nonce"])
    assert claims["sub"] == "idp-sub-1"
    assert oidc.identity_from_claims(claims).email == "mia@example.corp"


async def test_falscher_pkce_verifier_scheitert(oidc, idp):
    state = await _login_starten(oidc, idp)
    with pytest.raises(OidcError):
        await oidc.exchange_code("code-1", "anderer-verifier", state["nonce"])


async def test_token_endpoint_fehler_wird_oidc_error(oidc, idp):
    state = await _login_starten(oidc, idp)
    idp.token_status = 400
    with pytest.raises(OidcError, match="400"):
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])


async def test_token_antwort_ohne_id_token(oidc, idp):
    state = await _login_starten(oidc, idp)
    idp.token_body = {"access_token": "nur-das"}
    with pytest.raises(OidcError, match="id_token"):
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])


@pytest.mark.parametrize(
    "abweichung",
    [
        {"iss": "http://anderer-idp.test/realms/test"},
        {"aud": "fremder-client"},
        {"exp": int(time.time()) - 600},
        {"nonce": "nicht-die-vom-login"},
        {"nonce": None},
        {"sub": None},
    ],
    ids=["issuer", "audience", "abgelaufen", "nonce", "ohne-nonce", "ohne-sub"],
)
async def test_abweichende_claims_werden_abgelehnt(oidc, idp, abweichung):
    idp.nonce = "erwartete-nonce"
    with pytest.raises(OidcError):
        await oidc.validate_id_token(idp.token(**abweichung), "erwartete-nonce")


async def test_code_tausch_prueft_die_nonce_des_logins(oidc, idp):
    """Die nonce aus dem State-Cookie muss bis in die Token-Prüfung reichen."""
    state = await _login_starten(oidc, idp)
    idp.nonce = "nonce-eines-anderen-logins"
    with pytest.raises(OidcError, match="Nonce"):
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])


async def test_fremder_code_scheitert(oidc, idp):
    state = await _login_starten(oidc, idp)
    with pytest.raises(OidcError, match="400: invalid_grant"):
        await oidc.exchange_code("anderer-code", state["verifier"], state["nonce"])


@pytest.mark.parametrize(
    ("antwort", "meldung"),
    [
        (
            lambda: httpx.Response(
                400,
                json={"error": "invalid_grant", "error_description": "User mia@example.corp"},
            ),
            "Token-Endpoint lieferte 400: invalid_grant",
        ),
        (
            lambda: httpx.Response(400, json={"error": "mia@example.corp gesperrt"}),
            "Token-Endpoint lieferte 400: ohne Fehlercode",
        ),
        (
            lambda: httpx.Response(500, text="Konto mia@example.corp nicht gefunden"),
            "Token-Endpoint lieferte 500: ohne Fehlercode",
        ),
    ],
    ids=["beschreibung", "code-ist-freitext", "kein-json"],
)
async def test_fehlertext_des_idp_gelangt_nicht_in_die_meldung(oidc, idp, antwort, meldung):
    """Die Meldung wird geloggt. Ein IdP kann im Fehlertext das Konto nennen — Adressen
    gehören nicht ins Log (ADR-0014). Übrig bleibt nur der kurze OAuth-Fehlercode."""
    state = await _login_starten(oidc, idp)
    idp.antworten["/token"] = antwort
    with pytest.raises(OidcError) as fehler:
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])
    assert str(fehler.value) == meldung


async def test_token_mit_fremdem_schluessel_wird_abgelehnt(oidc, idp):
    """Gleiche kid, aber nicht der veröffentlichte Schlüssel: die Signatur entscheidet."""
    gefaelscht = idp.token(key=SCHLUESSEL_A_GEFAELSCHT)
    with pytest.raises(OidcError):
        await oidc.validate_id_token(gefaelscht, None)


async def test_token_mit_unbekannter_kid_wird_abgelehnt(oidc, idp):
    with pytest.raises(OidcError):
        await oidc.validate_id_token(idp.token(key=SCHLUESSEL_B), None)


async def test_muell_statt_token_wird_abgelehnt(oidc):
    with pytest.raises(OidcError):
        await oidc.validate_id_token("kein-jwt", None)


async def test_unsigniertes_token_wird_abgelehnt(oidc, idp):
    """alg=none — der Klassiker; nur RS256 ist zugelassen. Die Claims sind vollständig und
    gültig: Die Ablehnung darf an nichts anderem liegen als an der fehlenden Signatur."""
    ohne_signatur = idp.roh_token({"alg": "none"}, _claims(idp)).rsplit(".", 1)[0] + "."
    with pytest.raises(OidcError, match="unsupported_algorithm"):
        await oidc.validate_id_token(ohne_signatur, None)


async def test_schluesselrotation_laedt_jwks_einmal_nach(oidc, idp):
    """Regression: Eine unbekannte kid muss genau EIN Nachladen der JWKS auslösen. Früher
    brach die Validierung dort mit einer ungefangenen Ausnahme ab — nach einer
    Key-Rotation im IdP endete jeder Login mit HTTP 500, bis der JWKS-Cache (1 h) ablief."""
    await oidc.validate_id_token(idp.token(), None)  # füllt den JWKS-Cache
    idp.signing_key = SCHLUESSEL_B
    idp.published_keys = [SCHLUESSEL_B]

    claims = await oidc.validate_id_token(idp.token(), None)

    assert claims["sub"] == "idp-sub-1"
    assert len(idp.aufrufe("/certs")) == 2


UNLESBARE_SCHLUESSEL = [
    {"kty": "XYZ", "kid": "fremder-typ"},
    {"kty": "EC", "crv": "P-999", "x": "AA", "y": "AA", "kid": "unbekannte-kurve"},
    {"kty": "RSA", "n": "!!", "e": "AQAB", "kid": "kaputtes-material"},
    {"kty": ["RSA"], "kid": "typ-als-liste"},
    42,
    {},
]


async def test_unlesbare_schluessel_im_jwks_werden_uebersprungen(oidc, idp, caplog):
    """Veröffentlicht der IdP zusätzlich etwas, das wir nicht lesen können (fremder
    Schlüsseltyp, unbekannte Kurve, Datenmüll), darf das die Anmeldung nicht lahmlegen
    (RFC 7517 §5). joserfc meldet diese Einträge mit vier verschiedenen Ausnahmeklassen."""
    gemischt = [*UNLESBARE_SCHLUESSEL, SCHLUESSEL_A.as_dict(private=False)]
    idp.antworten["/certs"] = lambda: httpx.Response(200, json={"keys": gemischt})
    with caplog.at_level("WARNING", logger="app.core.oidc"):
        assert (await oidc.validate_id_token(idp.token(), None))["sub"] == "idp-sub-1"
    # Jeder übersprungene Eintrag steht im Log — sonst sähe ein abgelehnter
    # Signaturschlüssel wie eine Schlüsselrotation aus.
    uebersprungen = [r.getMessage() for r in caplog.records if "übersprungen" in r.getMessage()]
    assert len(uebersprungen) == len(UNLESBARE_SCHLUESSEL)
    assert "kid='unbekannte-kurve'" in uebersprungen[1]


@pytest.mark.parametrize(
    ("header", "payload"),
    [
        (KOPF | {"crit": None}, None),
        (["alg"], None),
        (KOPF, ["kein", "objekt"]),
        (KOPF, "nur text"),
    ],
    ids=["crit-null", "header-liste", "payload-liste", "payload-text"],
)
async def test_gueltig_signierter_unsinn_wird_oidc_error(oidc, idp, header, payload):
    """joserfc reicht bei solchen Tokens TypeError bzw. AttributeError durch (kein
    JoseError) — ungefangen wäre das HTTP 500 statt eines Anmeldefehlers."""
    token = idp.roh_token(header, _claims(idp) if payload is None else payload)
    with pytest.raises(OidcError):
        await oidc.validate_id_token(token, None)


async def test_extrem_tief_geschachtelte_payload_endet_nicht_in_500(oidc, idp):
    """json.loads bricht bei solcher Tiefe mit RecursionError ab (kein JoseError). Ab
    welcher Tiefe, hängt von der Python-Version ab — entscheidend ist: Es kommt nie
    etwas anderes als OidcError heraus."""
    tief = json.dumps(_claims(idp))[:-1] + ', "x": ' + "[" * 30000 + "]" * 30000 + "}"
    with contextlib.suppress(OidcError):
        await oidc.validate_id_token(idp.roh_token(KOPF, tief.encode()), None)


async def test_id_token_ist_kein_text(oidc, idp):
    """Ein kaputter IdP kann unter id_token auch ein Objekt liefern."""
    state = await _login_starten(oidc, idp)
    idp.token_body = {"id_token": {"kein": "text"}}
    with pytest.raises(OidcError):
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])


async def test_unbekannter_header_parameter_wird_ignoriert(oidc, idp):
    """RFC 7515 §4: Was nicht in "crit" steht und unbekannt ist, wird ignoriert."""
    token = idp.roh_token(KOPF | {"foo": "bar"}, _claims(idp))
    assert (await oidc.validate_id_token(token, None))["sub"] == "idp-sub-1"


@pytest.mark.parametrize(
    "header",
    [KOPF | {"crit": ["foo"], "foo": "bar"}, KOPF | {"crit": ["b64"], "b64": True}],
    ids=["crit-unbekannt", "crit-b64"],
)
async def test_kritischer_header_den_wir_nicht_kennen_wird_abgelehnt(oidc, idp, header):
    with pytest.raises(OidcError):
        await oidc.validate_id_token(idp.roh_token(header, _claims(idp)), None)


async def test_nur_rs256_auch_wenn_der_idp_andere_schluessel_veroeffentlicht(oidc, idp):
    """Ein ES256-Token mit passendem, veröffentlichtem EC-Schlüssel bleibt abgelehnt."""
    ec = ECKey.generate_key("P-256", parameters={"kid": "ec-1"})
    idp.published_keys = [SCHLUESSEL_A, ec]
    token = jwt.encode({"alg": "ES256", "kid": "ec-1"}, _claims(idp), ec, algorithms=["ES256"])
    with pytest.raises(OidcError):
        await oidc.validate_id_token(token, None)
    assert (await oidc.validate_id_token(idp.token(), None))["sub"] == "idp-sub-1"


@pytest.mark.parametrize(
    "abweichung",
    [{"iss": ["http://idp.test/realms/test"]}, {"sub": 12345}, {"aud": ["test-client", 5]}],
    ids=["iss-als-liste", "sub-zahl", "aud-mit-zahl"],
)
async def test_claims_mit_falschem_typ_werden_abgelehnt(oidc, idp, abweichung):
    """Erst joserfc >= 1.7.3 prüft die Typen; ältere Versionen nähmen iss als Liste an."""
    with pytest.raises(OidcError):
        await oidc.validate_id_token(idp.token(**abweichung), None)


@pytest.mark.parametrize("claim", ["iss", "aud", "exp"])
async def test_fehlende_pflicht_claims_werden_abgelehnt(oidc, idp, claim):
    """Ohne "essential" prüfte joserfc den Wert nur, wenn der Claim überhaupt da ist."""
    with pytest.raises(OidcError):
        await oidc.validate_id_token(idp.token(**{claim: None}), None)


async def test_aud_als_liste_mit_unserer_client_id_wird_akzeptiert(oidc, idp):
    claims = await oidc.validate_id_token(idp.token(aud=["anderer-client", "test-client"]), None)
    assert claims["aud"] == ["anderer-client", "test-client"]


@pytest.mark.parametrize(("sekunden", "gueltig"), [(-20, True), (-40, False)], ids=["20s", "40s"])
async def test_ablauf_hat_30_sekunden_toleranz(oidc, idp, sekunden, gueltig):
    token = idp.token(exp=int(time.time()) + sekunden)
    if gueltig:
        await oidc.validate_id_token(token, None)
    else:
        with pytest.raises(OidcError):
            await oidc.validate_id_token(token, None)


@pytest.mark.parametrize(
    ("claim", "sekunden", "gueltig"),
    [("nbf", 20, True), ("nbf", 60, False), ("iat", 20, True), ("iat", 60, False)],
    ids=["nbf-20s", "nbf-60s", "iat-20s", "iat-60s"],
)
async def test_tokens_aus_der_zukunft_werden_abgelehnt(oidc, idp, claim, sekunden, gueltig):
    """nbf und iat prüft joserfc von sich aus — mit derselben Toleranz wie den Ablauf."""
    token = idp.token(**{claim: int(time.time()) + sekunden})
    if gueltig:
        await oidc.validate_id_token(token, None)
    else:
        with pytest.raises(OidcError):
            await oidc.validate_id_token(token, None)


async def test_jwks_und_discovery_werden_gecacht(oidc, idp):
    for _ in range(3):
        await oidc.build_authorize_redirect()  # braucht nur die Discovery
        await oidc.validate_id_token(idp.token(), None)
    assert len(idp.aufrufe("/certs")) == 1
    assert len(idp.aufrufe("/openid-configuration")) == 1


async def test_idp_nicht_erreichbar_wird_oidc_error(oidc, idp):
    """Regression: Ein Verbindungsfehler kam als httpx-Ausnahme durch → HTTP 500."""
    idp.down = True
    with pytest.raises(OidcError):
        await oidc.build_authorize_redirect()


async def test_idp_faellt_zwischen_login_und_callback_aus(oidc, idp):
    state = await _login_starten(oidc, idp)
    idp.down = True
    with pytest.raises(OidcError):
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])


WARTUNGSSEITE = "<html><body>Wartung</body></html>"


def _tief_geschachtelt() -> httpx.Response:
    """JSON, an dem json.loads mit RecursionError scheitert (kein ValueError)."""
    inhalt = b'{"keys": ' + b"[" * 100_000 + b"]" * 100_000 + b"}"
    return httpx.Response(200, content=inhalt, headers={"content-type": "application/json"})


@pytest.mark.parametrize(
    "antwort",
    [
        lambda: httpx.Response(503),
        lambda: httpx.Response(503, json={"issuer": "http://idp.test/realms/test"}),
        lambda: httpx.Response(200, text=WARTUNGSSEITE),
        lambda: httpx.Response(200, json=["keine", "metadaten"]),
        _tief_geschachtelt,
    ],
    ids=["503", "503-mit-json", "html-statt-json", "json-liste", "tief-geschachtelt"],
)
async def test_unbrauchbare_discovery_wird_oidc_error(oidc, idp, antwort):
    """Ein IdP hinter einem Proxy antwortet im Störungsfall gern mit einer HTML-Seite
    und Status 200 — das muss als Anmeldefehler enden, nicht als Absturz."""
    idp.antworten["/openid-configuration"] = antwort
    with pytest.raises(OidcError):
        await oidc.build_authorize_redirect()


@pytest.mark.parametrize(
    ("endung", "antwort"),
    [
        ("/certs", lambda: httpx.Response(200, json={"keys": "kaputt"})),
        ("/certs", lambda: httpx.Response(200, json={"keys": [{"kty": "XYZ", "kid": "a"}]})),
        ("/certs", lambda: httpx.Response(200, json={"keys": None})),
        ("/certs", lambda: httpx.Response(200, json={"keys": {"kty": "RSA"}})),
        # Texte sind keine Schlüssel — sie dürfen nicht als symmetrischer Schlüssel durchgehen
        ("/certs", lambda: httpx.Response(200, json={"keys": ["nur", "text"]})),
        ("/certs", _tief_geschachtelt),
        ("/token", lambda: httpx.Response(200, text=WARTUNGSSEITE)),
        ("/token", lambda: httpx.Response(200, json=["kein", "objekt"])),
        ("/token", _tief_geschachtelt),
    ],
    ids=[
        "jwks-kaputt",
        "jwks-fremder-typ",
        "jwks-null",
        "jwks-objekt-statt-liste",
        "jwks-texte",
        "jwks-tief-geschachtelt",
        "token-html",
        "token-json-liste",
        "token-tief-geschachtelt",
    ],
)
async def test_unbrauchbare_antwort_beim_code_tausch_wird_oidc_error(oidc, idp, endung, antwort):
    state = await _login_starten(oidc, idp)
    idp.antworten[endung] = antwort
    with pytest.raises(OidcError):
        await oidc.exchange_code("code-1", state["verifier"], state["nonce"])


@pytest.mark.parametrize(
    "issuer",
    [
        "http://boese.test/realms/test",
        # knapp daneben: Nur der abschließende Schrägstrich darf abweichen
        "http://idp.test/realms/test2",
        "http://idp.test/realms/test/x",
        "http://idp.test/realms/tes",
        "http://idp.test/realms/test//",
        None,
        ["http://idp.test/realms/test"],
    ],
    ids=["fremd", "laenger", "unterpfad", "kuerzer", "doppelslash", "fehlt", "liste"],
)
async def test_discovery_mit_fremdem_issuer_wird_abgelehnt(oidc, idp, issuer):
    idp.metadata_extra = {"issuer": issuer}
    with pytest.raises(OidcError, match="Issuer-Mismatch"):
        await oidc.build_authorize_redirect()


async def test_issuer_meldung_ist_gekuerzt(oidc, idp):
    """Der Wert kommt vom IdP und landet im Log — unbegrenzt soll er dort nicht stehen."""
    idp.metadata_extra = {"issuer": "http://boese.test/" + "x" * 5000}
    with pytest.raises(OidcError) as fehler:
        await oidc.build_authorize_redirect()
    assert len(str(fehler.value)) < 400


ENDPUNKT_UND_AUFRUF = [
    ("authorization_endpoint", lambda oidc, idp: oidc.build_authorize_redirect()),
    ("token_endpoint", lambda oidc, idp: oidc.exchange_code("code-1", "verifier", "nonce")),
    ("jwks_uri", lambda oidc, idp: oidc.validate_id_token(idp.token(), None)),
]


@pytest.mark.parametrize(("endpunkt", "aufruf"), ENDPUNKT_UND_AUFRUF)
async def test_discovery_ohne_endpunkt_wird_oidc_error(oidc, idp, endpunkt, aufruf):
    idp.metadata_extra = {endpunkt: None}
    with pytest.raises(OidcError, match=endpunkt):
        await aufruf(oidc, idp)


@pytest.mark.parametrize(("endpunkt", "aufruf"), ENDPUNKT_UND_AUFRUF[1:])
async def test_discovery_mit_kaputter_url_wird_oidc_error(oidc, idp, endpunkt, aufruf):
    """httpx meldet eine unlesbare URL mit InvalidURL — das ist kein HTTPError."""
    idp.metadata_extra = {endpunkt: "http://idp.test:kein-port/pfad"}
    with pytest.raises(OidcError):
        await aufruf(oidc, idp)


async def test_issuer_des_idp_mit_schraegstrich_am_ende(oidc, idp):
    """Bei manchen IdPs gehört der abschließende "/" zum Issuer (Entra v1, Auth0). Die
    Konfiguration darf ihn haben oder nicht — der iss-Claim muss aber exakt so lauten,
    wie der IdP sich in der Discovery nennt."""
    idp.metadata_extra = {"issuer": idp.issuer + "/"}
    claims = await oidc.validate_id_token(idp.token(iss=idp.issuer + "/"), None)
    assert claims["iss"] == idp.issuer + "/"
    with pytest.raises(OidcError):
        await oidc.validate_id_token(idp.token(iss=idp.issuer), None)


async def test_konfigurierter_issuer_mit_schraegstrich_am_ende():
    settings = make_settings(oidc_issuer_url="http://idp.test/realms/test/")
    idp = FakeIdp(settings)  # nennt sich selbst ohne den Schrägstrich
    oidc = OidcClient(settings, transport=idp.transport)
    assert (await oidc.validate_id_token(idp.token(), None))["iss"] == "http://idp.test/realms/test"


async def test_end_session_url(oidc, idp, settings):
    url = await oidc.build_end_session_url(post_logout_redirect_uri="http://testserver/")
    assert url.startswith(idp.issuer + "/logout?")
    assert f"client_id={settings.oidc_client_id}" in url
    assert "post_logout_redirect_uri=http%3A%2F%2Ftestserver%2F" in url


async def test_end_session_url_fehlt_wenn_idp_keinen_endpunkt_hat(oidc, idp):
    idp.metadata_extra = {"end_session_endpoint": None}
    assert await oidc.build_end_session_url() is None


async def test_split_horizon_backend_intern_browser_oeffentlich():
    """Backend-Aufrufe (Discovery, JWKS, Token) gehen an den internen Host, die
    Authorize-URL für den Browser bleibt auf dem öffentlichen (Plan 5.5)."""
    settings = make_settings(
        oidc_issuer_url="http://localhost:8081/realms/dev",
        oidc_internal_base_url="http://keycloak:8081",
    )
    idp = FakeIdp(settings, host="http://keycloak:8081")
    oidc = OidcClient(settings, transport=idp.transport)

    url, state = await oidc.build_authorize_redirect()
    idp.erwarte(url)
    await oidc.exchange_code("code-1", state["verifier"], state["nonce"])

    assert url.startswith("http://localhost:8081/realms/dev/auth?")
    assert {r.url.host for r in idp.requests} == {"keycloak"}
    assert len(idp.aufrufe("/token")) == 1
