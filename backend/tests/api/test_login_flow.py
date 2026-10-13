"""Login-Roundtrip über die echten Routen: /auth/login → IdP-Attrappe → /auth/callback.

Der IdP ist eine Attrappe ohne Netz (tests/fake_idp.py); Cookies, State-Prüfung,
JIT-Anlage und Session laufen über den echten Code.
"""

import httpx
import pytest
from sqlalchemy import select

from app.core.oidc import OidcClient
from app.core.security import decode_payload
from app.db.models import User
from app.domain import users as users_domain
from tests.conftest import make_settings
from tests.fake_idp import FakeIdp


@pytest.fixture
def idp(app, api_settings) -> FakeIdp:
    fake = FakeIdp(api_settings)
    app.state.oidc = OidcClient(api_settings, transport=fake.transport)
    return fake


async def _login(client, idp, **params) -> httpx.Response:
    """Startet den Login und gibt der Attrappe, was der Browser dem IdP zeigen würde."""
    response = await client.get("/auth/login", params=params)
    assert response.status_code == 302
    idp.erwarte(response.headers["location"])
    return response


async def _callback(client, login_response, code: str = "code-1") -> httpx.Response:
    state = httpx.URL(login_response.headers["location"]).params["state"]
    return await client.get("/auth/callback", params={"code": code, "state": state})


def _session_cookie(response: httpx.Response) -> str:
    return next(c for c in response.headers.get_list("set-cookie") if c.startswith("session="))


def _attribute(set_cookie: str) -> set[str]:
    """Attribute eines Set-Cookie-Headers, kleingeschrieben und ohne das Name=Wert-Paar."""
    return {teil.strip().lower() for teil in set_cookie.split(";")[1:]}


async def _users(app) -> list[User]:
    async with app.state.sessionmaker() as session:
        return list((await session.execute(select(User))).scalars())


async def test_login_roundtrip_legt_user_an_und_setzt_session(client, app, idp):
    login = await _login(client, idp, next="/versand.html")
    assert login.headers["location"].startswith(idp.issuer + "/auth?")
    state_cookie = login.headers["set-cookie"]
    assert state_cookie.startswith("oidc_state=")
    assert {"httponly", "path=/auth", "samesite=lax"} <= _attribute(state_cookie)
    # Über http (DEV) darf das Cookie nicht Secure sein — der Browser verwürfe es
    assert "secure" not in _attribute(state_cookie)

    callback = await _callback(client, login)

    assert callback.status_code == 302
    assert callback.headers["location"] == "/versand.html"
    assert {"httponly", "path=/", "samesite=lax"} <= _attribute(_session_cookie(callback))

    # Das Cookie aus dem Callback trägt die Session: /me antwortet ohne weiteres Zutun
    me = await client.get("/api/v1/me")
    assert me.status_code == 200
    assert me.json() == {"email": "mia@example.corp", "roles": ["employee"]}

    users = await _users(app)
    assert [(u.oidc_sub, u.email, u.is_active, u.is_admin) for u in users] == [
        ("idp-sub-1", "mia@example.corp", True, False)
    ]


async def test_paralleler_erst_login_endet_nicht_in_500(client, app, idp, monkeypatch):
    """Zwei Tabs beim allerersten Login: Beide Callbacks finden noch keine Zeile, der
    zweite INSERT verliert am Unique-Key. Nachgestellt über den Schritt, der im echten
    Ablauf zwischen SELECT und INSERT liegt — dort legt „der andere Tab“ die Zeile an."""
    echte_kollisionspruefung = users_domain._archive_email_conflict
    ueberholt = False

    async def pruefung_und_der_andere_tab_ist_schneller(session, email, sub):
        nonlocal ueberholt
        await echte_kollisionspruefung(session, email, sub)
        if not ueberholt:
            ueberholt = True
            async with app.state.sessionmaker() as anderer_tab:
                anderer_tab.add(User(oidc_sub=sub, email=email))
                await anderer_tab.commit()

    monkeypatch.setattr(
        users_domain, "_archive_email_conflict", pruefung_und_der_andere_tab_ist_schneller
    )

    callback = await _callback(client, await _login(client, idp))

    assert ueberholt
    assert callback.status_code == 302
    assert (await client.get("/api/v1/me")).status_code == 200
    users = await _users(app)
    assert [(u.oidc_sub, u.email, u.is_active) for u in users] == [
        ("idp-sub-1", "mia@example.corp", True)
    ]
    assert users[0].last_login_at is not None


async def test_state_cookie_ist_nach_dem_callback_verbraucht(client, idp):
    """Ein mitgeschnittener Callback-Link darf sich nicht wiederholen lassen."""
    login = await _login(client, idp)
    assert (await _callback(client, login)).status_code == 302

    wiederholt = await _callback(client, login)

    assert wiederholt.status_code == 400
    assert wiederholt.json()["code"] == "OIDC_STATE_MISMATCH"


async def test_callback_mit_fremdem_state_400(client, app, idp):
    await _login(client, idp)
    response = await client.get("/auth/callback", params={"code": "c", "state": "geraten"})
    assert response.status_code == 400
    assert response.json()["code"] == "OIDC_STATE_MISMATCH"
    assert await _users(app) == []


async def test_callback_ohne_login_cookie_400(client, idp):
    """Login-CSRF: Ein Angreifer kann seinen eigenen Code nicht in eine fremde
    Browser-Sitzung schieben — ohne das State-Cookie dieses Browsers gibt es keine Session."""
    login = await _login(client, idp)
    client.cookies.clear()
    response = await _callback(client, login)
    assert response.status_code == 400


@pytest.mark.parametrize(
    "boese",
    ["//evil.example", "https://evil.example/", "/\\evil.example", "/\t/evil.example"],
    ids=["doppelslash", "absolut", "backslash", "tab"],
)
async def test_next_fuehrt_nie_auf_eine_fremde_seite(client, idp, boese):
    """Browser lesen `/\\host` wie `//host` und streichen Tabs aus URLs — solche Ziele
    werden schon in der Prüfung verworfen, nicht erst durch die Kodierung im Redirect."""
    login = await _login(client, idp, next=boese)
    callback = await _callback(client, login)
    assert callback.status_code == 302
    assert callback.headers["location"] == "/abos.html"


async def test_ohne_next_geht_es_zur_abo_maske(client, idp):
    callback = await _callback(client, await _login(client, idp))
    assert callback.headers["location"] == "/abos.html"


async def test_token_fehler_im_callback_502_ohne_session(client, app, idp):
    login = await _login(client, idp)
    idp.token_status = 400

    response = await _callback(client, login)

    assert response.status_code == 502
    assert response.json()["code"] == "OIDC_ERROR"
    assert not [c for c in response.headers.get_list("set-cookie") if c.startswith("session=")]
    assert await _users(app) == []


async def test_idp_ausfall_im_callback_502_statt_500(client, idp):
    login = await _login(client, idp)
    idp.down = True
    response = await _callback(client, login)
    assert response.status_code == 502
    assert response.json()["code"] == "OIDC_ERROR"


async def test_idp_ausfall_beim_login_502_statt_500(client, idp):
    """Regression: Der Verbindungsfehler lief unbehandelt durch → HTTP 500 mit Traceback."""
    idp.down = True
    response = await client.get("/auth/login")
    assert response.status_code == 502
    assert response.json()["code"] == "OIDC_ERROR"
    assert "set-cookie" not in response.headers


async def test_token_ohne_email_claim_502(client, app, idp):
    idp.claims = {"sub": "idp-sub-1"}
    response = await _callback(client, await _login(client, idp))
    assert response.status_code == 502
    assert await _users(app) == []


async def test_prompt_wird_an_den_idp_durchgereicht(client, idp):
    login = await _login(client, idp, prompt="login")
    assert httpx.URL(login.headers["location"]).params["prompt"] == "login"


async def test_logout_nennt_die_end_session_url_des_idp(client, idp):
    response = await client.post("/auth/logout", headers={"X-Requested-With": "fetch"})
    assert response.status_code == 200
    logout_url = response.json()["logout_url"]
    assert logout_url.startswith(idp.issuer + "/logout?")
    assert "post_logout_redirect_uri=http%3A%2F%2Ftestserver%2F" in logout_url


async def test_logout_beendet_die_session(client, idp):
    await _callback(client, await _login(client, idp))
    assert (await client.get("/api/v1/me")).status_code == 200

    await client.post("/auth/logout", headers={"X-Requested-With": "fetch"})

    assert (await client.get("/api/v1/me")).status_code == 401


async def test_cookies_sind_secure_hinter_https(make_app):
    settings = make_settings(public_base_url="https://portal.example")
    app_https = make_app(public_base_url="https://portal.example")
    idp = FakeIdp(settings)
    app_https.state.oidc = OidcClient(settings, transport=idp.transport)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_https), base_url="https://portal.example"
    ) as https_client:
        login = await _login(https_client, idp)
        callback = await _callback(https_client, login)
    assert "secure" in _attribute(login.headers["set-cookie"])
    assert "secure" in _attribute(_session_cookie(callback))
    assert (
        "redirect_uri=https%3A%2F%2Fportal.example%2Fauth%2Fcallback" in login.headers["location"]
    )


async def test_fremde_nonce_im_token_502(client, app, idp):
    """Die nonce aus dem State-Cookie bindet das Token an genau diesen Login."""
    login = await _login(client, idp)
    idp.nonce = "nonce-eines-anderen-logins"
    response = await _callback(client, login)
    assert response.status_code == 502
    assert await _users(app) == []


async def test_fehlertext_des_idp_steht_nicht_im_log(client, idp, caplog):
    """ADR-0014: keine Adressen im Log — auch nicht über den Fehlertext des IdP."""
    login = await _login(client, idp)
    idp.antworten["/token"] = lambda: httpx.Response(
        400,
        json={"error": "invalid_grant", "error_description": "User mia@example.corp disabled"},
    )
    with caplog.at_level("WARNING"):
        response = await _callback(client, login)
    assert response.status_code == 502
    assert "invalid_grant" in caplog.text
    assert "mia@example.corp" not in caplog.text


async def test_namen_aus_dem_token_werden_nicht_gespeichert(client, app, idp, api_settings):
    """ADR-0025/0028: Schickt ein IdP Namens-Claims mit (etwa weil er die Adresse nur über
    den Scope `profile` liefert), landen sie weder in der Datenbank noch im Cookie."""
    idp.claims |= {"name": "Mia Muster", "given_name": "Mia", "family_name": "Muster"}
    callback = await _callback(client, await _login(client, idp))
    assert callback.status_code == 302
    assert [u.display_name for u in await _users(app)] == [None]
    session = decode_payload(api_settings.session_secret, client.cookies["session"].strip('"'))
    assert set(session) == {"sub", "email", "roles", "exp"}


async def test_bootstrap_adresse_wird_ueber_den_callback_admin(make_app):
    """Die Liste muss bis in den Callback reichen — die Regeln selbst prüft
    test_admin_roles.py an der Domänenfunktion."""
    settings = make_settings(admin_bootstrap_emails="mia@example.corp")
    app = make_app(admin_bootstrap_emails="mia@example.corp")
    idp = FakeIdp(settings)
    app.state.oidc = OidcClient(settings, transport=idp.transport)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        callback = await _callback(client, await _login(client, idp))
    assert callback.status_code == 302
    assert [(u.email, u.is_admin) for u in await _users(app)] == [("mia@example.corp", True)]
