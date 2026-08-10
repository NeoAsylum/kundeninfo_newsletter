#!/bin/sh
# Nächtliches DB-Backup, solange die DB im Docker-Volume läuft (Plan 9.3).
# Cron-Beispiel (VM, User root):  0 2 * * *  /opt/stoerungsinfo/ops/backup.sh
# Nach dem Cutover auf die externe DB übernimmt die zentrale DB-Infra.
#
# Sichert BEIDE Datenbanken: 'newsletter' (Abos, Versandhistorie) und 'keycloak'
# (Benutzer, Passwörter, Realm). Ohne die zweite wäre nach einem Restore die
# Anmeldung unmöglich — die Abo-Daten hätten keine zugehörigen Konten mehr.
set -eu

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/stoerungsinfo}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# Overlay automatisch erkennen: öffentlicher Betrieb nutzt compose.public.yaml,
# die Konzern-VM compose.prod.yaml.
if [ -f "$REPO_DIR/compose.public.yaml" ] && \
   docker compose -f "$REPO_DIR/compose.yaml" -f "$REPO_DIR/compose.db.yaml" \
       -f "$REPO_DIR/compose.public.yaml" ps --quiet mariadb 2>/dev/null | grep -q .; then
    OVERLAY="$REPO_DIR/compose.public.yaml"
else
    OVERLAY="$REPO_DIR/compose.prod.yaml"
fi
COMPOSE="docker compose -f $REPO_DIR/compose.yaml -f $REPO_DIR/compose.db.yaml -f $OVERLAY"

# shellcheck disable=SC1091
. "$REPO_DIR/.env"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
TARGET="$BACKUP_DIR/stoerungsinfo_$STAMP.sql.gz"

# Datenbankliste: keycloak nur, wenn vorhanden (Konzern-VM nutzt den echten IdP)
DBS="${DB_NAME:-newsletter}"
if $COMPOSE exec -T mariadb sh -c \
    "mariadb -u root -p\"\$MARIADB_ROOT_PASSWORD\" -e 'USE keycloak'" >/dev/null 2>&1; then
    DBS="$DBS keycloak"
fi
echo "Sichere Datenbanken: $DBS"

# --single-transaction: konsistenter InnoDB-Snapshot ohne Tabellen-Locks
$COMPOSE exec -T mariadb sh -c \
    "mariadb-dump --single-transaction --routines --events -u root \
     -p\"\$MARIADB_ROOT_PASSWORD\" --databases $DBS" \
    | gzip > "$TARGET"

# Dumps enthalten personenbezogene Klartextdaten und Passwort-Hashes
chmod 600 "$TARGET"

# Plausibilitätsprüfung: ein leerer oder abgebrochener Dump ist kein Backup
SIZE="$(stat -c %s "$TARGET" 2>/dev/null || echo 0)"
if [ "$SIZE" -lt 4096 ]; then
    echo "FEHLER: Dump ist nur ${SIZE} Bytes groß — Backup verworfen" >&2
    rm -f "$TARGET"
    exit 1
fi
if ! gzip -t "$TARGET" 2>/dev/null; then
    echo "FEHLER: Dump ist nicht lesbar (gzip -t) — Backup verworfen" >&2
    rm -f "$TARGET"
    exit 1
fi

find "$BACKUP_DIR" -name 'stoerungsinfo_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
# Altbestand aus früherer Namensgebung mit aufräumen
find "$BACKUP_DIR" -name 'newsletter_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

echo "Backup OK: $TARGET ($(du -h "$TARGET" | cut -f1))"
echo "HINWEIS: Monatlicher Restore-Test laut RUNBOOK — ein nie restauriertes Backup existiert nicht."
