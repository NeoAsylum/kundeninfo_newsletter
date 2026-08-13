"""Verteiler-Verwaltung (Rolle admin): anlegen, bearbeiten, deaktivieren, löschen.

Löst die RUNBOOK-SQL-Prozedur als Regelweg ab (ADR-0024, löst ADR-0016 ab).

Bewusste Grenzen, alle aus dem Datenmodell begründet:
- **Der Slug ist nicht änderbar.** `topics.id` ist Primärschlüssel, und `subscriptions`
  wie `dispatches` verweisen ohne ON UPDATE darauf — ein Slug-Wechsel wäre ein
  PK-Update, das PostgreSQL bei jeder Referenz ablehnt.
- **Löschen nur ohne Versandhistorie.** `dispatches.topic_id` hat ON DELETE RESTRICT,
  Versände werden nie gelöscht. Mit Historie bleibt die Deaktivierung.
- **Umbenennen nur ohne laufenden Versand** (siehe domain.topics.guard_rename).
- **Kein Abo-Aufräumen beim Pflicht-Umschalten.** Bestehende Abo-Zeilen bleiben liegen
  und werden von der Empfängerauflösung ignoriert, solange der Verteiler Pflicht ist
  (ADR-0009 verwirft die Sync-Logik ausdrücklich).
"""

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUserDep, SessionDep, require_admin
from app.api.errors import ApiError
from app.api.schemas import AdminTopicOut, TopicCreate, TopicPatch
from app.db.models import AuditLog, Subscription, Topic
from app.domain.topics import (
    TopicUsage,
    get_topic,
    guard_delete,
    guard_rename,
    topic_usage,
)

router = APIRouter(dependencies=[Depends(require_admin)])


def _to_out(topic: Topic, usage: TopicUsage) -> AdminTopicOut:
    return AdminTopicOut(
        id=topic.id,
        name=topic.name,
        description=topic.description,
        is_mandatory=topic.is_mandatory,
        is_active=topic.is_active,
        subscriber_count=usage.subscriber_count,
        dispatch_count=usage.dispatch_count,
        has_open_dispatch=usage.has_open_dispatch,
    )


async def _assert_name_free(session: AsyncSession, name: str, *, except_id: str | None) -> None:
    """Namen sind in der Datenbank nicht eindeutig (kein UNIQUE, und eine Änderung wäre
    nicht additiv). Die Prüfung liegt deshalb hier: Zwei gleichnamige Verteiler machen
    die Auswahl in Abo-Maske und Versand-Dropdown mehrdeutig."""
    conditions = [Topic.name == name]
    if except_id is not None:
        conditions.append(Topic.id != except_id)
    clash = (await session.execute(select(Topic).where(*conditions))).scalar_one_or_none()
    if clash is not None:
        raise ApiError(
            409,
            "TOPIC_NAME_EXISTS",
            f"„{name}“ ist schon der Name von Verteiler „{clash.id}“ — "
            "bitte einen unterscheidbaren Namen wählen",
        )


@router.get("/topics", response_model=list[AdminTopicOut])
async def list_topics(session: SessionDep) -> list[AdminTopicOut]:
    """Alle Verteiler inklusive der deaktivierten — genau die will diese Maske
    bearbeiten und reaktivieren können. Ohne Paging: Verteiler sind Stammdaten in
    zweistelliger Zahl, ein Envelope mit total wäre hier nur Ballast.
    """
    topics = list(
        (
            await session.execute(
                select(Topic).order_by(
                    Topic.is_active.desc(), Topic.is_mandatory.desc(), Topic.name
                )
            )
        ).scalars()
    )
    return [_to_out(topic, await topic_usage(session, topic.id)) for topic in topics]


@router.post("/topics", response_model=AdminTopicOut, status_code=201)
async def create_topic(
    payload: TopicCreate, session: SessionDep, actor: CurrentUserDep
) -> AdminTopicOut:
    existing = (
        await session.execute(select(Topic).where(Topic.id == payload.id))
    ).scalar_one_or_none()
    if existing is not None:
        raise ApiError(
            409,
            "TOPIC_EXISTS",
            f"Der Slug „{payload.id}“ ist bereits vergeben (Verteiler „{existing.name}“"
            + (", derzeit deaktiviert" if not existing.is_active else "")
            + ")",
        )
    await _assert_name_free(session, payload.name, except_id=None)

    topic = Topic(
        id=payload.id,
        name=payload.name,
        description=payload.description,
        is_mandatory=payload.is_mandatory,
        is_active=True,
    )
    session.add(topic)
    session.add(
        AuditLog(
            actor_email=actor.email,
            action="topic_created",
            detail={
                "topic_id": topic.id,
                "name": topic.name,
                "is_mandatory": topic.is_mandatory,
            },
        )
    )
    await session.commit()
    return _to_out(topic, await topic_usage(session, topic.id))


@router.patch("/topics/{topic_id}", response_model=AdminTopicOut)
async def update_topic(
    topic_id: str, patch: TopicPatch, session: SessionDep, actor: CurrentUserDep
) -> AdminTopicOut:
    # only_active=False: deaktivierte Verteiler müssen reaktivierbar bleiben
    topic = await get_topic(session, topic_id, only_active=False)
    usage = await topic_usage(session, topic.id)
    # exclude_unset: Ein Teil-Update darf nicht die Beschreibung leeren, nur weil das
    # Feld im Formular nicht mitgeschickt wurde.
    changes = patch.model_dump(exclude_unset=True)

    if "name" in changes and changes["name"] is not None:
        guard_rename(topic, changes["name"], usage)
        await _assert_name_free(session, changes["name"], except_id=topic.id)

    applied: dict[str, object] = {}
    for feld in ("name", "description", "is_mandatory", "is_active"):
        if feld not in changes:
            continue
        neu = changes[feld]
        if feld != "description" and neu is None:  # nur description ist nullable
            continue
        if getattr(topic, feld) != neu:
            setattr(topic, feld, neu)
            applied[feld] = neu

    if applied:
        session.add(
            AuditLog(
                actor_email=actor.email,
                action="topic_updated",
                detail={"topic_id": topic.id, "geaendert": applied},
            )
        )
        await session.commit()
    return _to_out(topic, await topic_usage(session, topic.id))


@router.delete("/topics/{topic_id}", status_code=204)
async def delete_topic(topic_id: str, session: SessionDep, actor: CurrentUserDep) -> None:
    """Löscht einen Verteiler endgültig — nur zulässig, solange keine Meldung darüber
    verschickt wurde. Die Abos gehen dabei per CASCADE mit; ihre Zahl steht im
    Audit-Eintrag, weil sie sonst nicht mehr nachvollziehbar wäre.
    """
    topic = await get_topic(session, topic_id, only_active=False)
    usage = await topic_usage(session, topic.id)
    guard_delete(topic, usage)

    await session.execute(delete(Subscription).where(Subscription.topic_id == topic.id))
    await session.execute(delete(Topic).where(Topic.id == topic.id))
    session.add(
        AuditLog(
            actor_email=actor.email,
            action="topic_deleted",
            detail={
                "topic_id": topic.id,
                "name": topic.name,
                "verlorene_abos": usage.subscriber_count,
            },
        )
    )
    await session.commit()
