# Build-Kontext ist das Repo-Root (siehe compose.yaml).
# nginx:stable-alpine, per Digest gepinnt (Plan 9.7); Aktualisierung: RUNBOOK "Image-Rebuild"
FROM nginx:stable-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46

RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/includes/ /etc/nginx/includes/
# DEV-Serverblock als Default; PROD mountet app.prod.conf darüber (compose.prod.yaml)
COPY deploy/nginx/conf.d/app.dev.conf /etc/nginx/conf.d/default.conf
COPY frontend/public/ /usr/share/nginx/html/
