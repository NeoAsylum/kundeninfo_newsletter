#!/bin/sh
# Aktiviert den TLS-Serverblock nur, wenn ein Zertifikat vorliegt.
#
# Grund: Beim ersten Start existiert noch kein Let's-Encrypt-Zertifikat — NGINX
# würde mit "cannot load certificate" abbrechen und damit auch die
# ACME-Challenge blockieren, die das Zertifikat erst beschafft (Henne-Ei).
# Also: zuerst nur HTTP, nach der Ausstellung Container neu starten.
set -e

CERT="/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem"

if [ -f "$CERT" ]; then
    echo "40-tls-switch: Zertifikat für ${PUBLIC_HOST} gefunden — HTTPS aktiv"
    envsubst '${PUBLIC_HOST}' \
        < /etc/nginx/tls-template/app.public-tls.conf.template \
        > /etc/nginx/conf.d/tls.conf
else
    echo "40-tls-switch: noch kein Zertifikat für ${PUBLIC_HOST} — nur HTTP (ACME)."
    echo "40-tls-switch: nach 'certbot certonly' den Container neu starten."
fi
