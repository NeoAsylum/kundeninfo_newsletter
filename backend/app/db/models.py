"""SQLAlchemy-Modelle — Schema entsteht ausschließlich über Alembic (ADR-011).

Entwurfsentscheidungen siehe Plan Abschnitt 4: Pflicht-Topics implizit (ADR-009),
dispatch_recipients = Outbox + Audit in einer Tabelle, Soft-Delete über is_active.
"""

import enum
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Severity(enum.StrEnum):
    stoerung = "stoerung"
    einschraenkung = "einschraenkung"
    entwarnung = "entwarnung"


class DispatchStatus(enum.StrEnum):
    pending = "pending"
    sending = "sending"
    completed = "completed"
    completed_with_errors = "completed_with_errors"
    failed = "failed"


class RecipientStatus(enum.StrEnum):
    pending = "pending"
    retry_wait = "retry_wait"
    sent = "sent"
    failed = "failed"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x])


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Stabiler IdP-Anker — die einzige harte Identität (E-Mails ändern sich, ADR-010)
    oidc_sub: Mapped[str] = mapped_column(String(255), unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)

    subscriptions: Mapped[list["Subscription"]] = relationship(back_populates="user")


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # Slug, z. B. 'kap'
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    topic_id: Mapped[str] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped[User] = relationship(back_populates="subscriptions")
    topic: Mapped[Topic] = relationship()


class Dispatch(Base):
    __tablename__ = "dispatches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    topic_id: Mapped[str] = mapped_column(ForeignKey("topics.id", ondelete="RESTRICT"))
    severity: Mapped[Severity] = mapped_column(_enum(Severity, "severity_enum"))
    subject: Mapped[str] = mapped_column(String(255))  # final inkl. Präfix, wie versendet
    body: Mapped[str] = mapped_column(Text().with_variant(MEDIUMTEXT, "mysql", "mariadb"))
    status: Mapped[DispatchStatus] = mapped_column(
        _enum(DispatchStatus, "dispatch_status_enum"), default=DispatchStatus.pending
    )
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)  # Snapshot
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Worker-Heartbeat: Grundlage der Stale-Erkennung (Plan 6.3)
    last_progress_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

    topic: Mapped[Topic] = relationship()
    recipients: Mapped[list["DispatchRecipient"]] = relationship(back_populates="dispatch")

    __table_args__ = (Index("ix_dispatches_created", "created_at"),)


class DispatchRecipient(Base):
    __tablename__ = "dispatch_recipients"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dispatch_id: Mapped[int] = mapped_column(ForeignKey("dispatches.id", ondelete="CASCADE"))
    # nullable + SET NULL: Audit überlebt eine spätere User-Löschung (DSGVO-Hebel)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    email: Mapped[str] = mapped_column(String(320))  # Snapshot zum Versandzeitpunkt
    status: Mapped[RecipientStatus] = mapped_column(
        _enum(RecipientStatus, "recipient_status_enum"), default=RecipientStatus.pending
    )
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime)  # Backoff-Steuerung
    last_error: Mapped[str | None] = mapped_column(String(500))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)

    dispatch: Mapped[Dispatch] = relationship(back_populates="recipients")

    __table_args__ = (
        UniqueConstraint("dispatch_id", "email", name="uq_dr_dispatch_email"),
        Index("ix_dr_worker", "status", "next_attempt_at"),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    actor_email: Mapped[str] = mapped_column(String(320))
    # MVP: nur Admin-Aktionen; subscribe/unsubscribe erst nach B5/B6-Freigabe (ADR-017)
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[dict | None] = mapped_column(JSON)

    __table_args__ = (Index("ix_audit_ts", "ts"),)
