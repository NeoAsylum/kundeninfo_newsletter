#!/bin/bash
# Grundausstattung einer frischen Ubuntu-VM für den Störungsinfo-Stack.
# Idempotent — mehrfaches Ausführen ist unschädlich.
#
#   scp deploy/vm/bootstrap.sh root@<host>:/tmp/ && ssh root@<host> bash /tmp/bootstrap.sh
#
# Danach: deploy/vm/deploy.sh (Anwendung ausrollen)
set -euo pipefail

log() { echo -e "\n=== $* "; }

log "System aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

log "Basiswerkzeuge"
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades dnsutils

# --- Swap: 1,8 GB RAM sind für Keycloak + PostgreSQL + API knapp bemessen ------
if ! swapon --show | grep -q '/swapfile'; then
    log "2 GB Swap anlegen"
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # Swap erst nutzen, wenn es wirklich eng wird
    sysctl -qw vm.swappiness=10
    grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
    log "Swap existiert bereits"
fi

# --- Docker aus dem offiziellen Repo ------------------------------------------
if ! command -v docker >/dev/null; then
    log "Docker installieren"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # Ubuntu 26.04 (resolute) ist bei Docker teils noch nicht gelistet -> auf 24.04
    # (noble) zurückfallen, die Pakete sind kompatibel.
    CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    if ! curl -fsI "https://download.docker.com/linux/ubuntu/dists/${CODENAME}/Release" \
        >/dev/null 2>&1; then
        echo "    Hinweis: Docker-Repo hat kein '${CODENAME}' — nutze 'noble'"
        CODENAME=noble
    fi
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
        docker-compose-plugin
    systemctl enable --now docker
else
    log "Docker existiert bereits"
fi

# Docker-Logs begrenzen (sonst füllt die Platte irgendwann)
if [ ! -f /etc/docker/daemon.json ]; then
    log "Docker-Log-Rotation setzen"
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
    systemctl restart docker
fi

# --- Firewall: erst Regeln, dann aktivieren (Reihenfolge ist kritisch) --------
# Nur Host-Ebene. Veröffentlichte Container-Ports gehen per DNAT an ufw vorbei —
# darum kümmert sich firewall.sh mit einer eigenen Kette in DOCKER-USER. Die
# Regeln hier sind deckungsgleich mit dessen ufw-Teil, damit ein erneuter Lauf
# dieses Skripts die Verbindungsbremse für SSH nicht wieder aufhebt.
log "Firewall konfigurieren"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp comment 'SSH (rate limited)' >/dev/null
ufw allow 80/tcp comment 'HTTP (ACME + Redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null
ufw status numbered

# --- SSH härten: nur Schlüssel, kein Passwort --------------------------------
log "SSH härten (nur Key-Login)"
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'CONF'
PasswordAuthentication no
PermitEmptyPasswords no
KbdInteractiveAuthentication no
X11Forwarding no
CONF
sshd -t && systemctl reload ssh

log "Automatische Sicherheitsupdates"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true

log "Fertig"
echo "  Docker:  $(docker --version)"
echo "  Compose: $(docker compose version --short 2>/dev/null || echo '?')"
echo "  Swap:    $(free -h | awk '/Swap/ {print $2}')"
echo "  Firewall: $(ufw status | head -1)"
