"""JIT-Provisioning (ADR-010): User entsteht/aktualisiert sich beim Login.

Harter Identitätsanker ist oidc_sub — E-Mail-Adressen ändern sich im Konzern.
Die E-Mail-Kollisionsbehandlung ist verbindlich spezifiziert (Plan 4.3): Eine
recycelte Adresse an einer Alt-Zeile mit anderem sub darf den Login NICHT mit
einem Constraint-Fehler abbrechen — die Alt-Zeile wird deaktiviert und ihre
Adresse archiviert.
"""

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.config import Settings
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


async def _bootstrap_admin_if_orphaned(
    session: AsyncSession, settings: Settings, user: User
) -> None:
    """Setzt das Adminrecht für eine konfigurierte Adresse — aber nur, solange KEIN
    aktiver Admin existiert (ADR-0022).

    Der Grund für diese Bedingung: Seit die Adminrechte allein in der Datenbank stehen,
    gibt es auf einer frischen Instanz niemanden, der sie vergeben könnte. Eine reine
    Liste „diese Adressen sind Admin" wäre aber eine dauerhafte Hintertür — bei offener
    Selbstregistrierung könnte sich jemand mit einer gelisteten Adresse anmelden. Durch
    die Bedingung ist die Liste im Normalbetrieb wirkungslos und wird erst wieder aktiv,
    wenn tatsächlich niemand mehr administrieren kann. Das ist genau der Notfall, für
    den sie gedacht ist (RUNBOOK 6b).
    """
    if user.is_admin or user.email not in settings.admin_bootstrap_set:
        return
    aktive_admins = (
        await session.execute(
            select(func.count())
            .select_from(User)
            .where(User.is_admin.is_(True), User.is_active.is_(True))
        )
    ).scalar_one()
    if aktive_admins:
        return
    user.is_admin = True
    await session.flush()
    log.warning(
        "Adminrecht per ADMIN_BOOTSTRAP_EMAILS vergeben (User %s) — es gab keinen aktiven "
        "Admin. Die Liste bleibt wirkungslos, solange nun einer existiert.",
        user.id,
    )


async def jit_upsert(
    session: AsyncSession, identity: Identity, settings: Settings | None = None
) -> User:
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
    if settings is not None:
        await _bootstrap_admin_if_orphaned(session, settings, user)
    return user
