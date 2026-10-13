# PostgreSQL mit Init-Skript (App-Rolle ohne Superuser + optional Keycloak-DB).
# Gebacken statt Bind-Mount (R10, OneDrive-Falle) — wie das Keycloak-Image.
# postgres:18-alpine (18.6), per Digest gepinnt wie python, nginx, keycloak, mailpit und
# certbot. Ab 18 liegt das Datenverzeichnis unter /var/lib/postgresql/<major>/docker; das
# Volume gehört nach /var/lib/postgresql (compose.db.yaml). Ein Major-Wechsel braucht
# Dump und Restore (RUNBOOK 2).
FROM docker.io/library/postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
COPY initdb/ /docker-entrypoint-initdb.d/
# Zeilenenden normalisieren: Auf Windows/OneDrive kann das Skript CRLF bekommen,
# der postgres-Entrypoint sourcet .sh-Dateien und stolpert dann.
RUN sed -i 's/\r$//' /docker-entrypoint-initdb.d/*.sh
