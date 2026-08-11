#!/bin/bash
# Härtet die Paketfilter der VM. Idempotent — beliebig oft ausführbar.
#
#   bash deploy/vm/firewall.sh                 # Regeln setzen
#   bash deploy/vm/firewall.sh --status        # nur anzeigen
#   CF_ONLY=false bash deploy/vm/firewall.sh   # Cloudflare-Beschränkung aufheben
#
# WARUM eine eigene iptables-Kette und nicht nur ufw:
# Docker veröffentlicht Ports über eigene DNAT-Regeln, die die ufw-INPUT-Kette
# umgehen. Ein `ufw deny 443` bleibt bei veröffentlichten Container-Ports also
# wirkungslos. Wirksam ist nur die Kette DOCKER-USER, die Docker vor seinen
# eigenen FORWARD-Regeln auswertet und selbst nie überschreibt.
#
# WAS die Regeln bewirken:
#  * 443 nur von Cloudflare-Netzen (CF_ONLY=true): Ohne das kann jeder die
#    Server-IP direkt ansprechen und damit Cloudflares Schutz, WAF und
#    Ratenlimits vollständig umgehen.
#  * Port 80 bleibt bewusst offen: Dort liegen nur die ACME-Prüfung und die
#    Weiterleitung auf HTTPS — kein Inhalt, keine Anmeldung. Beschränkt man ihn
#    mit, schlägt die Zertifikatserneuerung fehl, sobald Cloudflare auf
#    "DNS only" steht (die Prüfung käme dann direkt von Let's Encrypt).
#    Mit CF_ONLY_HTTP=true lässt sich auch Port 80 beschränken.
#  * SSH mit Verbindungsbremse gegen Brute-Force (zusätzlich zu fail2ban).
#  * Persistenz über eine systemd-Unit, weil iptables-Regeln einen Neustart
#    nicht überleben und Docker seine Ketten beim Start neu aufbaut.
set -euo pipefail

CF_ONLY="${CF_ONLY:-true}"
CF_ONLY_HTTP="${CF_ONLY_HTTP:-false}"
CHAIN="STOERUNGSINFO"
CF_V4_URL="https://www.cloudflare.com/ips-v4"
CF_V6_URL="https://www.cloudflare.com/ips-v6"
CACHE_DIR="/etc/stoerungsinfo"
REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"

if [ "${1:-}" = "--status" ]; then
    echo "=== ufw"
    ufw status verbose
    echo
    echo "=== $CHAIN (IPv4)"
    iptables -L "$CHAIN" -n --line-numbers 2>/dev/null || echo "(nicht vorhanden)"
    echo
    echo "=== DOCKER-USER (IPv4)"
    iptables -L DOCKER-USER -n --line-numbers 2>/dev/null || echo "(nicht vorhanden)"
    exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "Als root ausführen" >&2; exit 1; }
mkdir -p "$CACHE_DIR"

log() { echo -e "\n=== $* "; }

# --- Cloudflare-Bereiche beschaffen (mit Zwischenspeicher als Rückfalloption) ---
fetch_ranges() {
    url="$1"; cache="$2"
    if curl -fsS --max-time 20 "$url" -o "${cache}.new" 2>/dev/null && \
       [ -s "${cache}.new" ]; then
        mv "${cache}.new" "$cache"
    elif [ -s "$cache" ]; then
        echo "    WARNUNG: $url nicht erreichbar — nutze zwischengespeicherte Liste" >&2
        rm -f "${cache}.new"
    else
        echo "FEHLER: $url nicht erreichbar und kein Zwischenspeicher vorhanden." >&2
        echo "        Ohne Bereichsliste würde die Regel den Zugang komplett sperren." >&2
        exit 1
    fi
    grep -E '^[0-9a-fA-F:.]+/[0-9]+$' "$cache"
}

# --- ufw: Grundregeln (wirkt für Host-Dienste wie SSH) ------------------------
log "ufw-Grundregeln"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
# 'limit' bremst Verbindungsversuche pro IP (6 in 30 s) — Brute-Force-Schutz
ufw limit 22/tcp comment 'SSH (rate limited)' >/dev/null
ufw allow 80/tcp comment 'HTTP (ACME + Redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null
echo "    SSH mit Verbindungsbremse, 80/443 offen (Feinsteuerung folgt in $CHAIN)"

# --- IPv6 zusätzlich in INPUT sperren ----------------------------------------
# Zweiter Riegel zum 0.0.0.0-Binding in compose.public.yaml: Sollte ein Container
# doch einmal auf [::] gebunden werden, bedient der userland docker-proxy diese
# Verbindungen über INPUT — die Kette $CHAIN in DOCKER-USER (FORWARD) sieht sie nie.
# Ohne diese Regeln stünde der Origin über IPv6 offen im Netz, während die
# IPv4-Prüfung Erfolg meldet. Die ip6tables-Kette unten bleibt als Absicherung für
# den Fall, dass Docker später doch über DNAT zustellt (userland-proxy=false).
log "IPv6 in INPUT sperren"
# Bewusst NICHT über ufw: `ufw deny 443/tcp` unterscheidet nicht zwischen den
# Adressfamilien und würde die bestehende ALLOW-Regel für IPv4 gleich mit ersetzen —
# das nähme im Zweifel die Seite vom Netz. ip6tables trifft nur IPv6.
for regel in \
    "INPUT -p tcp -m tcp --dport 443 -j DROP" \
    "INPUT -p tcp -m tcp --dport 80 -j DROP"; do
    # shellcheck disable=SC2086
    ip6tables -C $regel 2>/dev/null || ip6tables -I $regel
done
echo "    IPv6 auf 80/443 verworfen (Zugriff läuft über Cloudflare per IPv4)"

# --- Eigene Kette für die Cloudflare-Beschränkung ----------------------------
setup_chain() {
    ipt="$1"; url="$2"; cache="$3"
    $ipt -N "$CHAIN" 2>/dev/null || true
    $ipt -F "$CHAIN"

    # Bestehende Verbindungen nie unterbrechen
    $ipt -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN

    if [ "$CF_ONLY" = "true" ]; then
        if [ "$CF_ONLY_HTTP" = "true" ]; then
            PORTS="80,443"
        else
            PORTS="443"
        fi
        count=0
        for net in $(fetch_ranges "$url" "$cache"); do
            $ipt -A "$CHAIN" -s "$net" -p tcp -m multiport --dports "$PORTS" -j RETURN
            count=$((count + 1))
        done
        # Alles andere auf den geschützten Ports verwerfen (DROP, nicht REJECT:
        # Scanner bekommen keine Rückmeldung, dass hier überhaupt etwas lauscht)
        $ipt -A "$CHAIN" -p tcp -m multiport --dports "$PORTS" -j DROP
        echo "    ${ipt}: Port(s) ${PORTS} nur von $count Cloudflare-Bereichen"
    else
        echo "    ${ipt}: Cloudflare-Beschränkung deaktiviert (CF_ONLY=false)"
    fi

    # Kette genau einmal in DOCKER-USER einhängen
    $ipt -D DOCKER-USER -j "$CHAIN" 2>/dev/null || true
    $ipt -I DOCKER-USER 1 -j "$CHAIN"
}

log "Cloudflare-Beschränkung (IPv4)"
setup_chain iptables "$CF_V4_URL" "$CACHE_DIR/cloudflare-v4.txt"

if ip -6 addr show scope global 2>/dev/null | grep -q inet6; then
    log "Cloudflare-Beschränkung (IPv6)"
    setup_chain ip6tables "$CF_V6_URL" "$CACHE_DIR/cloudflare-v6.txt"
fi

# --- Persistenz: Regeln nach jedem Neustart wiederherstellen ------------------
log "systemd-Unit für Persistenz"
cat > /etc/systemd/system/stoerungsinfo-firewall.service <<UNIT
[Unit]
Description=Paketfilter-Regeln für das Störungsinfo-Portal (Cloudflare-Beschränkung)
# Nach Docker starten: Docker baut seine Ketten beim Start neu auf.
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash ${REPO_DIR}/deploy/vm/firewall.sh
# Ohne Netz greift die zwischengespeicherte Bereichsliste
Environment=CF_ONLY=${CF_ONLY}
Environment=CF_ONLY_HTTP=${CF_ONLY_HTTP}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable stoerungsinfo-firewall.service >/dev/null 2>&1
echo "    stoerungsinfo-firewall.service aktiviert (läuft nach docker.service)"

log "Ergebnis"
iptables -L "$CHAIN" -n | head -4
echo "    …"
echo
log "Selbstprüfung (soweit von hier möglich)"
# WICHTIG: Die IPv4-Beschränkung ist von der VM aus NICHT messbar. Eine Anfrage an
# die eigene öffentliche Adresse stellt der Kernel lokal zu; sie durchläuft weder
# FORWARD noch $CHAIN und antwortet deshalb immer. Ein Test von hier würde also
# entweder falschen Alarm schlagen oder falsche Sicherheit geben — beides ist
# schlimmer als keine Prüfung. Für IPv6 gilt das nicht: Dort existiert nach der
# Umstellung auf 0.0.0.0-Bindings gar kein Listener mehr, ein lokaler Versuch
# scheitert also aus demselben Grund wie ein entfernter.
V6="$(ip -6 addr show scope global 2>/dev/null \
      | sed -n 's|.*inet6 \([0-9a-f:]*\)/.*|\1|p' | head -1)"
if [ -n "$V6" ]; then
    if curl -6 -sk --max-time 8 -o /dev/null "https://[$V6]/healthz" 2>/dev/null; then
        echo "    FEHLER: Der Origin antwortet über IPv6 ($V6) direkt." >&2
        echo "    Cloudflare ist damit umgehbar. Prüfen: bindet Docker auf [::]?" >&2
        echo "      ss -tlnp | grep :443     (darf nur 0.0.0.0 zeigen)" >&2
        exit 1
    fi
    echo "    IPv6 ($V6): kein direkter Zugriff — richtig"
else
    echo "    IPv6: keine globale Adresse, nichts zu sperren"
fi

echo
echo "Von AUSSEN prüfen (nicht von dieser VM aus, siehe oben):"
echo "  curl -4 -sk --max-time 8 https://$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null)/healthz"
echo "      → muss ins Timeout laufen"
if [ -n "$V6" ]; then
    echo "  curl -6 -sk --max-time 8 https://[$V6]/healthz"
    echo "      → muss ins Timeout laufen oder die Verbindung verweigern"
fi
echo "Noch prüfen: curl -s https://<domain>/healthz   (muss 200 liefern)"
echo "             ssh root@<vm> 'echo ok'            (muss weiter gehen)"
