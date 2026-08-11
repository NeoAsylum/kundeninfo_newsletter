"""Gemeinsame Topic-Helfer für Self-Service- und Admin-Routen.

Ein Modul statt privater Kopien in drei Routern: Fehlercodes und
Wortlaut bleiben überall identisch.
"""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError
from app.db.models import Dispatch, DispatchStatus, Subscription, Topic

# Ein Versand ist noch nicht abgeschlossen — der Worker arbeitet ihn gerade ab oder
# wird ihn abarbeiten. Solange darf der Verteilername nicht wandern (siehe unten).
OPEN_DISPATCH_STATES = (DispatchStatus.pending, DispatchStatus.sending)


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


@dataclass(frozen=True)
class TopicUsage:
    """Was an einem Verteiler hängt — Grundlage jeder Lösch- und Umbenenn-Entscheidung."""

    subscriber_count: int
    dispatch_count: int
    open_dispatch_count: int

    @property
    def has_open_dispatch(self) -> bool:
        return self.open_dispatch_count > 0

    @property
    def deletable(self) -> bool:
        """Echtes Löschen geht nur ohne Versandhistorie: dispatches.topic_id ist mit
        ON DELETE RESTRICT verdrahtet, und Versände werden nie gelöscht (unveränderliche
        Historie). Mit Historie bleibt nur die Deaktivierung."""
        return self.dispatch_count == 0


async def topic_usage(session: AsyncSession, topic_id: str) -> TopicUsage:
    subscribers = (
        await session.execute(
            select(func.count()).select_from(Subscription).where(Subscription.topic_id == topic_id)
        )
    ).scalar_one()
    dispatches = (
        await session.execute(
            select(func.count()).select_from(Dispatch).where(Dispatch.topic_id == topic_id)
        )
    ).scalar_one()
    open_dispatches = (
        await session.execute(
            select(func.count())
            .select_from(Dispatch)
            .where(Dispatch.topic_id == topic_id, Dispatch.status.in_(OPEN_DISPATCH_STATES))
        )
    ).scalar_one()
    return TopicUsage(
        subscriber_count=subscribers,
        dispatch_count=dispatches,
        open_dispatch_count=open_dispatches,
    )


def guard_rename(topic: Topic, new_name: str, usage: TopicUsage) -> None:
    """Verbietet das Umbenennen, solange ein Versand offen ist.

    Grund ist eine Kopplung, die man sonst erst an falschen Mails merkt: Der Betreff
    wird bei der Anlage eingefroren („[STÖRUNG] Verteilername: Titel“), der Worker
    schneidet den Titel zur Sendezeit aber per Textsuche nach dem AKTUELLEN
    Verteilernamen wieder heraus. Passt der Marker nicht mehr, landet der komplette
    alte Betreff als Titel in der Mail — sichtbar falsch, bei bis zu 5.000 Empfängern.
    """
    if new_name != topic.name and usage.has_open_dispatch:
        raise ApiError(
            409,
            "TOPIC_RENAME_BLOCKED",
            f"„{topic.name}“ hat noch {usage.open_dispatch_count} laufende(n) Versand. "
            "Umbenennen würde den Titel in den bereits erzeugten Mails verfälschen — "
            "bitte warten, bis der Versand abgeschlossen ist.",
        )


def guard_delete(topic: Topic, usage: TopicUsage) -> None:
    if not usage.deletable:
        raise ApiError(
            409,
            "TOPIC_IN_USE",
            f"„{topic.name}“ hat {usage.dispatch_count} Versand/Versände in der Historie "
            "und kann nicht gelöscht werden — die Historie bleibt unveränderlich. "
            "Deaktiviere den Verteiler stattdessen: er verschwindet dann aus Abo-Maske "
            "und Versand-Auswahl, die Meldungen bleiben nachvollziehbar.",
        )
