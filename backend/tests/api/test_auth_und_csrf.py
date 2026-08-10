async def test_me_ohne_session_401(client):
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHENTICATED"


async def test_me_mit_session(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    response = await client.get("/api/v1/me", headers=auth_headers("s1", "mia@example.corp"))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "mia@example.corp"
    assert body["roles"] == ["employee"]


async def test_kaputtes_cookie_401(client):
    response = await client.get("/api/v1/me", headers={"Cookie": "session=unsinn"})
    assert response.status_code == 401


async def test_csrf_header_pflicht_bei_mutation(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers("s1", "mia@example.corp")
    del headers["X-Requested-With"]
    response = await client.put("/api/v1/me/subscriptions/kap", headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "CSRF"


async def test_get_braucht_keinen_csrf_header(client, auth_headers, make_user):
    await make_user(sub="s1", email="mia@example.corp")
    headers = auth_headers("s1", "mia@example.corp")
    del headers["X-Requested-With"]
    response = await client.get("/api/v1/topics", headers=headers)
    assert response.status_code == 200


async def test_session_ohne_db_user_ist_stale(client, auth_headers):
    response = await client.get("/api/v1/topics", headers=auth_headers("geist", "g@x.y"))
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_STALE"


async def test_healthz_offen(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert "version" in response.json()


async def test_auth_logout(client):
    response = await client.get("/auth/logout", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].endswith("/")


async def test_auth_callback_idp_error(client):
    response = await client.get("/auth/callback?error=invalid_scope")
    assert response.status_code == 502
    assert response.json()["code"] == "OIDC_IDP_ERROR"


async def test_auth_callback_state_mismatch(client):
    response = await client.get("/auth/callback?code=123&state=xyz")
    assert response.status_code == 400
    assert response.json()["code"] == "OIDC_STATE_MISMATCH"
