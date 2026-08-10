#!/bin/bash
# Erneuert das TLS-Zertifikat und lädt NGINX neu.
#
# Als Cron-Job einrichten (zweimal täglich ist die Empfehlung von Let us Encrypt,
# certbot erneuert nur, wenn weniger als 30 Tage Restlaufzeit bleiben):
#
#   (crontab -l 2>/dev/null; echo '17 3,15 * * * /opt/stoerungsinfo/deploy/vm/renew-cert.sh \
#       >> /var/log/stoerungsinfo-cert.log 2>&1') | crontab -
#
# Warum nicht im Container-Dauerbetrieb: Ein erneuertes Zertifikat wird von NGINX
# erst nach einem Reload verwendet. Der certbot-Container kann NGINX nicht neu
# laden (kein Zugriff auf den Docker-Socket, und das wäre sicherheitstechnisch
# unerwünscht). Deshalb steuert dieses Skript beides von der VM aus.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
cd "$REPO_DIR"
COMPOSE="docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml"

echo "[$(date -Is)] Zertifikatserneuerung prüfen"

# --dry-run-fähig: RENEW_ARGS="--dry-run" ./renew-cert.sh
BEFORE="$($COMPOSE --profile certbot run --rm --entrypoint sh certbot -c \
    'cat /etc/letsencrypt/live/*/cert.pem 2>/dev/null | md5sum' 2>/dev/null || echo none)"

$COMPOSE --profile certbot run --rm --entrypoint certbot certbot renew \
    --webroot -w /var/www/certbot --quiet ${RENEW_ARGS:-}

AFTER="$($COMPOSE --profile certbot run --rm --entrypoint sh certbot -c \
    'cat /etc/letsencrypt/live/*/cert.pem 2>/dev/null | md5sum' 2>/dev/null || echo none)"

if [ "$BEFORE" != "$AFTER" ]; then
    echo "[$(date -Is)] Zertifikat wurde erneuert — NGINX neu laden"
    $COMPOSE exec -T nginx nginx -s reload
    echo "[$(date -Is)] NGINX neu geladen"
else
    echo "[$(date -Is)] Keine Erneuerung nötig"
fi
