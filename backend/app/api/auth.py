"""BFF-OIDC-Flow (Plan 5.3, ADR-003): Login/Callback/Logout, Session als HttpOnly-Cookie."""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.deps import SessionDep, SettingsDep
from app.core.oidc import OidcError
from app.core.security import (
    SESSION_COOKIE,
    STATE_COOKIE,
    STATE_MAX_AGE,
    decode_payload,
    encode_payload,
    session_cookie_value,
)
from app.domain.users import jit_upsert

log = logging.getLogger(__name__)
router = APIRouter()


def _safe_next(next_url: str | None) -> str:
    """Nur relative Pfade — verhindert Open-Redirect."""
    if next_url and next_url.startswith("/") and not next_url.startswith("//"):
        return next_url
    return "/abos.html"


@router.get("/auth/login")
async def login(
    request: Request,
    settings: SettingsDep,
    next: str | None = None,
    prompt: str | None = None,
) -> RedirectResponse:
    oidc = request.app.state.oidc
    url, state_payload = await oidc.build_authorize_redirect(prompt=prompt)
    state_payload["next"] = _safe_next(next)
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        STATE_COOKIE,
        encode_payload(settings.session_secret, state_payload, STATE_MAX_AGE),
        max_age=STATE_MAX_AGE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/auth",
    )
    return response


@router.get("/auth/callback")
async def callback(
    request: Request,
    settings: SettingsDep,
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        return JSONResponse(
            {"detail": f"IdP meldet Fehler: {error}", "code": "OIDC_IDP_ERROR"}, status_code=502
        )
    state_data = decode_payload(settings.session_secret, request.cookies.get(STATE_COOKIE, ""))
    if not code or not state or state_data is None or state_data.get("state") != state:
        return JSONResponse(
            {
                "detail": "Ungültiger oder abgelaufener Login-Vorgang — bitte erneut anmelden.",
                "code": "OIDC_STATE_MISMATCH",
            },
            status_code=400,
        )

    oidc = request.app.state.oidc
    try:
        claims = await oidc.exchange_code(code, state_data["verifier"], state_data["nonce"])
        identity = oidc.identity_from_claims(claims)
    except OidcError as exc:
        log.warning("OIDC-Callback fehlgeschlagen: %s", exc)
        return JSONResponse(
            {"detail": "Anmeldung fehlgeschlagen (IdP-Kommunikation).", "code": "OIDC_ERROR"},
            status_code=502,
        )

    await jit_upsert(session, identity)
    await session.commit()

    response = RedirectResponse(_safe_next(state_data.get("next")), status_code=302)
    response.set_cookie(
        SESSION_COOKIE,
        session_cookie_value(settings, identity),
        max_age=settings.session_max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(STATE_COOKIE, path="/auth")
    return response


@router.get("/auth/logout")
async def logout(request: Request, settings: SettingsDep) -> RedirectResponse:
    oidc = request.app.state.oidc
    target_url = settings.public_base_url + "/"
    try:
        logout_url = await oidc.build_end_session_url(post_logout_redirect_uri=target_url)
    except Exception:
        logout_url = None

    response = RedirectResponse(logout_url or target_url, status_code=302)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
