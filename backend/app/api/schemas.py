from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.mail.render import TITLE_MAX_LENGTH

SeverityLiteral = Literal["stoerung", "einschraenkung", "entwarnung"]


class MeOut(BaseModel):
    email: str
    display_name: str | None
    roles: list[str]


class TopicOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_mandatory: bool
    subscribed: bool


class RecipientCountOut(BaseModel):
    topic_id: str
    count: int


class DispatchDraft(BaseModel):
    topic_id: str
    severity: SeverityLiteral
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    body: str = Field(min_length=1, max_length=100_000)


class PreviewOut(BaseModel):
    subject: str
    html: str


class DispatchOut(BaseModel):
    id: int
    topic_id: str
    topic_name: str
    severity: SeverityLiteral
    subject: str
    status: str
    recipient_count: int
    sent_count: int
    failed_count: int
    open_count: int
    created_at: datetime
    finished_at: datetime | None


class DispatchDetailOut(DispatchOut):
    body: str
    created_by_email: str | None


class AdminUserOut(BaseModel):
    """Empfänger-Verwaltung: bewusst OHNE last_login_at/created_at (Verhaltensdaten
    bleiben hinter der Betriebsrats-Klärung B5, Plan 10.1)."""

    id: int
    email: str
    display_name: str | None
    is_active: bool
    subscribed_topic_ids: list[str]


class AdminUserListOut(BaseModel):
    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int


class AdminUserPatch(BaseModel):
    is_active: bool
