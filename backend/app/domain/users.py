"""JIT-Provisioning (ADR-010): User entsteht/aktualisiert sich beim Login.

Harter Identitätsanker ist oidc_sub — E-Mail-Adressen ändern sich im Konzern.
Die E-Mail-Kollisionsbehandlung ist verbindlich spezifiziert (Plan 4.3): Eine
recycelte Adresse an einer Alt-Zeile mit anderem sub darf den Login NICHT mit
einem Constraint-Fehler abbrechen — die Alt-Zeile wird deaktiviert und ihre
Adresse archiviert.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.security import Identity
from app.db.models import User

log = logging.getLogger(__name__)


def archived_email(user_id: int) -> str:
    return f"user-{user_id}@invalid.archiviert"


async def _archive_email_conflict(session: AsyncSession, email: str, sub: str) -> None:
    conflict = (
        await session.execute(select(User).where(User.email == email, User.oidc_sub != sub))
    ).scalar_one_or_none()
    if conflict is None:
        return
    conflict.is_active = False
    conflict.email = archived_email(conflict.id)
    await session.flush()
    log.info("E-Mail-Kollision aufgelöst: Alt-User %s deaktiviert und archiviert", conflict.id)


async def jit_upsert(session: AsyncSession, identity: Identity) -> User:
    user = (
        await session.execute(select(User).where(User.oidc_sub == identity.sub))
    ).scalar_one_or_none()

    if user is None:
        await _archive_email_conflict(session, identity.email, identity.sub)
        user = User(
            oidc_sub=identity.sub,
            email=identity.email,
            display_name=identity.display_name,
            is_active=True,
            last_login_at=utcnow(),
        )
        session.add(user)
    else:
        if user.email != identity.email:
            await _archive_email_conflict(session, identity.email, identity.sub)
        user.email = identity.email
        user.display_name = identity.display_name
        # Login beweist ein aktives IdP-Konto → Reaktivierung nach Offboarding-Irrtum
        user.is_active = True
        user.last_login_at = utcnow()

    await session.flush()
    return user
