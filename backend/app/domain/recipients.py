"""Empfängerauflösung (Plan 4.3, ADR-009).

Pflicht-Topics sind implizit: keine subscriptions-Zeilen, sondern zur Laufzeit
"alle aktiven User". Dieselbe Funktion bedient recipient-count (Versand-Maske)
und den Empfänger-Snapshot beim Anlegen eines Versands — die Vorschau kann
nie von der Realität abweichen.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Subscription, Topic, User


async def resolve_recipient_users(session: AsyncSession, topic: Topic) -> list[User]:
    if topic.is_mandatory:
        stmt = select(User).where(User.is_active.is_(True))
    else:
        stmt = (
            select(User)
            .join(Subscription, Subscription.user_id == User.id)
            .where(Subscription.topic_id == topic.id, User.is_active.is_(True))
        )
    return list((await session.execute(stmt.order_by(User.id))).scalars())
