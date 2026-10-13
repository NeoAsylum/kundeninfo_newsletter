"""BFF-OIDC-Flow (Plan 5.3, ADR-003): Login/Callback/Logout, Session als HttpOnly-Cookie."""

import logging

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.exc import IntegrityError

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
    """Nur relative Pfade — verhindert Open-Redirect.

    Auch Backslash und Steuerzeichen fallen durch: Browser lesen `/\\host` wie `//host`
    und streichen Tab/Zeilenumbruch aus URLs. RedirectResponse kodiert diese Zeichen
    zwar ohnehin — darauf soll sich die Prüfung aber nicht verlassen müssen.
    """
    if (
        next_url
        and next_url.startswith("/")
        and not next_url.startswith("//")
        and "\\" not in next_url
        and not any(ord(zeichen) < 0x20 or ord(zeichen) == 0x7F for zeichen in next_url)
    ):
        return next_url
    return "/abos.html"


@router.get("/auth/login")
async def login(
    request: Request,
    settings: SettingsDep,
    next: str | None = None,
    prompt: str | None = None,
) -> Response:
    oidc = request.app.state.oidc
    try:
        url, state_payload = await oidc.build_authorize_redirect(prompt=prompt)
    except OidcError as exc:
        log.warning("OIDC-Login nicht möglich: %s", exc)
        return JSONResponse(
            {
                "detail": "Anmeldung derzeit nicht möglich (IdP-Kommunikation).",
                "code": "OIDC_ERROR",
            },
            status_code=502,
        )
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

    try:
        await jit_upsert(session, identity, settings)
        await session.commit()
    except IntegrityError:
        # Zwei gleichzeitige ERST-Logins derselben Person (z. B. zwei Tabs): Beide sehen
        # noch keine Zeile, der zweite INSERT verliert am Unique-Key. Die Zeile existiert
        # jetzt — der zweite Anlauf nimmt den Update-Pfad.
        await session.rollback()
        log.info("JIT-Anlage kollidierte mit parallelem Login — wird wiederholt")
        await jit_upsert(session, identity, settings)
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


@router.post("/auth/logout")
async def logout(request: Request, settings: SettingsDep) -> JSONResponse:
    """POST statt GET: verhindert Drive-by-Logout per Link.

    /auth/* liegt außerhalb der /api-CSRF-Middleware → Header-Pflicht hier explizit.
    Das Frontend ruft per fetch auf und navigiert selbst zur logout_url (IdP-End-Session).
    """
    if request.headers.get("x-requested-with") != "fetch":
        return JSONResponse(
            {"detail": "CSRF-Schutz: Header X-Requested-With fehlt", "code": "CSRF"},
            status_code=403,
        )
    oidc = request.app.state.oidc
    target_url = settings.public_base_url + "/"
    try:
        logout_url = await oidc.build_end_session_url(post_logout_redirect_uri=target_url)
    except Exception:
        logout_url = None

    response = JSONResponse({"logout_url": logout_url or target_url})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
