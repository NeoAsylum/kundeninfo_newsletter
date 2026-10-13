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


async def get_session(request: Request) -> AsyncGenerator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


def get_identity(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Identity:
    identity = read_session(settings, request.cookies.get(SESSION_COOKIE))
    if identity is None:
        raise ApiError(401, "UNAUTHENTICATED", "Nicht angemeldet")
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


def is_admin(user: User) -> bool:
    """Die Datenbank ist die EINZIGE Quelle für Adminrechte (ADR-0022).

    Rollen aus dem IdP werden dafür nicht mehr gelesen — Auftraggeber-Entscheidung: Die
    Vergabe gehört ins Portal, nicht in einen IAM-Antrag. Folge für den Betrieb: Eine
    Deaktivierung im Verzeichnisdienst entzieht das Adminrecht NICHT mehr von selbst;
    dafür ist die Empfänger- bzw. Rollen-Maske zuständig (RUNBOOK 3b/6b).
    """
    return user.is_admin


async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    """Prüft bei JEDER Anfrage gegen die Datenbank, nicht gegen das Cookie: ein in der
    Oberfläche entzogenes Recht wirkt damit sofort statt erst nach Cookie-Ablauf.

    Hängt an get_current_user, damit ein deaktivierter Admin 401 SESSION_STALE bekommt
    (Offboarding) und nicht 403 — die Reihenfolge ist als Test festgehalten.
    """
    if not is_admin(user):
        raise ApiError(403, "NOT_ADMIN", "Keine Berechtigung für diese Funktion")
    return user


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdentityDep = Annotated[Identity, Depends(get_identity)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]
