#!/bin/bash
# Zieht den Datenbankbestand von PostgreSQL 16 (Volume db_data) nach PostgreSQL 18 (Volume
# pg_data) um — einmalig, nach dem Wechsel auf den Stand mit PostgreSQL 18 (RUNBOOK 2).
#
#   bash deploy/vm/pg-umzug.sh                              # öffentlicher Pilot
#   OVERLAY=compose.prod.yaml bash deploy/vm/pg-umzug.sh    # Konzern-VM
#
# Der neue Server liest das Datenverzeichnis des alten nicht. Das Skript sichert den
# Bestand deshalb mit einem von Hand gestarteten PostgreSQL 16, legt mit dem neuen Image
# einen frischen Cluster auf dem neuen Volume an, spielt ein und vergleicht in JEDER
# Datenbank (auch der von Keycloak) je Tabelle die Zeilenzahl und je Sequenz den Stand —
# nicht den Inhalt der Zeilen. Erst wenn alles übereinstimmt,
# schreibt es PG_UMZUG_ERLEDIGT=1 in die .env — vorher starten deploy.sh und demo-mode.sh
# nicht (pg-umzug-sperre.sh). Das alte Volume wird nicht migriert und bleibt als Rückweg
# liegen. Jeder Fehler beendet das Skript; die übrigen Container startet es nie.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
cd "$REPO_DIR"
OVERLAY="${OVERLAY:-compose.public.yaml}"
COMPOSE="docker compose -f compose.yaml -f compose.db.yaml -f $OVERLAY"
PROJEKT="${COMPOSE_PROJECT_NAME:-stoerungsinfo}"
ALT_VOLUME="${PROJEKT}_db_data"
NEU_VOLUME="${PROJEKT}_pg_data"
# Der letzte Stand der 16er-Reihe (16.15); er liest jedes Volume, das ein 16.x angelegt hat.
ALT_IMAGE="docker.io/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
SICHERUNG="${BACKUP_DIR:-/var/backups/stoerungsinfo}"
HELFER="${PROJEKT}-pg16-umzug"
STAMP="$(date +%Y-%m-%d_%H%M)"
DUMP="$SICHERUNG/umzug_pg16_$STAMP.sql.gz"

log() { echo -e "\n=== $* "; }
abbruch() { echo "ABBRUCH: $*" >&2; exit 1; }

# Wartet auf den Server, der über TCP antwortet. Der Hilfsserver, den das Image beim ersten
# Start kurz laufen lässt, ist nur über den Unix-Socket erreichbar und zählt deshalb nicht.
warte() {  # $@ = Aufruf, der im Container pg_isready ausführt
    local i
    for i in $(seq 1 60); do
        if "$@" pg_isready -h 127.0.0.1 -U postgres -q 2>/dev/null; then return 0; fi
        sleep 2
    done
    return 1
}

# Je Tabelle die Zeilenzahl, je Sequenz der Stand — für alle Datenbanken in $DBS.
zaehle() {  # $@ = psql-Aufruf bis vor „-d“; liest SQL von der Standardeingabe
    local db
    for db in $DBS; do
        "$@" -d "$db" -Atc "SELECT format('SELECT %L, count(*) FROM %I.%I;', current_database() || ' ' || schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename" \
            | "$@" -d "$db" -At
        "$@" -d "$db" -Atc "SELECT current_database() || ' Sequenz ' || schemaname || '.' || sequencename, coalesce(last_value::text, '-') FROM pg_sequences ORDER BY 1"
    done
}

# --- 0. Voraussetzungen ---------------------------------------------------------
log "Voraussetzungen prüfen"
docker volume inspect "$ALT_VOLUME" >/dev/null 2>&1 \
    || abbruch "Kein Volume $ALT_VOLUME — es gibt nichts umzuziehen."
grep -qs '^PG_UMZUG_ERLEDIGT=1$' .env \
    && abbruch "Laut .env (PG_UMZUG_ERLEDIGT=1) ist der Umzug schon erledigt."
docker volume inspect "$NEU_VOLUME" >/dev/null 2>&1 \
    && abbruch "Das Volume $NEU_VOLUME gibt es schon. Erst klären, was darin liegt: Ist der Umzug schon einmal durchgelaufen und fehlt nur die Zeile PG_UMZUG_ERLEDIGT=1 in der .env, dann ist es der AKTUELLE Bestand — nichts entfernen, die Zeile wieder eintragen. Nur nach einem abgebrochenen Versuch oder einem Start ohne Umzug entfernen: $COMPOSE rm -sf postgres && docker volume rm $NEU_VOLUME — dann erneut."
# Ohne das Image ließe sich PG_VERSION nicht lesen — das sähe aus wie ein Volume ohne
# Bestand von PostgreSQL 16, und der Weg dafür endet beim Löschen des Volumes.
docker image inspect "$ALT_IMAGE" >/dev/null 2>&1 || docker pull -q "$ALT_IMAGE" >/dev/null \
    || abbruch "Das Image für PostgreSQL 16 ($ALT_IMAGE) ist nicht zu holen — Netz oder Registry prüfen. Geprüft und verändert wurde nichts."
ALT_VERSION="$(docker run --rm -v "$ALT_VOLUME:/alt:ro" --entrypoint cat "$ALT_IMAGE" /alt/PG_VERSION 2>/dev/null || true)"
[ "$ALT_VERSION" = "16" ] \
    || abbruch "$ALT_VOLUME enthält keinen Bestand von PostgreSQL 16 (PG_VERSION: ${ALT_VERSION:-nicht lesbar}). Ein Volume aus der MariaDB-Zeit zieht nicht so um — siehe ADR-0027."
mkdir -p "$SICHERUNG"
chmod 700 "$SICHERUNG"
echo "    $ALT_VOLUME: PostgreSQL $ALT_VERSION"

# --- 1. Alles anhalten ----------------------------------------------------------
log "Stack anhalten — ab hier schreibt niemand mehr"
$COMPOSE stop

# --- 2. Bestand lesen -----------------------------------------------------------
log "Bestand mit PostgreSQL 16 lesen und sichern"
docker rm -f "$HELFER" >/dev/null 2>&1 || true
# „compose stop“ erreicht nur die Dienste des Stacks, keinen von Hand gestarteten Container.
IN_GEBRAUCH="$(docker ps --filter "volume=$ALT_VOLUME" --format '{{.Names}}' | tr '\n' ' ')"
[ -z "${IN_GEBRAUCH// /}" ] \
    || abbruch "Das Volume $ALT_VOLUME ist noch in Gebrauch (Container: $IN_GEBRAUCH). Erst diesen Container anhalten — zwei Server auf einem Datenverzeichnis beschädigen den Bestand."
# Auch nach einem Abbruch: den Helfer sauber beenden und keine Dumps im Klartext liegen lassen.
trap 'docker stop -t 60 "$HELFER" >/dev/null 2>&1 || true; docker rm -f "$HELFER" >/dev/null 2>&1 || true; rm -f "$SICHERUNG"/umzug_roh_*.sql "$SICHERUNG"/umzug_teil_*.sql' EXIT
docker run -d --name "$HELFER" -v "$ALT_VOLUME:/var/lib/postgresql/data" "$ALT_IMAGE" >/dev/null
warte docker exec "$HELFER" || abbruch "Der alte Server startet nicht: $(docker logs "$HELFER" 2>&1 | tail -3)"
ALT="docker exec -i $HELFER"
DBS="$($ALT psql -X -U postgres -Atc "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname DESC" | tr '\n' ' ')"
[ -n "${DBS// /}" ] || abbruch "Keine Datenbank im alten Bestand gefunden."
echo "    Datenbanken: $DBS"
zaehle $ALT psql -X -U postgres > "$SICHERUNG/umzug_zaehlung_alt_$STAMP.txt"
[ -s "$SICHERUNG/umzug_zaehlung_alt_$STAMP.txt" ] || abbruch "Die Zählung des alten Bestands ist leer."

# Je Datenbank ein eigener pg_dump, dessen Ende geprüft wird — scheiterte einer still,
# käme die Datenbank leer im neuen Cluster an (bei Keycloak: alle Konten weg).
: > "$SICHERUNG/umzug_roh_$STAMP.sql"
chmod 600 "$SICHERUNG/umzug_roh_$STAMP.sql"
for db in $DBS; do
    printf '\\connect %s\n' "$db" >> "$SICHERUNG/umzug_roh_$STAMP.sql"
    $ALT pg_dump -U postgres "$db" > "$SICHERUNG/umzug_teil_$STAMP.sql" \
        || abbruch "pg_dump für $db ist gescheitert."
    tail -n 5 "$SICHERUNG/umzug_teil_$STAMP.sql" | grep -qx -- '-- PostgreSQL database dump complete' \
        || abbruch "Der Dump von $db ist unvollständig."
    cat "$SICHERUNG/umzug_teil_$STAMP.sql" >> "$SICHERUNG/umzug_roh_$STAMP.sql"
done
rm -f "$SICHERUNG/umzug_teil_$STAMP.sql"
gzip -c "$SICHERUNG/umzug_roh_$STAMP.sql" > "$DUMP"
chmod 600 "$DUMP"
gzip -t "$DUMP"
rm -f "$SICHERUNG"/umzug_roh_*.sql "$SICHERUNG"/umzug_teil_*.sql
docker stop -t 60 "$HELFER" >/dev/null
docker rm "$HELFER" >/dev/null
trap - EXIT
echo "    Dump: $DUMP ($(du -h "$DUMP" | cut -f1))"

# --- 3. Neuer Server auf dem neuen Volume ---------------------------------------
log "PostgreSQL 18 auf dem neuen Volume starten (nur die Datenbank)"
NEU_WEG="Die übrigen Container wurden nicht gestartet; das alte Volume ist unverändert nutzbar. Vor dem nächsten Versuch das halbfertige neue Volume entfernen: $COMPOSE rm -sf postgres && docker volume rm $NEU_VOLUME"
$COMPOSE up -d --build postgres || abbruch "Der neue Server ließ sich nicht bauen oder starten (Meldung darüber). $NEU_WEG"
NEU="$COMPOSE exec -T postgres"
warte $NEU || abbruch "Der neue Server startet nicht: $($COMPOSE logs postgres 2>&1 | tail -5) $NEU_WEG"
[ "$($NEU psql -X -U postgres -Atc 'SHOW server_version_num' | cut -c1-2)" = "18" ] \
    || abbruch "Der neue Server ist kein PostgreSQL 18 — ist der Code auf dem neuen Stand? $NEU_WEG"
for db in $DBS; do
    $NEU psql -X -U postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 \
        || abbruch "Im neuen Cluster fehlt die Datenbank $db — das Init-Skript legt keycloak nur an, wenn KC_DB_PASSWORD in der .env steht. $NEU_WEG"
done

# --- 4. Einspielen und vergleichen ----------------------------------------------
log "Einspielen"
gunzip -c "$DUMP" | $NEU psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null \
    || abbruch "Das Einspielen ist gescheitert (Fehlermeldung von psql darüber). Fehlt dem neuen Cluster eine Rolle: Er kennt nur die der Anwendung und von Keycloak. $NEU_WEG"
$NEU vacuumdb -U postgres --all --analyze-only >/dev/null 2>&1 \
    || echo "    WARNUNG: ANALYZE im neuen Cluster ist gescheitert — betrifft nur die Statistik, später nachholen." >&2

log "Vergleichen"
zaehle $NEU psql -X -U postgres > "$SICHERUNG/umzug_zaehlung_neu_$STAMP.txt"
if ! diff "$SICHERUNG/umzug_zaehlung_alt_$STAMP.txt" "$SICHERUNG/umzug_zaehlung_neu_$STAMP.txt" >&2; then
    abbruch "Alter und neuer Bestand unterscheiden sich (Zeilen oben). $NEU_WEG"
fi
echo "    $(wc -l < "$SICHERUNG/umzug_zaehlung_neu_$STAMP.txt") Tabellen und Sequenzen in $(echo $DBS | wc -w) Datenbank(en): Zeilenzahlen und Sequenzstände identisch"

# Erst jetzt geben deploy.sh und demo-mode.sh den Start frei.
printf '\n# Bestand nach PostgreSQL 18 umgezogen am %s (deploy/vm/pg-umzug.sh)\nPG_UMZUG_ERLEDIGT=1\n' "$(date -Is)" >> .env

log "Umzug abgeschlossen"
echo "    Die übrigen Container laufen noch nicht. Jetzt den Stack starten:"
echo "      Pilot:      PUBLIC_HOST=… ACME_EMAIL=… bash deploy/vm/deploy.sh"
echo "      Konzern-VM: make prod"
echo "    Rückweg, solange $ALT_VOLUME liegt: RUNBOOK 2. Der Dump enthält die Konten im"
echo "    Klartext — löschen, sobald Sicherungen vom neuen Stand vorliegen."
