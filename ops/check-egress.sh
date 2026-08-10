#!/bin/sh
# Vorab-Test der Firewall-Freischaltungen laut Egress-Matrix (Plan 10.3):
# prüft TCP-Erreichbarkeit von DB, SMTP-Relay und IdP aus Sicht der VM,
# BEVOR ein Deployment daran scheitert. Aufruf: ops/check-egress.sh
set -u

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck disable=SC1091
. "$REPO_DIR/.env"

FAILED=0

check_tcp() {
    host="$1"; port="$2"; label="$3"
    if timeout 5 sh -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then
        echo "[OK  ] $label — $host:$port erreichbar"
    else
        echo "[FAIL] $label — $host:$port NICHT erreichbar (Firewall-Antrag? NO_PROXY?)"
        FAILED=1
    fi
}

# DB (nur relevant, wenn DATABASE_URL auf einen externen Host zeigt)
DB_HOST="$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')"
DB_PORT="$(echo "$DATABASE_URL" | sed -nE 's|.*@[^:/]+:([0-9]+).*|\1|p')"
case "$DB_HOST" in
    mariadb|localhost|127.0.0.1) echo "[SKIP] DB — lokaler Container ($DB_HOST)" ;;
    *) check_tcp "$DB_HOST" "${DB_PORT:-3306}" "DB-Infra (Plan 10.3 Zeile 1)" ;;
esac

# SMTP-Relay
case "$SMTP_HOST" in
    mailpit) echo "[SKIP] SMTP — Mailpit-Mock" ;;
    *) check_tcp "$SMTP_HOST" "$SMTP_PORT" "Exchange-Relay (Plan 10.3 Zeile 2)" ;;
esac

# IdP (Discovery über HTTPS; hier nur TCP 443 — TLS/Proxy prüft der App-Start)
IDP_HOST="$(echo "$OIDC_ISSUER_URL" | sed -E 's|https?://([^:/]+).*|\1|')"
case "$IDP_HOST" in
    localhost|127.0.0.1) echo "[SKIP] IdP — Keycloak-Mock" ;;
    *) check_tcp "$IDP_HOST" 443 "Konzern-IdP (Plan 10.3 Zeile 3)" ;;
esac

[ "$FAILED" = "0" ] && echo "Egress-Check bestanden." || echo "Egress-Check MIT FEHLERN."
exit "$FAILED"
