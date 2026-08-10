#!/bin/bash
# Aktualisiert die Cloudflare-Bereichsliste für NGINX (echte Client-IP) und die
# Paketfilterregeln. Cloudflare ändert die Bereiche selten, aber nicht nie —
# nach einer Änderung würden Ratenlimits und Logs auf Proxy-Adressen zeigen.
#
#   bash deploy/vm/update-cloudflare-ranges.sh
#
# Danach werden NGINX neu gebaut/gestartet und die Firewallregeln neu gesetzt.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
TARGET="$REPO_DIR/deploy/nginx/includes/cloudflare-real-ip.inc"
cd "$REPO_DIR"

V4="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)"
V6="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)"
[ -n "$V4" ] || { echo "FEHLER: IPv4-Liste leer" >&2; exit 1; }

{
    echo "# Echte Client-IP hinter dem Cloudflare-Proxy ermitteln."
    echo "# Erzeugt von deploy/vm/update-cloudflare-ranges.sh am $(date -Is)"
    echo "# Nur diesen Quellen wird der CF-Connecting-IP-Header geglaubt."
    echo
    echo "$V4" | grep -E '^[0-9.]+/[0-9]+$' | sed 's/^/set_real_ip_from /; s/$/;/'
    echo
    echo "$V6" | grep -E '^[0-9a-fA-F:]+/[0-9]+$' | sed 's/^/set_real_ip_from /; s/$/;/'
    echo
    echo "real_ip_header CF-Connecting-IP;"
    echo "real_ip_recursive on;"
} > "$TARGET.new"

if cmp -s "$TARGET.new" "$TARGET" 2>/dev/null; then
    rm "$TARGET.new"
    echo "Bereiche unverändert — nichts zu tun"
else
    mv "$TARGET.new" "$TARGET"
    echo "Bereichsliste aktualisiert: $TARGET"
    docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml \
        up -d --build nginx
    echo "NGINX neu gestartet"
fi

bash "$REPO_DIR/deploy/vm/firewall.sh" >/dev/null
echo "Firewallregeln aktualisiert"
