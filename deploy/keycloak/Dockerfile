# Realm-Import ins Image gebacken statt Bind-Mount — der DEV-Stack läuft damit
# ohne Docker-Desktop-File-Sharing (Windows/OneDrive-Falle, Plan-Risiko R10).
FROM quay.io/keycloak/keycloak:26.4@sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007
COPY deploy/keycloak/realm-dev.json /opt/keycloak/data/import/realm-dev.json
