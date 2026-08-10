from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError
from app.core.config import Settings
from app.core.security import SESSION_COOKIE, Identity, read_session
from app.db.models import User


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    async with request.app.state.sessionmaker() as session:
        yield session


def get_identity(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Identity:
    identity = read_session(settings, request.cookies.get(SESSION_COOKIE))
    if identity is None:
        raise ApiError(401, "UNAUTHENTICATED", "Nicht angemeldet")
    return identity


def require_admin(identity: Annotated[Identity, Depends(get_identity)]) -> Identity:
    if not identity.is_admin:
        raise ApiError(403, "NOT_ADMIN", "Keine Berechtigung für diese Funktion")
    return identity


async def get_current_user(
    identity: Annotated[Identity, Depends(get_identity)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """DB-User zur Session; fehlt er (z. B. DB neu aufgesetzt), ist die Session stale."""
    user = (
        await session.execute(select(User).where(User.oidc_sub == identity.sub))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise ApiError(401, "SESSION_STALE", "Bitte neu anmelden")
    return user


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdentityDep = Annotated[Identity, Depends(get_identity)]
AdminDep = Annotated[Identity, Depends(require_admin)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]
