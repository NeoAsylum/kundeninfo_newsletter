"""Abo-Self-Service (Plan 7.2): idempotentes PUT/DELETE, 409 bei Pflicht-Topics.

Die API ist die Sicherheitsgrenze — das UI sperrt Pflicht-Toggles nur zusätzlich.
"""

from fastapi import APIRouter, Response
from sqlalchemy import delete, select
from sqlalchemy.dialects.mysql import insert as mysql_insert

from app.api.deps import CurrentUserDep, SessionDep, SettingsDep
from app.api.errors import ApiError
from app.db.models import AuditLog, Subscription, Topic

router = APIRouter()


async def _get_active_topic(session, topic_id: str) -> Topic:
    topic = (
        await session.execute(select(Topic).where(Topic.id == topic_id, Topic.is_active.is_(True)))
    ).scalar_one_or_none()
    if topic is None:
        raise ApiError(404, "TOPIC_NOT_FOUND", f"Topic '{topic_id}' existiert nicht")
    return topic


def _guard_mandatory(topic: Topic) -> None:
    if topic.is_mandatory:
        raise ApiError(
            409, "TOPIC_MANDATORY", f"'{topic.name}' ist ein Pflicht-Verteiler und nicht abwählbar"
        )


async def _audit(session, settings, actor_email: str, action: str, topic_id: str) -> None:
    # Abo-Änderungs-Protokollierung erst nach Betriebsrats-/DSB-Freigabe (ADR-017)
    if settings.audit_subscriptions:
        session.add(AuditLog(actor_email=actor_email, action=action, detail={"topic_id": topic_id}))


@router.put("/me/subscriptions/{topic_id}", status_code=204)
async def subscribe(
    topic_id: str, session: SessionDep, user: CurrentUserDep, settings: SettingsDep
) -> Response:
    topic = await _get_active_topic(session, topic_id)
    _guard_mandatory(topic)
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
    topic = await _get_active_topic(session, topic_id)
    _guard_mandatory(topic)
    await session.execute(
        delete(Subscription).where(
            Subscription.user_id == user.id, Subscription.topic_id == topic.id
        )
    )
    await _audit(session, settings, user.email, "unsubscribe", topic.id)
    await session.commit()
    return Response(status_code=204)
