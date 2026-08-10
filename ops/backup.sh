#!/bin/sh
# Nächtliches DB-Backup, solange die DB im Docker-Volume läuft (Plan 9.3).
# Cron-Beispiel (VM, User root):  0 2 * * *  /opt/stoerungsinfo/ops/backup.sh
# Nach dem Cutover auf die externe DB übernimmt die zentrale DB-Infra — Skript entfällt.
set -eu

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/stoerungsinfo}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE="docker compose -f $REPO_DIR/compose.yaml -f $REPO_DIR/compose.db.yaml -f $REPO_DIR/compose.prod.yaml"

# shellcheck disable=SC1091
. "$REPO_DIR/.env"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
TARGET="$BACKUP_DIR/newsletter_$STAMP.sql.gz"

# --single-transaction: konsistenter InnoDB-Snapshot ohne Tabellen-Locks
$COMPOSE exec -T mariadb sh -c \
    "mariadb-dump --single-transaction -u root -p\"\$MARIADB_ROOT_PASSWORD\" \"${DB_NAME:-newsletter}\"" \
    | gzip > "$TARGET"

# Dumps enthalten personenbezogene Klartextdaten → restriktive Rechte (Plan 9.3)
chmod 600 "$TARGET"

# Alte Dumps aufräumen
find "$BACKUP_DIR" -name 'newsletter_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

echo "Backup OK: $TARGET ($(du -h "$TARGET" | cut -f1))"
echo "HINWEIS: Monatlicher Restore-Test laut RUNBOOK — ein nie restauriertes Backup existiert nicht."
