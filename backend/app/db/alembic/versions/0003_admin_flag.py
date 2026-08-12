"""users.is_admin — im Portal vergebene Adminrechte (ADR-0022)

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-11

Additiv (ADR-0011): eine neue Spalte mit server_default, damit bestehende Zeilen
gültig bleiben und die Migration ohne Ausfallfenster läuft.

Bestandsübernahme: Bis hierher kam die Adminrolle ausschließlich aus dem IdP, die
Datenbank weiß also nicht, wer Admin ist. Die Spalte darf aber nicht leer
starten — sonst steht in der neuen Rollen-Oberfläche niemand, und wer Rechte
vergeben will, findet keinen Ausgangspunkt. Wir übernehmen deshalb jeden, der
belegbar bereits als Admin gehandelt hat: Ersteller von Versänden und Akteure im
Audit-Log. Beides sind Aktionen, die nur hinter dem Admin-Gate möglich sind.

Konten, die noch nie als Admin gehandelt haben (z. B. ein frischer Zugang),
erfasst das nicht. Nach ADR-0022 gibt es keine IdP-Rolle mehr, die sie trüge; der
Weg zurück ist die Demo-Endung @demo.invalid bzw. ADMIN_BOOTSTRAP_EMAILS, danach
die Rollen-Oberfläche (RUNBOOK 6b).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Wiederholbar halten: MariaDB kennt kein transaktionales DDL, ein ALTER TABLE ist
    # also sofort committet — die Bestandsübernahme unten aber nicht. Bricht sie ab
    # (Lock-Timeout, Verbindungsverlust), bleibt die Spalte stehen, während Alembic die
    # Revision nicht stempelt. Ein zweiter Anlauf lief dann in „Duplicate column name"
    # und der API-Container startete in einer Endlosschleife, die sich nur per
    # Hand-SQL beheben lässt. Deshalb prüfen statt blind anlegen.
    spalten = {s["name"] for s in inspect(conn).get_columns("users")}
    if "is_admin" not in spalten:
        op.add_column(
            "users",
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="0"),
        )

    # Die folgenden UPDATEs sind von sich aus wiederholbar (sie setzen nur auf 1).
    # Wer einen Versand angelegt hat, war Admin — die Route hängt hinter require_admin.
    conn.execute(
        sa.text(
            "UPDATE users SET is_admin = 1 WHERE id IN "
            "(SELECT DISTINCT created_by_user_id FROM dispatches)"
        )
    )
    # Ebenso jeder Akteur im Audit-Log — dort landen ausschließlich Admin-Aktionen,
    # solange AUDIT_SUBSCRIPTIONS aus ist (ADR-0017); deshalb die Einschränkung auf
    # die Admin-Aktionen.
    #
    # `audit_log` führt keine user_id, die E-Mail ist dort der einzige Schlüssel —
    # und sie ist KEIN stabiler Anker (ADR-0010: oidc_sub ist es). Adressen werden
    # recycelt: Verlässt ein Admin den Konzern und erhält jemand anders seine
    # Adresse, schreibt die Kollisionsbehandlung beim ersten Login die Alt-Zeile auf
    # `user-<id>@invalid.archiviert` um und die NEUE Zeile trägt die Adresse. Ein
    # reiner Adressvergleich würde diese Person zum Admin machen, ohne dass sie es
    # je war. Deshalb die Zeitachse: Wer gehandelt hat, existierte davor.
    #
    # Diese Absicherung ruht auf einer Annahme, die man kennen muss: Es gibt keinen
    # Weg, die Adresse eines BESTEHENDEN Kontos zu aendern (die Keycloak-Account-
    # Konsole ist per NGINX-Allowlist auf 404, UPDATE_EMAIL ist nicht aktiviert, und
    # kein Portal-Endpunkt schreibt users.email). Eine Neuregistrierung erzeugt
    # dagegen einen neuen oidc_sub und damit eine Zeile mit aktuellem created_at —
    # dann greift die Bedingung. Wer die Account-Konsole spaeter freischaltet,
    # hebelt diesen Schutz rueckwirkend aus.
    conn.execute(
        sa.text(
            "UPDATE users u SET u.is_admin = 1 WHERE EXISTS ("
            "  SELECT 1 FROM audit_log a"
            "  WHERE a.actor_email = u.email"
            "    AND a.ts >= u.created_at"
            "    AND a.action IN ('dispatch_created', 'user_activated',"
            "                     'user_deactivated', 'admin_subscribe',"
            "                     'admin_unsubscribe'))"
        )
    )


def downgrade() -> None:
    if "is_admin" in {s["name"] for s in inspect(op.get_bind()).get_columns("users")}:
        op.drop_column("users", "is_admin")
