# PostgreSQL mit Init-Skript (App-Rolle ohne Superuser + optional Keycloak-DB).
# Gebacken statt Bind-Mount (R10, OneDrive-Falle) — wie das Keycloak-Image.
FROM postgres:16-alpine
COPY initdb/ /docker-entrypoint-initdb.d/
# Zeilenenden normalisieren: Auf Windows/OneDrive kann das Skript CRLF bekommen,
# der postgres-Entrypoint sourcet .sh-Dateien und stolpert dann.
RUN sed -i 's/\r$//' /docker-entrypoint-initdb.d/*.sh
