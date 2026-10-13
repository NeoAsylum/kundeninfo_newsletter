#!/bin/bash
# Schaltet den öffentlichen Stack für Demos an und danach wieder ab.
#
#   bash deploy/vm/demo-mode.sh start    # vor der Demo
#   bash deploy/vm/demo-mode.sh stop     # danach
#   bash deploy/vm/demo-mode.sh status
#
# Ein gestoppter Stack ist die wirksamste Absicherung: Port 443 nimmt nichts an,
# es gibt keine Anmeldung, keine Registrierung und keinen Mailversand. Daten
# (Abos, Historie, Konten) bleiben in den Volumes erhalten.
#
# Beim Start prüft das Skript, ob das Zertifikat noch gültig ist, und erneuert es
# bei Bedarf — sonst läuft es bei längeren Pausen unbemerkt ab, weil der
# Cron-Job nur bei laufendem Stack etwas ausrichten kann.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
cd "$REPO_DIR"
COMPOSE="docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml"
ACTION="${1:-status}"

set -a; . ./.env; set +a

case "$ACTION" in
    start)
        # shellcheck source=deploy/vm/pg-umzug-sperre.sh
        . "$REPO_DIR/deploy/vm/pg-umzug-sperre.sh"
        pg_umzug_sperre || exit 1
        echo "=== Stack starten"
        $COMPOSE up -d --wait 2>&1 | tail -3 || true

        echo
        echo "=== Zertifikat prüfen"
        DAYS_LEFT="$($COMPOSE --profile certbot run --rm --entrypoint sh certbot -c \
            "openssl x509 -in /etc/letsencrypt/live/${PUBLIC_HOST}/cert.pem -noout -enddate \
             2>/dev/null | cut -d= -f2" 2>/dev/null | head -1 || true)"
        if [ -n "$DAYS_LEFT" ]; then
            EXPIRY_EPOCH="$(date -d "$DAYS_LEFT" +%s 2>/dev/null || echo 0)"
            NOW_EPOCH="$(date +%s)"
            REMAINING=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
            echo "    Restlaufzeit: ${REMAINING} Tage (bis ${DAYS_LEFT})"
            if [ "$REMAINING" -lt 30 ]; then
                echo "    Unter 30 Tagen — Erneuerung starten"
                bash "$REPO_DIR/deploy/vm/renew-cert.sh" || \
                    echo "    WARNUNG: Erneuerung fehlgeschlagen, Log prüfen" >&2
            fi
        else
            echo "    WARNUNG: Zertifikat nicht lesbar" >&2
        fi

        echo
        echo "=== Erreichbarkeit"
        for i in $(seq 1 24); do
            if curl -fsS --max-time 6 "https://${PUBLIC_HOST}/healthz" >/dev/null 2>&1; then
                echo "    https://${PUBLIC_HOST} antwortet (nach $((i * 5))s)"
                break
            fi
            sleep 5
        done
        curl -fsS --max-time 10 "https://${PUBLIC_HOST}/readyz" || \
            echo "    WARNUNG: /readyz antwortet nicht — 'demo-mode.sh status' prüfen" >&2
        echo
        echo "Portal: https://${PUBLIC_HOST}/abos.html"
        ;;

    stop)
        echo "=== Stack stoppen (Daten bleiben erhalten)"
        # Vor dem Abschalten sichern: Der Backup-Cron kann bei gestopptem Stack
        # nichts tun, sonst fehlt bei einer längeren Pause jede Sicherung.
        if $COMPOSE ps --status running --quiet postgres 2>/dev/null | grep -q .; then
            bash "$REPO_DIR/ops/backup.sh" 2>&1 | tail -2 || \
                echo "    WARNUNG: Sicherung fehlgeschlagen" >&2
        fi
        $COMPOSE stop 2>&1 | tail -3 || true
        echo
        echo "Der Stack ist aus: keine Anmeldung, keine Registrierung, kein Mailversand."
        echo "Wieder an mit: bash deploy/vm/demo-mode.sh start"
        ;;

    status)
        $COMPOSE ps --format 'table {{.Service}}\t{{.Status}}'
        echo
        if curl -fsS --max-time 8 "https://${PUBLIC_HOST}/healthz" >/dev/null 2>&1; then
            echo "Öffentlich erreichbar: JA  (https://${PUBLIC_HOST})"
        else
            echo "Öffentlich erreichbar: nein"
        fi
        echo
        echo "Letzte Sicherungen:"
        ls -1t /var/backups/stoerungsinfo/*.sql.gz 2>/dev/null | head -3 || echo "  (keine)"
        ;;

    *)
        echo "Aufruf: demo-mode.sh {start|stop|status}" >&2
        exit 1
        ;;
esac
