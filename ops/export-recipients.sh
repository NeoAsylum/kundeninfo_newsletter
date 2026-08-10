#!/bin/sh
# Notfall-Versand-Vorsorge (Plan 9.6): exportiert nächtlich die Empfängerlisten je
# Topic als CSV. Fällt das Portal während einer Großstörung aus, läuft der Versand
# manuell über Outlook/Funktionspostfach mit der letzten Liste.
# Cron-Beispiel:  30 2 * * *  /opt/stoerungsinfo/ops/export-recipients.sh
set -eu

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
EXPORT_BASE="${EXPORT_DIR:-/var/backups/stoerungsinfo/recipients}"
COMPOSE="docker compose -f $REPO_DIR/compose.yaml -f $REPO_DIR/compose.db.yaml -f $REPO_DIR/compose.prod.yaml"

# shellcheck disable=SC1091
. "$REPO_DIR/.env"

STAMP="$(date +%Y-%m-%d)"
EXPORT_DIR_TODAY="$EXPORT_BASE/$STAMP"
mkdir -p "$EXPORT_DIR_TODAY"

run_sql() {
    $COMPOSE exec -T mariadb sh -c \
        "mariadb -N -B -u root -p\"\$MARIADB_ROOT_PASSWORD\" \"${DB_NAME:-newsletter}\" -e \"$1\""
}

TOPICS="$(run_sql 'SELECT id, is_mandatory FROM topics WHERE is_active = 1;')"

echo "$TOPICS" | while read -r topic_id mandatory; do
    [ -n "$topic_id" ] || continue
    # Whitelist gegen SQL-/Shell-Injection: topic_id wird unten in SQL und in einen
    # sh -c-Aufruf interpoliert — nur Slug-Zeichen zulassen (Review-Befund).
    case "$topic_id" in
        *[!a-zA-Z0-9_-]*)
            echo "WARNUNG: Topic-ID '$topic_id' enthält unerlaubte Zeichen — übersprungen" >&2
            continue
            ;;
    esac
    OUT="$EXPORT_DIR_TODAY/$topic_id.csv"
    if [ "$mandatory" = "1" ]; then
        # Pflicht-Topic: alle aktiven User (implizit, ADR-009)
        run_sql 'SELECT email FROM users WHERE is_active = 1 ORDER BY email;' > "$OUT"
    else
        run_sql "SELECT u.email FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE s.topic_id = '$topic_id' AND u.is_active = 1 ORDER BY u.email;" > "$OUT"
    fi
    chmod 600 "$OUT"
    echo "Export: $OUT ($(wc -l < "$OUT") Empfänger)"
done

# Alte Exporte aufräumen (Datenminimierung: 7 Tage genügen für den Notfall)
find "$EXPORT_BASE" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
