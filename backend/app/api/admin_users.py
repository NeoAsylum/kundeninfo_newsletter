"""Empfänger-Verwaltung (Rolle admin): browsen, deaktivieren/aktivieren, Abos pflegen.

Bewusste Grenzen:
- E-Mail und Anzeigename sind read-only — sie kommen per JIT aus dem IdP (ADR-0010);
  Editieren würde beim nächsten Login überschrieben.
- Keine Verhaltensdaten (last_login_at) im Response — Betriebsrats-Vorsorge (B5).
- Admin-Aktionen werden IMMER auditiert (ADR-0017) — der AUDIT_SUBSCRIPTIONS-Schalter
  betrifft nur die Selbstbedienung der Mitarbeiter, nicht Fremdänderungen durch Admins.
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUserDep, SessionDep, get_current_user, require_admin
from app.api.errors import ApiError
from app.api.schemas import AdminUserListOut, AdminUserOut, AdminUserPatch
from app.db.models import AuditLog, Subscription, User
from app.domain.topics import get_topic, guard_mandatory

router = APIRouter(dependencies=[Depends(require_admin), Depends(get_current_user)])


async def _get_user(session: AsyncSession, user_id: int) -> User:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise ApiError(404, "USER_NOT_FOUND", f"Empfänger {user_id} existiert nicht")
    return user


async def _subscriptions_by_user(
    session: AsyncSession, user_ids: list[int]
) -> dict[int, list[str]]:
    result: dict[int, list[str]] = defaultdict(list)
    if not user_ids:
        return result
    rows = await session.execute(
        select(Subscription.user_id, Subscription.topic_id)
        .where(Subscription.user_id.in_(user_ids))
        .order_by(Subscription.topic_id)
    )
    for user_id, topic_id in rows.all():
        result[user_id].append(topic_id)
    return result


def _to_out(user: User, topic_ids: list[str]) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
        subscribed_topic_ids=topic_ids,
    )


@router.get("/users", response_model=AdminUserListOut)
async def list_users(
    session: SessionDep,
    query: str = Query(default="", max_length=200),
    is_active: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AdminUserListOut:
    """Browsen mit E-Mail-Filter und Paging; is_active=true liefert nur aktive
    Empfänger (die verteiler-zentrierte Maske zeigt ausschließlich diese)."""
    conditions = []
    if query.strip():
        # E-Mail-only-Suche (die Maske zeigt keine Namen — Treffer auf unsichtbare
        # Felder wären irreführend). LIKE-Wildcards escapen: '_'/'%' sind in
        # E-Mail-Konventionen üblich und sollen wörtlich matchen
        escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(User.email.ilike(f"%{escaped}%", escape="\\"))
    if is_active is not None:
        conditions.append(User.is_active.is_(is_active))

    total = (
        await session.execute(select(func.count()).select_from(User).where(*conditions))
    ).scalar_one()
    users = list(
        (
            await session.execute(
                select(User).where(*conditions).order_by(User.email).limit(limit).offset(offset)
            )
        ).scalars()
    )
    subscriptions = await _subscriptions_by_user(session, [u.id for u in users])
    return AdminUserListOut(
        items=[_to_out(u, subscriptions[u.id]) for u in users],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def set_user_active(
    user_id: int, patch: AdminUserPatch, session: SessionDep, actor: CurrentUserDep
) -> AdminUserOut:
    """Deaktivieren wirkt auf alle KÜNFTIGEN Empfängerauflösungen (auch Pflicht-Topics).

    Bereits angelegte Versände behalten ihren Empfänger-Snapshot und werden noch
    zugestellt (Outbox-Semantik, Plan 4.3 — der Snapshot ist bewusst eingefroren).
    Hinweis-Semantik (ADR-0010): Meldet sich die Person erneut per SSO an, wird sie
    automatisch reaktiviert — Deaktivierung ist für Offboarding gedacht, nicht als
    dauerhafter Versandausschluss gegen den Willen eines aktiven Mitarbeiters.
    """
    user = await _get_user(session, user_id)
    if user.id == actor.id and not patch.is_active:
        raise ApiError(409, "CANNOT_DEACTIVATE_SELF", "Du kannst dich nicht selbst deaktivieren")
    if user.is_active != patch.is_active:
        user.is_active = patch.is_active
        session.add(
            AuditLog(
                actor_email=actor.email,
                action="user_activated" if patch.is_active else "user_deactivated",
                detail={"user_id": user.id},
            )
        )
        await session.commit()
    topic_ids = (await _subscriptions_by_user(session, [user.id]))[user.id]
    return _to_out(user, topic_ids)


@router.put("/users/{user_id}/subscriptions/{topic_id}", status_code=204)
async def admin_subscribe(
    user_id: int, topic_id: str, session: SessionDep, actor: CurrentUserDep
) -> None:
    user = await _get_user(session, user_id)
    topic = await get_topic(session, topic_id)
    guard_mandatory(topic)
    # Audit nur bei echter Änderung — Entscheidung per Vorab-SELECT statt rowcount:
    # ON DUPLICATE liefert unter dem FOUND_ROWS-Flag des Dialekts auch bei No-Ops 1.
    # Das Schreiben selbst bleibt idempotent (kein Race auf den Unique-Key).
    already_subscribed = (
        await session.execute(
            select(Subscription).where(
                Subscription.user_id == user.id, Subscription.topic_id == topic.id
            )
        )
    ).scalar_one_or_none() is not None
    stmt = (
        mysql_insert(Subscription)
        .values(user_id=user.id, topic_id=topic.id)
        .on_duplicate_key_update(user_id=Subscription.user_id)  # idempotent
    )
    await session.execute(stmt)
    if not already_subscribed:
        session.add(
            AuditLog(
                actor_email=actor.email,
                action="admin_subscribe",
                detail={"user_id": user.id, "topic_id": topic.id},
            )
        )
    await session.commit()


@router.delete("/users/{user_id}/subscriptions/{topic_id}", status_code=204)
async def admin_unsubscribe(
    user_id: int, topic_id: str, session: SessionDep, actor: CurrentUserDep
) -> None:
    user = await _get_user(session, user_id)
    # only_active=False: Abos auf inzwischen deaktivierte Topics müssen aufräumbar
    # bleiben — die Liste zeigt sie ja auch an
    topic = await get_topic(session, topic_id, only_active=False)
    guard_mandatory(topic)
    result = await session.execute(
        delete(Subscription).where(
            Subscription.user_id == user.id, Subscription.topic_id == topic.id
        )
    )
    if result.rowcount:  # type: ignore[attr-defined]  # Audit nur bei echter Änderung
        session.add(
            AuditLog(
                actor_email=actor.email,
                action="admin_unsubscribe",
                detail={"user_id": user.id, "topic_id": topic.id},
            )
        )
    await session.commit()
