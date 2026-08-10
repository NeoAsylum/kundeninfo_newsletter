#!/bin/sh
# Migrationen vor dem App-Start; wartet auf die DB (max. 10 Versuche à 3 s).
set -e

i=0
until alembic upgrade head; do
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then
        echo "FATAL: Datenbank nach $i Versuchen nicht erreichbar" >&2
        exit 1
    fi
    echo "DB noch nicht bereit (Versuch $i/10), warte 3 s ..."
    sleep 3
done

exec "$@"
