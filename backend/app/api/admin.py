"""Admin-API (Rolle admin): Empfängerzahl, Vorschau, Versand anlegen, Historie (Plan 7.2).

Kein DELETE (Historie unveränderlich), Verteiler-CRUD liegt in admin_topics.py
(ADR-0024, löst ADR-0016 ab),
kein Abbruch (Erweiterungspunkt cancel).
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    CurrentUserDep,
    SessionDep,
    SettingsDep,
    require_admin,
)
from app.api.errors import ApiError
from app.api.schemas import (
    DispatchDetailOut,
    DispatchDraft,
    DispatchOut,
    PreviewOut,
    RecipientCountOut,
)
from app.core.clock import utcnow
from app.db.models import (
    AuditLog,
    Dispatch,
    DispatchRecipient,
    RecipientStatus,
    Severity,
    Topic,
    User,
)
from app.domain.recipients import resolve_recipient_users
from app.domain.topics import get_topic
from app.mail.render import build_subject, render_mail

# require_admin deckt beides ab: Es löst den DB-User auf (offboardet → 401 SESSION_STALE,
# das Frontend erzwingt Re-Login) und prüft danach das Adminrecht — allein aus
# users.is_admin, je Anfrage aus der DB (ADR-0022). IdP-Rollen werden nicht gelesen;
# ein Cookie allein autorisiert nicht.
router = APIRouter(dependencies=[Depends(require_admin)])


def _build_subject_checked(severity: Severity, topic_name: str, title: str) -> str:
    """Präfix + Topic-Name (bis 120) + Titel (bis 150) können subject VARCHAR(255)
    sprengen — 422 statt DataError/500 beim INSERT."""
    subject = build_subject(severity, topic_name, title)
    if len(subject) > 255:
        raise ApiError(
            422,
            "SUBJECT_TOO_LONG",
            f"Betreff wird {len(subject)} Zeichen lang (max. 255) — bitte den Titel kürzen",
        )
    return subject


@router.get("/topics/{topic_id}/recipient-count", response_model=RecipientCountOut)
async def recipient_count(topic_id: str, session: SessionDep) -> RecipientCountOut:
    """Identische Auflösungslogik wie der echte Versand (Plan 7.2)."""
    topic = await get_topic(session, topic_id)
    users = await resolve_recipient_users(session, topic)
    return RecipientCountOut(topic_id=topic.id, count=len(users))


@router.post("/dispatches/preview", response_model=PreviewOut)
async def preview(draft: DispatchDraft, session: SessionDep, settings: SettingsDep) -> PreviewOut:
    topic = await get_topic(session, draft.topic_id)
    severity = Severity(draft.severity)
    subject = _build_subject_checked(severity, topic.name, draft.title)
    html, _ = render_mail(settings, severity, topic.name, draft.title, draft.body)
    return PreviewOut(subject=subject, html=html)


@router.post("/dispatches", status_code=201, response_model=DispatchOut)
async def create_dispatch(
    draft: DispatchDraft,
    session: SessionDep,
    settings: SettingsDep,
    user: CurrentUserDep,
) -> DispatchOut:
    """Legt Auftrag + Empfänger-Snapshot in EINER Transaktion an (Outbox, Plan 6.3)."""
    topic = await get_topic(session, draft.topic_id)
    severity = Severity(draft.severity)
    recipients = await resolve_recipient_users(session, topic)
    if not recipients:
        raise ApiError(422, "NO_RECIPIENTS", f"'{topic.name}' hat aktuell keine Empfänger")

    dispatch = Dispatch(
        topic_id=topic.id,
        severity=severity,
        subject=_build_subject_checked(severity, topic.name, draft.title),
        body=draft.body,
        recipient_count=len(recipients),
        created_by_user_id=user.id,
    )
    session.add(dispatch)
    await session.flush()
    session.add_all(
        DispatchRecipient(dispatch_id=dispatch.id, user_id=r.id, email=r.email) for r in recipients
    )
    session.add(
        AuditLog(
            actor_email=user.email,
            action="dispatch_created",
            detail={
                "dispatch_id": dispatch.id,
                "topic_id": topic.id,
                "severity": severity.value,
                "recipient_count": len(recipients),
            },
        )
    )
    await session.commit()
    return DispatchOut(
        id=dispatch.id,
        topic_id=topic.id,
        topic_name=topic.name,
        severity=draft.severity,
        subject=dispatch.subject,
        status=dispatch.status.value,
        recipient_count=dispatch.recipient_count,
        sent_count=0,
        failed_count=0,
        open_count=dispatch.recipient_count,
        created_at=dispatch.created_at or utcnow(),
        finished_at=None,
    )


async def _recipient_counts(
    session: AsyncSession, dispatch_ids: list[int]
) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = defaultdict(lambda: {"sent": 0, "failed": 0, "open": 0})
    if not dispatch_ids:
        return counts
    rows = await session.execute(
        select(DispatchRecipient.dispatch_id, DispatchRecipient.status, func.count())
        .where(DispatchRecipient.dispatch_id.in_(dispatch_ids))
        .group_by(DispatchRecipient.dispatch_id, DispatchRecipient.status)
    )
    for dispatch_id, status, count in rows.all():
        if status == RecipientStatus.sent:
            counts[dispatch_id]["sent"] += count
        elif status == RecipientStatus.failed:
            counts[dispatch_id]["failed"] += count
        else:
            counts[dispatch_id]["open"] += count
    return counts


def _to_out(dispatch: Dispatch, topic_name: str, counts: dict[str, int]) -> DispatchOut:
    return DispatchOut(
        id=dispatch.id,
        topic_id=dispatch.topic_id,
        topic_name=topic_name,
        severity=dispatch.severity.value,
        subject=dispatch.subject,
        status=dispatch.status.value,
        recipient_count=dispatch.recipient_count,
        sent_count=counts["sent"],
        failed_count=counts["failed"],
        open_count=counts["open"],
        created_at=dispatch.created_at,
        finished_at=dispatch.finished_at,
    )


@router.get("/dispatches", response_model=list[DispatchOut])
async def list_dispatches(
    session: SessionDep,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[DispatchOut]:
    rows = (
        await session.execute(
            select(Dispatch, Topic.name)
            .join(Topic, Topic.id == Dispatch.topic_id)
            .order_by(Dispatch.created_at.desc(), Dispatch.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    counts = await _recipient_counts(session, [d.id for d, _ in rows])
    return [_to_out(d, topic_name, counts[d.id]) for d, topic_name in rows]


@router.get("/dispatches/{dispatch_id}", response_model=DispatchDetailOut)
async def dispatch_detail(dispatch_id: int, session: SessionDep) -> DispatchDetailOut:
    row = (
        await session.execute(
            select(Dispatch, Topic.name, User.email)
            .join(Topic, Topic.id == Dispatch.topic_id)
            .outerjoin(User, User.id == Dispatch.created_by_user_id)
            .where(Dispatch.id == dispatch_id)
        )
    ).first()
    if row is None:
        raise ApiError(404, "DISPATCH_NOT_FOUND", f"Versand {dispatch_id} existiert nicht")
    dispatch, topic_name, creator_email = row
    counts = await _recipient_counts(session, [dispatch.id])
    base = _to_out(dispatch, topic_name, counts[dispatch.id])
    return DispatchDetailOut(
        **base.model_dump(), body=dispatch.body, created_by_email=creator_email
    )
