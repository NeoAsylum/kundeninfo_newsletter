#!/bin/bash
# Rollt den Störungsinfo-Stack öffentlich erreichbar aus (Pilot/Demo im Internet).
# Voraussetzung: deploy/vm/bootstrap.sh gelaufen, DNS-A-Record zeigt auf diese VM.
#
#   PUBLIC_HOST=example.com ACME_EMAIL=me@example.com \
#   SMTP_HOST=smtp.gmail.com SMTP_USER=… SMTP_PASSWORD=… MAIL_FROM=… \
#       bash deploy/vm/deploy.sh
#
# Idempotent: erneutes Ausführen aktualisiert den Stack, behält Secrets und
# Zertifikate. Secrets werden nur beim ersten Lauf erzeugt und liegen in .env
# (chmod 600) — sie werden nie ausgegeben oder versioniert.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/stoerungsinfo}"
PUBLIC_HOST="${PUBLIC_HOST:?PUBLIC_HOST fehlt (z. B. kunden-stoerungs-info.com)}"
# SMTP-Zugangsdaten beim ERSTEN Lauf erzwingen: SMTP_AUTH_MODE=login ohne
# User/Passwort lässt die App beim Start mit Validierungsfehler abbrechen.
if [ ! -f "${REPO_DIR:-/opt/stoerungsinfo}/.env" ] && [ "${SMTP_AUTH_MODE:-login}" = "login" ]; then
    : "${SMTP_USER:?SMTP_USER fehlt (oder SMTP_AUTH_MODE=none setzen)}"
    : "${SMTP_PASSWORD:?SMTP_PASSWORD fehlt (oder SMTP_AUTH_MODE=none setzen)}"
    : "${MAIL_FROM:?MAIL_FROM fehlt (muss zum SMTP-Konto passen)}"
fi
# Kein Apostroph in der Fehlermeldung: In ${VAR:?text} behandelt Bash ein
# einfaches Anführungszeichen als Quoting-Start und bricht mit Syntaxfehler ab.
ACME_EMAIL="${ACME_EMAIL:?ACME_EMAIL fehlt (Adresse fuer Zertifikats-Ablaufwarnungen)}"
COMPOSE="docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml"

cd "$REPO_DIR"
log() { echo -e "\n=== $* "; }
secret() { openssl rand -base64 36 | tr -d '/+=\n' | head -c 32; }

# --- 1. Konfiguration ---------------------------------------------------------
if [ ! -f .env ]; then
    log "Erstelle .env mit frischen Secrets"
    # Restriktive Rechte VOR dem Schreiben: sonst liegen die Secrets kurzzeitig
    # mit 0644 auf der Platte (Zeitfenster für jeden lokalen Benutzer).
    install -m 600 /dev/null .env
    cat > .env <<EOF
# Öffentlicher Betrieb — erzeugt von deploy/vm/deploy.sh am $(date -Is)
# Diese Datei enthält Geheimnisse: chmod 600, niemals versionieren.
APP_ENV=prod
PUBLIC_HOST=${PUBLIC_HOST}
PUBLIC_BASE_URL=https://${PUBLIC_HOST}
IMAGE_TAG=$(git describe --tags --always 2>/dev/null || echo local)
LOG_LEVEL=INFO

DB_NAME=newsletter
DB_USER=app
DB_PASSWORD=$(secret)
DB_ROOT_PASSWORD=$(secret)
DATABASE_URL=mysql+aiomysql://app:__DB_PASSWORD__@mariadb:3306/newsletter

OIDC_ISSUER_URL=https://${PUBLIC_HOST}/idp/realms/dev
# Nur Origin (Schema://Host:Port) OHNE Pfad: Der Pfad /idp steckt bereits in der
# Issuer-URL und bleibt beim Umschreiben erhalten — sonst /idp/idp/... (404).
OIDC_INTERNAL_BASE_URL=http://keycloak:8081
OIDC_CLIENT_ID=newsletter-dev
OIDC_CLIENT_SECRET=$(secret)
OIDC_EMAIL_CLAIM=email
OIDC_ROLES_CLAIM=realm_access.roles
ADMIN_ROLE_VALUE=stoerungsinfo-admin

KEYCLOAK_ADMIN=kcadmin
KEYCLOAK_ADMIN_PASSWORD=$(secret)

SESSION_SECRET=$(secret)$(secret)
SESSION_MAX_AGE=28800

SMTP_HOST="${SMTP_HOST:-mailpit}"
SMTP_PORT=${SMTP_PORT:-587}
SMTP_SECURITY=${SMTP_SECURITY:-starttls}
SMTP_AUTH_MODE=${SMTP_AUTH_MODE:-login}
SMTP_USER="${SMTP_USER:-}"
# Gequotet: Google zeigt App-Passwörter mit Leerzeichen an — ungequotet würde die
# Datei beim Einlesen als Befehl interpretiert und der Wert abgeschnitten.
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
# Werte mit Leerzeichen MUESSEN gequotet sein: deploy.sh liest die Datei per
# 'source' ein, und Docker Compose entfernt umschliessende Quotes korrekt.
MAIL_FROM="${MAIL_FROM:-}"
MAIL_FROM_NAME="${MAIL_FROM_NAME:-Störungsinfo}"
MAIL_REDIRECT_TO=${MAIL_REDIRECT_TO:-}
# Gmail drosselt bei ~500/Tag — defensive Rate begrenzt den Schaden bei Missbrauch
SMTP_MAX_PER_MINUTE=${SMTP_MAX_PER_MINUTE:-30}
SMTP_BATCH_SIZE=50
SMTP_TIMEOUT_S=30

WORKER_ENABLED=true
WORKER_POLL_INTERVAL_S=5
WORKER_STALE_AFTER_S=600
WORKER_RETRY_BACKOFF_S=60,300,900

RETENTION_DAYS_RECIPIENTS=
RETENTION_DAYS_AUDIT=
AUDIT_SUBSCRIPTIONS=false
EOF
    # DATABASE_URL mit dem erzeugten Passwort füllen
    DB_PW="$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)"
    sed -i "s|__DB_PASSWORD__|${DB_PW}|" .env
    chmod 600 .env
    echo "    .env erstellt (chmod 600). Secrets stehen nur dort."
else
    log ".env existiert — Secrets bleiben unverändert"
    # Mailkonfiguration aktualisieren, falls beim Aufruf übergeben
    for key in SMTP_HOST SMTP_PORT SMTP_SECURITY SMTP_AUTH_MODE SMTP_USER SMTP_PASSWORD \
               MAIL_FROM MAIL_FROM_NAME MAIL_REDIRECT_TO; do
        value="${!key:-__UNSET__}"
        [ "$value" = "__UNSET__" ] && continue
        if grep -q "^${key}=" .env; then
            sed -i "s|^${key}=.*|${key}=\"${value}\"|" .env
        else
            echo "${key}=\"${value}\"" >> .env
        fi
        echo "    ${key} aktualisiert"
    done
fi
set -a; . ./.env; set +a

# --- 2. Keycloak-Datenbank ----------------------------------------------------
log "Stack starten (MariaDB zuerst)"
$COMPOSE up -d --build mariadb
for i in $(seq 1 30); do
    if docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml exec -T \
        mariadb mariadb -u root -p"$DB_ROOT_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; then
        break
    fi
    sleep 3
done
docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml exec -T mariadb \
    mariadb -u root -p"$DB_ROOT_PASSWORD" -e "
        CREATE DATABASE IF NOT EXISTS keycloak
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        GRANT ALL ON keycloak.* TO '${DB_USER}'@'%';
        FLUSH PRIVILEGES;"
echo "    Datenbank 'keycloak' bereit"

log "Sicherung vor dem Ausrollen"
# Migrationen laufen beim Start des api-Containers automatisch. Vorher ein Dump,
# damit ein fehlgeschlagener Schemawechsel nicht ohne Rückfahrkarte dasteht.
if $COMPOSE ps --status running --quiet api 2>/dev/null | grep -q .; then
    if bash "$(dirname "$0")/../../ops/backup.sh"; then
        echo "    Sicherung erstellt"
    else
        echo "    WARNUNG: Sicherung fehlgeschlagen — Ausrollen wird fortgesetzt" >&2
    fi
else
    echo "    Erstinstallation, keine Sicherung nötig"
fi

log "Restliche Container starten"
$COMPOSE up -d --build

log "Aufräumen (Platte)"
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --keep-storage 2GB >/dev/null 2>&1 || true

# --- 3. Zertifikat ------------------------------------------------------------
CERT_PATH="/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem"
if ! docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml run --rm \
        --entrypoint sh certbot -c "[ -f ${CERT_PATH} ]" 2>/dev/null; then
    log "Zertifikat (Let us Encrypt) für ${PUBLIC_HOST} anfordern"
    echo "    Prüfe, ob ${PUBLIC_HOST} auf diese VM zeigt …"
    RESOLVED="$(getent hosts "$PUBLIC_HOST" | awk '{print $1}' | head -1 || true)"
    MY_IP="$(curl -fsS --max-time 10 https://api.ipify.org || echo unbekannt)"
    echo "    DNS: ${RESOLVED:-nicht auflösbar} / VM: ${MY_IP}"
    if [ -z "$RESOLVED" ]; then
        echo "    ABBRUCH: ${PUBLIC_HOST} löst nicht auf — A-Record setzen, dann erneut." >&2
        exit 1
    fi
    docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml run --rm \
        --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
        -d "$PUBLIC_HOST" --email "$ACME_EMAIL" --agree-tos --no-eff-email \
        --non-interactive
    log "NGINX mit TLS neu starten"
    $COMPOSE up -d --force-recreate nginx
else
    log "Zertifikat vorhanden"
fi

# --- 4. Keycloak-Realm für die öffentliche Adresse -------------------------------
log "Warte auf Keycloak"
# Im Compose-Netz prüfen, nicht über localhost:80 — der HTTP-Serverblock leitet
# alles auf HTTPS um, ein 301 wäre kein Beweis für einen bereiten Keycloak.
KC_READY=false
for i in $(seq 1 60); do
    if $COMPOSE exec -T api python -c "
import sys, httpx
try:
    r = httpx.get('http://keycloak:8081/idp/realms/dev/.well-known/openid-configuration',
                  timeout=5)
    sys.exit(0 if r.status_code == 200 else 1)
except Exception:
    sys.exit(1)
" >/dev/null 2>&1; then
        KC_READY=true
        echo "    Keycloak bereit nach $((i * 5))s"
        break
    fi
    sleep 5
done
if [ "$KC_READY" != "true" ]; then
    echo "ABBRUCH: Keycloak wurde nicht bereit — 'docker compose logs keycloak' prüfen." >&2
    exit 1
fi

bash "$(dirname "$0")/configure-realm.sh"

# --- 5. Ergebnis --------------------------------------------------------------
log "Status"
$COMPOSE ps --format 'table {{.Service}}\t{{.Status}}'
echo
free -h | head -2
echo
echo "Portal:  https://${PUBLIC_HOST}/abos.html"
echo "Health:  https://${PUBLIC_HOST}/healthz"
echo
echo "Keycloak-Adminkonsole ist NICHT öffentlich (bewusst)."
echo "Zugriff per Tunnel:  ssh -L 8081:localhost:8081 root@<vm>  →  http://localhost:8081/idp/"
echo "Zugangsdaten stehen in ${REPO_DIR}/.env (KEYCLOAK_ADMIN*)."
