"""Komplettes MVP-Schema (Plan 4.2)

Revision ID: 0001
Revises:
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("oidc_sub", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("oidc_sub", name="uq_users_oidc_sub"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "topics",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
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
        sa.Column("body", sa.Text(), nullable=False),
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
    )
    op.create_index("ix_dr_worker", "dispatch_recipients", ["status", "next_attempt_at"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("ts", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("actor_email", sa.String(320), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
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
    # PostgreSQL: die von den Enum-Spalten angelegten Typen bleiben sonst zurück.
    for enum_name in ("recipient_status_enum", "dispatch_status_enum", "severity_enum"):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
