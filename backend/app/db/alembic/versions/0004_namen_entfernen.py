"""Personennamen aus dem Bestand entfernen (ADR-0025)

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-11

Die Anwendung liest, speichert und zeigt keine Personennamen mehr. Damit sind die
bereits gespeicherten Werte Datenhaltung ohne Zweck — sie werden geleert.

Die SPALTE bleibt bestehen: Migrationen sind additiv (ADR-0011), ein DROP COLUMN
wäre nicht rückholbar und bringt keinen Nutzen. Sie ist nullable und wird von
niemandem mehr beschrieben.
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Wiederholbar: ein zweiter Lauf trifft nur noch NULL-Zeilen.
    op.get_bind().execute(
        sa.text("UPDATE users SET display_name = NULL WHERE display_name IS NOT NULL")
    )


def downgrade() -> None:
    # Die Namen sind gelöscht und kommen nicht zurück — bewusst kein Rückweg.
    # Beim nächsten Login würde sie ohnehin niemand neu schreiben.
    pass
