#!/bin/sh
# Läuft einmalig beim ersten Init des Postgres-Containers (docker-entrypoint-initdb.d).
# POSTGRES_USER (Superuser) und POSTGRES_DB sind zu diesem Zeitpunkt bereits angelegt.
#
# Trennt die Rechte wie gefordert: eine App-Rolle, die IHRE Datenbank besitzt, aber
# KEIN Cluster-Superuser ist, und — nur wo Keycloak an Postgres hängt — eine getrennte
# keycloak-Rolle samt eigener DB, auf die die App keinen Zugriff hat.
set -e

# App-Rolle: Eigentümerin der Anwendungs-DB (darf Schema anlegen, für die Migrationen),
# aber kein Superuser.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
  CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD '$APP_DB_PASSWORD';
  ALTER DATABASE "$POSTGRES_DB" OWNER TO "$APP_DB_USER";
  GRANT ALL PRIVILEGES ON DATABASE "$POSTGRES_DB" TO "$APP_DB_USER";
SQL

# Eigene DB + Rolle für Keycloak — nur im Stack, der Keycloak an Postgres bindet
# (KC_DB_PASSWORD gesetzt; im DEV nutzt Keycloak H2, dann übersprungen). Eine Lücke im
# api-Container soll nicht bis an Keycloaks Passwort-Hashes reichen.
if [ -n "${KC_DB_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
    CREATE ROLE keycloak LOGIN PASSWORD '$KC_DB_PASSWORD';
    CREATE DATABASE keycloak OWNER keycloak;
    REVOKE ALL ON DATABASE keycloak FROM "$APP_DB_USER";
    REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
SQL
fi
