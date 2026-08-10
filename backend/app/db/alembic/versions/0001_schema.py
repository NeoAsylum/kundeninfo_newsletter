"""Komplettes MVP-Schema (Plan 4.2)

Revision ID: 0001
Revises:
Create Date: 2026-08-10
"""

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import MEDIUMTEXT

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_TABLE_KW: dict[str, Any] = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_unicode_ci",
}


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("oidc_sub", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("oidc_sub", name="uq_users_oidc_sub"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        **_TABLE_KW,
    )

    op.create_table(
        "topics",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        **_TABLE_KW,
    )

    op.create_table(
        "subscriptions",
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("topic_id", sa.String(64), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_sub_user", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["topic_id"], ["topics.id"], name="fk_sub_topic", ondelete="CASCADE"
        ),
        **_TABLE_KW,
    )

    op.create_table(
        "dispatches",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("topic_id", sa.String(64), nullable=False),
        sa.Column(
            "severity",
            sa.Enum("stoerung", "einschraenkung", "entwarnung", name="severity_enum"),
            nullable=False,
        ),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("body", sa.Text().with_variant(MEDIUMTEXT(), "mysql", "mariadb"), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "sending",
                "completed",
                "completed_with_errors",
                "failed",
                name="dispatch_status_enum",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("last_progress_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["topic_id"], ["topics.id"], name="fk_disp_topic", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], name="fk_disp_user", ondelete="RESTRICT"
        ),
        **_TABLE_KW,
    )
    op.create_index("ix_dispatches_created", "dispatches", ["created_at"])

    op.create_table(
        "dispatch_recipients",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("dispatch_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "retry_wait", "sent", "failed", name="recipient_status_enum"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("attempts", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("dispatch_id", "email", name="uq_dr_dispatch_email"),
        sa.ForeignKeyConstraint(
            ["dispatch_id"], ["dispatches.id"], name="fk_dr_dispatch", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_dr_user", ondelete="SET NULL"),
        **_TABLE_KW,
    )
    op.create_index("ix_dr_worker", "dispatch_recipients", ["status", "next_attempt_at"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("ts", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("actor_email", sa.String(320), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
        **_TABLE_KW,
    )
    op.create_index("ix_audit_ts", "audit_log", ["ts"])


def downgrade() -> None:
    for table in (
        "audit_log",
        "dispatch_recipients",
        "dispatches",
        "subscriptions",
        "topics",
        "users",
    ):
        op.drop_table(table)
