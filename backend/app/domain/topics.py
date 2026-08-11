"""Gemeinsame Topic-Helfer für Self-Service- und Admin-Routen.

Ein Modul statt privater Kopien in drei Routern: Fehlercodes und
Wortlaut bleiben überall identisch.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError
from app.db.models import Topic


async def get_topic(session: AsyncSession, topic_id: str, *, only_active: bool = True) -> Topic:
    """only_active=False erlaubt z. B. das Aufräumen von Abos deaktivierter Topics."""
    conditions = [Topic.id == topic_id]
    if only_active:
        conditions.append(Topic.is_active.is_(True))
    topic = (await session.execute(select(Topic).where(*conditions))).scalar_one_or_none()
    if topic is None:
        raise ApiError(404, "TOPIC_NOT_FOUND", f"Topic '{topic_id}' existiert nicht")
    return topic


def guard_mandatory(topic: Topic) -> None:
    if topic.is_mandatory:
        # Kontextneutral formuliert: gilt für Selbstbedienung UND Admin-Pflege (ADR-0009)
        raise ApiError(
            409,
            "TOPIC_MANDATORY",
            f"„{topic.name}“ ist ein Pflicht-Verteiler — er gilt automatisch für alle "
            "aktiven Empfänger und wird nicht als Abo gepflegt",
        )
