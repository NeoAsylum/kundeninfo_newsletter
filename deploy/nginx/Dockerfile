# Build-Kontext ist das Repo-Root (siehe compose.yaml).
# nginx:stable-alpine, per Digest gepinnt (Plan 9.7)
FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94

RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/includes/ /etc/nginx/includes/
# DEV-Serverblock als Default; PROD mountet app.prod.conf.template als Template darüber
# (compose.prod.yaml)
COPY deploy/nginx/conf.d/app.dev.conf /etc/nginx/conf.d/default.conf
COPY frontend/public/ /usr/share/nginx/html/
