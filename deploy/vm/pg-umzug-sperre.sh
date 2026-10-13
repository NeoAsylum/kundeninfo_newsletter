#!/bin/bash
# Sperre gegen einen Start mit leerer Datenbank. Eingebunden (source) von deploy.sh und
# demo-mode.sh, bevor sie irgendetwas ändern oder starten; erwartet das Repo-Verzeichnis als
# Arbeitsverzeichnis.
#
# Seit PostgreSQL 18 liegt der Bestand in einem neuen Volume (pg_data). Solange das alte
# Volume (db_data) noch da ist, kann der neue Server dessen Daten nicht lesen: Er legte beim
# ersten Start einen leeren Cluster an, und das Portal liefe ohne Konten und Historie weiter
# — bei offener Registrierung. Ob das neue Volume schon existiert, sagt darüber nichts (jedes
# „compose up“ legt es leer an). Maßgeblich ist deshalb die Zeile PG_UMZUG_ERLEDIGT=1 in der
# .env: Sie entsteht am Ende des Umzugs (RUNBOOK 2), nachdem alter und neuer Bestand
# verglichen sind. Ohne altes Volume — frische VM, oder der Rückweg wurde aufgegeben — greift
# die Sperre nicht.
pg_umzug_sperre() {
    if docker volume inspect stoerungsinfo_db_data >/dev/null 2>&1 \
        && ! grep -qs '^PG_UMZUG_ERLEDIGT=1$' .env; then
        echo "ABBRUCH: Das Volume stoerungsinfo_db_data hält einen älteren Datenbankbestand," >&2
        echo "der noch nicht nach PostgreSQL 18 umgezogen ist. Ein Start jetzt liefe mit" >&2
        echo "leerer Datenbank. Erst umziehen: bash deploy/vm/pg-umzug.sh — Ablauf und" >&2
        echo "Rückweg: docs/RUNBOOK.md im Repository, Abschnitt 2." >&2
        return 1
    fi
}
