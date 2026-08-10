"""Abo-Self-Service (Plan 7.2): idempotentes PUT/DELETE, 409 bei Pflicht-Topics.

Die API ist die Sicherheitsgrenze — das UI sperrt Pflicht-Toggles nur zusätzlich.
"""

from fastapi import APIRouter, Response
from sqlalchemy import delete
from sqlalchemy.dialects.mysql import insert as mysql_insert

from app.api.deps import CurrentUserDep, SessionDep, SettingsDep
from app.db.models import AuditLog, Subscription
from app.domain.topics import get_topic, guard_mandatory

router = APIRouter()


async def _audit(session, settings, actor_email: str, action: str, topic_id: str) -> None:
    # Abo-Änderungs-Protokollierung erst nach Betriebsrats-/DSB-Freigabe (ADR-017)
    if settings.audit_subscriptions:
        session.add(AuditLog(actor_email=actor_email, action=action, detail={"topic_id": topic_id}))


@router.put("/me/subscriptions/{topic_id}", status_code=204)
async def subscribe(
    topic_id: str, session: SessionDep, user: CurrentUserDep, settings: SettingsDep
) -> Response:
    topic = await get_topic(session, topic_id)
    guard_mandatory(topic)
    stmt = (
        mysql_insert(Subscription)
        .values(user_id=user.id, topic_id=topic.id)
        .on_duplicate_key_update(user_id=Subscription.user_id)  # idempotent
    )
    await session.execute(stmt)
    await _audit(session, settings, user.email, "subscribe", topic.id)
    await session.commit()
    return Response(status_code=204)


@router.delete("/me/subscriptions/{topic_id}", status_code=204)
async def unsubscribe(
    topic_id: str, session: SessionDep, user: CurrentUserDep, settings: SettingsDep
) -> Response:
    topic = await get_topic(session, topic_id)
    guard_mandatory(topic)
    await session.execute(
        delete(Subscription).where(
            Subscription.user_id == user.id, Subscription.topic_id == topic.id
        )
    )
    await _audit(session, settings, user.email, "unsubscribe", topic.id)
    await session.commit()
    return Response(status_code=204)
