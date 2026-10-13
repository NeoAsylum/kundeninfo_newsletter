# Realm-Import ins Image gebacken statt Bind-Mount — der DEV-Stack läuft damit
# ohne Docker-Desktop-File-Sharing (Windows/OneDrive-Falle, Plan-Risiko R10).
FROM quay.io/keycloak/keycloak:26.8.0@sha256:27b3230fbabb8c9ff3c66c864cf09dcd8a41aca82e5100679d109ef0eeb05741
COPY deploy/keycloak/realm-dev.json /opt/keycloak/data/import/realm-dev.json
