#!/bin/sh
# Erst auf die DB warten (reiner Ping), DANN Migrationen genau einmal ausführen:
# Ein echter Migrationsfehler darf nicht als "DB nicht bereit" 10x gegen ein halb
# migriertes Schema wiederholt werden (DDL ist in MariaDB nicht transaktional).
set -e

i=0
until alembic current >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then
        echo "FATAL: Datenbank nach $i Versuchen nicht erreichbar" >&2
        exit 1
    fi
    echo "DB noch nicht bereit (Versuch $i/10), warte 3 s ..."
    sleep 3
done

alembic upgrade head

exec "$@"
