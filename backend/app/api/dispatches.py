"""Meldungs-Historie für alle angemeldeten Nutzer (ADR-0023).

Getrennt vom Admin-Router und mit eigenem Schema — ein Freischalten der bestehenden
Admin-Historie hätte Empfängerzahlen, Zustell- und Fehlerzähler sowie die Adresse des
verfassenden Admins an die gesamte Belegschaft ausgeliefert. Hier gibt es
ausschließlich den Inhalt der Meldung.

Sichtbar sind die Meldungen ALLER Verteiler, nicht nur der abonnierten: Die Historie
ist als Nachschlagewerk gedacht („war das gestern schon bekannt?“), und eine
Einschränkung auf die eigenen Abos würde ausgerechnet bei einer Großstörung den Blick
auf das Nachbarsystem verstellen. Meldungen deaktivierter Verteiler bleiben ebenfalls
sichtbar — die Historie ist unveränderlich.
"""

from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUserDep, SessionDep
from app.api.schemas import MeldungListOut, MeldungOut
from app.db.models import Dispatch, DispatchStatus, Topic

router = APIRouter()

# Nur tatsächlich hinausgegangene Meldungen. Ein Versand in pending/sending ist noch
# nicht zugestellt, und ein 'failed' ist ein Betriebsvorfall — beides gehört in die
# Admin-Ansicht, nicht in die Lesehistorie der Belegschaft.
SICHTBARE_STATUS = (DispatchStatus.completed, DispatchStatus.completed_with_errors)


@router.get("/dispatches", response_model=MeldungListOut)
async def list_meldungen(
    session: SessionDep,
    user: CurrentUserDep,
    topic_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> MeldungListOut:
    """CurrentUserDep statt IdentityDep: Ein offboardeter Empfänger soll hier nichts
    mehr lesen (401 SESSION_STALE), und /me würde das allein nicht abdecken."""
    conditions: list[Any] = [Dispatch.status.in_(SICHTBARE_STATUS)]
    if topic_id:
        conditions.append(Dispatch.topic_id == topic_id)

    total = (
        await session.execute(select(func.count()).select_from(Dispatch).where(*conditions))
    ).scalar_one()
    rows = (
        await session.execute(
            select(Dispatch, Topic.name)
            .join(Topic, Topic.id == Dispatch.topic_id)
            .where(*conditions)
            .order_by(Dispatch.created_at.desc(), Dispatch.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return MeldungListOut(
        items=[
            MeldungOut(
                id=dispatch.id,
                topic_id=dispatch.topic_id,
                topic_name=topic_name,
                severity=dispatch.severity.value,
                subject=dispatch.subject,
                body=dispatch.body,
                created_at=dispatch.created_at,
            )
            for dispatch, topic_name in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
