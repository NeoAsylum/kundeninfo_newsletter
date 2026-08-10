"""Seed der 5 Topics aus dem Sketch (idempotent, Plan 4.3 / ADR-016)

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TOPICS = [
    (
        "zentrale-stoerungen",
        "Zentrale Störungsmeldungen",
        "Übergeordnete IT-Infrastruktur, Netzwerke und allgemeine Systemausfälle.",
        1,
    ),
    (
        "kap",
        "KAP Störungsmeldungen",
        "Benachrichtigungen zu Störungen und Wartungen im KAP-Umfeld.",
        0,
    ),
    (
        "interflex",
        "Störungsmeldungen Interflex",
        "Meldungen zu Zeiterfassung und Zutrittskontrollsystemen (Interflex).",
        0,
    ),
    (
        "lifefactory",
        "Störungsmeldungen LifeFactory",
        "Informationen zu Störungen rund um LifeFactory-Anwendungen.",
        0,
    ),
    (
        "aap",
        "Störungsmeldungen AAP",
        "Benachrichtigungen bezüglich AAP-Infrastruktur und -Services.",
        0,
    ),
]


def upgrade() -> None:
    conn = op.get_bind()
    for topic_id, name, description, mandatory in TOPICS:
        conn.execute(
            sa.text(
                "INSERT INTO topics (id, name, description, is_mandatory, is_active) "
                "VALUES (:id, :name, :description, :mandatory, 1) "
                "ON DUPLICATE KEY UPDATE id = id"
            ),
            {"id": topic_id, "name": name, "description": description, "mandatory": mandatory},
        )


def downgrade() -> None:
    # Seed-Daten bleiben bewusst stehen (Topics könnten bereits Abos/Versände tragen)
    pass
