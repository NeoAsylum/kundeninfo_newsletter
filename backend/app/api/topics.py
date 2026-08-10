from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUserDep, SessionDep
from app.api.schemas import TopicOut
from app.db.models import Subscription, Topic

router = APIRouter()


@router.get("/topics", response_model=list[TopicOut])
async def list_topics(session: SessionDep, user: CurrentUserDep) -> list[TopicOut]:
    """Alle aktiven Topics mit subscribed-Flag — EIN Call rendert die Abo-Maske (Plan 7.2)."""
    topics = list(
        (
            await session.execute(
                select(Topic)
                .where(Topic.is_active.is_(True))
                .order_by(Topic.is_mandatory.desc(), Topic.name)
            )
        ).scalars()
    )
    subscribed_ids = set(
        (
            await session.execute(
                select(Subscription.topic_id).where(Subscription.user_id == user.id)
            )
        ).scalars()
    )
    return [
        TopicOut(
            id=t.id,
            name=t.name,
            description=t.description,
            is_mandatory=t.is_mandatory,
            # Pflicht-Topics sind implizit immer abonniert (ADR-009)
            subscribed=True if t.is_mandatory else t.id in subscribed_ids,
        )
        for t in topics
    ]
