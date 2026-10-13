#!/bin/sh
# Nächtliches Backup der Datenbank im Container-Volume (Plan 9.3) — auch in PROD der
# dauerhafte Sicherungsweg (ADR-0030). Der Dump bleibt auf der VM; eine Kopie
# außerhalb der VM legt dieses Skript nicht an — das leistet die Sicherung der VM
# (RUNBOOK 3).
# Cron-Beispiel (VM, User root):  0 2 * * *  sh /opt/stoerungsinfo/ops/backup.sh
# Unter Podman: Cron-Zeile siehe RUNBOOK 1b — Engine und Compose-Werkzeug voranstellen, im
# Crontab des Kontos, dem die Container gehören.
#
# Sichert BEIDE Datenbanken: 'newsletter' (Abos, Versandhistorie) und 'keycloak'
# (Benutzer, Passwörter, Realm). Ohne die zweite wäre nach einem Restore die
# Anmeldung unmöglich — die Abo-Daten hätten keine zugehörigen Konten mehr.
set -eu

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/stoerungsinfo}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
ENGINE="${CONTAINER_ENGINE:-docker}"

# Overlay automatisch erkennen: öffentlicher Betrieb nutzt compose.public.yaml,
# die Konzern-VM compose.prod.yaml.
if [ -f "$REPO_DIR/compose.public.yaml" ] && \
   "$ENGINE" compose -f "$REPO_DIR/compose.yaml" -f "$REPO_DIR/compose.db.yaml" \
       -f "$REPO_DIR/compose.public.yaml" ps --quiet postgres 2>/dev/null | grep -q .; then
    OVERLAY="$REPO_DIR/compose.public.yaml"
else
    OVERLAY="$REPO_DIR/compose.prod.yaml"
fi
COMPOSE="$ENGINE compose -f $REPO_DIR/compose.yaml -f $REPO_DIR/compose.db.yaml -f $OVERLAY"

# shellcheck disable=SC1091
. "$REPO_DIR/.env"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
TARGET="$BACKUP_DIR/stoerungsinfo_$STAMP.sql.gz"

# Rollen und die leeren Datenbanken legt das Init-Skript des Postgres-Images beim
# ersten Start an (deploy/postgres/initdb/10-init.sh) — der Dump sichert deshalb NUR
# Schema und Daten je Datenbank, keine Rollen und kein CREATE DATABASE. Zwei Vorteile:
# kein Passwort-Material im Dump, und der Restore spielt sauber in die frisch
# angelegten, leeren Datenbanken ein (RUNBOOK 3). Das vorangestellte \connect schaltet
# beim Einspielen jeweils auf die richtige Datenbank.
DBS="${DB_NAME:-newsletter}"
# keycloak nur sichern, wenn die DB existiert (die Konzern-VM nutzt den echten IdP)
# Scheitert schon diese Abfrage, bricht das Skript ab (set -e) — sonst gälte ein Backup
# ohne keycloak als vollständig.
KC_DA="$($COMPOSE exec -T postgres psql -U postgres -tAc \
    "SELECT count(*) FROM pg_database WHERE datname = 'keycloak'")"
if [ "$KC_DA" = "1" ]; then
    DBS="$DBS keycloak"
fi
echo "Sichere Datenbanken: $DBS"
{
    for db in $DBS; do
        printf '\\connect %s\n' "$db"
        $COMPOSE exec -T postgres pg_dump -U postgres "$db"
    done
} | gzip > "$TARGET"

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
# Jeder pg_dump endet mit dieser Zeile. Der Exit-Status der Pipeline oben ist nur der von
# gzip: Bräche der Dump einer Datenbank ab, fehlte sie sonst unbemerkt im Backup.
FERTIG="$(gunzip -c "$TARGET" | grep -cx -- '-- PostgreSQL database dump complete' || true)"
ERWARTET="$(echo "$DBS" | wc -w)"
if [ "$FERTIG" -ne "$ERWARTET" ]; then
    echo "FEHLER: Dump unvollständig ($FERTIG von $ERWARTET Datenbanken) — Backup verworfen" >&2
    rm -f "$TARGET"
    exit 1
fi

find "$BACKUP_DIR" -name 'stoerungsinfo_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
# Altbestand aus früherer Namensgebung mit aufräumen
find "$BACKUP_DIR" -name 'newsletter_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

echo "Backup OK: $TARGET ($(du -h "$TARGET" | cut -f1))"
echo "HINWEIS: Restore regelmäßig proben (RUNBOOK 3) — ein nie restauriertes Backup existiert nicht."
