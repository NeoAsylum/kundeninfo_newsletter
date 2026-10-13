"""dispatches.idempotency_key — „Versand anlegen“ wird wiederholbar (ADR-0031)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-07

Additiv (ADR-0011): eine neue Spalte, nullable und ohne Default — bestehende Zeilen
bleiben unberührt (NULL). Der eindeutige Index ist der eigentliche Schutz: Von zwei
gleichzeitigen Aufrufen mit demselben Schlüssel scheitert der zweite INSERT an ihm.
NULL-Werte gelten in PostgreSQL als voneinander verschieden; Versände ohne Schlüssel
kollidieren also nicht.
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

INDEX = "uq_dispatches_idempotency_key"


def upgrade() -> None:
    op.add_column("dispatches", sa.Column("idempotency_key", sa.Uuid(), nullable=True))
    op.create_index(INDEX, "dispatches", ["idempotency_key"], unique=True)


def downgrade() -> None:
    # Die gespeicherten Schlüssel gehen verloren, die Versände bleiben.
    op.drop_index(INDEX, table_name="dispatches")
    op.drop_column("dispatches", "idempotency_key")
