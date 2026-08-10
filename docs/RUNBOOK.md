# RUNBOOK — Betriebs- und Notfallhandbuch „Störungsinfos“

Dieses Dokument richtet sich an Entwickler und Systemadministratoren zur Durchführung von Deploys, Updates, Backups, Notfall-Maßnahmen und Wartungsarbeiten.

---

## 1. Schnellstart & Deployment (PROD Phase 1: Lokale Docker-DB)

### Erst-Deployment auf der VM

1. **Repository klonen**:
   ```bash
   git clone <REPO_URL> /opt/stoerungsinfo
   cd /opt/stoerungsinfo
   ```
2. **Konfiguration erstellen**:
   ```bash
   cp .env.example .env
   chmod 600 .env
   # .env mit korrekten Werten für PROD anpassen
   ```
3. **PROD-Stack starten**:
   ```bash
   make prod-localdb
   ```
4. **Smoke-Test durchführen**:
   ```bash
   make smoke BASE_URL=https://stoerungsinfo.konzern.example
   ```

---

## 2. Migration zur externen Datenbank (Phase 2 Cutover)

Sobald die zentrale Datenbank-Infrastruktur freigeschaltet ist:

1. **Versand pausieren / Wartungsfenster ankündigen**.
2. **Finalen mysqldump ziehen**:
   ```bash
   ./ops/backup.sh
   ```
3. **Dump auf externer DB einspielen** (durch DB-Betrieb).
4. **`.env` anpassen**:
   `DATABASE_URL` auf externen Host umstellen.
5. **Stack ohne DB-Overlay neu starten**:
   ```bash
   make prod
   ```
6. **Egress-Verbindung & Readyz prüfen**:
   ```bash
   ./ops/check-egress.sh
   curl -fsS https://localhost/readyz
   ```

---

## 3. Backup & Restore (Lokale DB-Phase)

* **Automatisches Backup**: Cron-Job läuft täglich um 02:00 Uhr via `ops/backup.sh`. Dumps werden unter `/var/backups/stoerungsinfo/` mit Dateirechten `600` abgelegt.
* **Restore-Prozedur**:
  ```bash
  gunzip -c /var/backups/stoerungsinfo/dump_YYYYMMDD.sql.gz | \
    docker compose exec -T mariadb mariadb -u app -p<PASSWORD> newsletter
  ```

---

## 3b. Versand über ein echtes Postfach (Abnahme/Demo)

Drei **unabhängige** Schalter in der `.env` — nicht verwechseln:

| Schalter | Bedeutung |
|---|---|
| `MAIL_FROM` / `MAIL_FROM_NAME` | **Absender** der Mails (`From:`-Header) |
| `SMTP_*` | **Wer transportiert** — Mailpit (sammelt, stellt nicht zu) oder ein echter Server |
| `MAIL_REDIRECT_TO` | **Umleitung aller Mails** an eine Adresse statt an die Abonnenten (Default: aus) |

### Absender setzen

Reine Konfiguration, sofort wirksam nach Neustart:

```dotenv
MAIL_FROM=<absender@example.de>
MAIL_FROM_NAME=Störungsinfo (Test)
```

Solange über Mailpit versendet wird, ist jede Absenderadresse erlaubt — Mailpit prüft
nichts. Ein echter Server akzeptiert dagegen nur Absender, die zum authentifizierten
Konto passen (Microsoft antwortet sonst mit `5.7.x`).

### Wirklich zustellen (echter SMTP-Server)

```dotenv
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_AUTH_MODE=login
SMTP_USER=<konto>
SMTP_PASSWORD=<passwort/app-passwort/api-key>
MAIL_FROM=<absender>                # muss zum authentifizierten Konto passen
```

> **Private Outlook.com-Postfächer funktionieren gar nicht** (am 2026-08-10 verifiziert):
> `smtp-mail.outlook.com:587` mit App-Passwort antwortet
> `535 5.7.139 Authentication unsuccessful, basic authentication is disabled`. Microsoft
> hat Basic Auth für SMTP AUTH abgeschaltet, und bei Consumer-Postfächern ist SMTP-
> Clientauthentifizierung **mailbox-seitig deaktiviert** — für Endnutzer nicht
> aktivierbar (die PowerShell-Schalter existieren nur für Microsoft 365 mit
> Admin-Zugriff). Auch der OAuth2-Modus scheitert dort deshalb mit demselben Fehler.
> `SMTP_AUTH_MODE=oauth2` bleibt nutzbar für **Exchange Online mit Tenant** (relevant
> für den Konzern-Relay, Frage B2) — siehe eigenen Abschnitt unten.

### Empfohlen für Tests: Gmail mit App-Passwort

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_AUTH_MODE=login
SMTP_USER=<konto@gmail.com>
SMTP_PASSWORD=<App-Passwort, 16 Zeichen OHNE Leerzeichen>
MAIL_FROM=<konto@gmail.com>          # muss zu SMTP_USER passen
```

App-Passwort: Zwei-Faktor-Authentifizierung aktivieren, dann
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Google
zeigt es mit Leerzeichen an — beim Eintragen weglassen. Einzeln widerrufbar.

Vor dem ersten Versand prüfen (Verbindung + Auth, **ohne** Mail zu senden):

```bash
python backend/scripts/check_smtp.py
python backend/scripts/check_smtp.py --send-to <eigene@adresse>   # mit einer Testmail
```

Soll im `From` eine andere Adresse stehen als das Gmail-Konto, muss sie in Gmail unter
*Einstellungen → Konten → „Weitere E-Mail-Adresse hinzufügen“* verifiziert werden;
andernfalls ersetzt Google den Absender.

### Fallen im Testbetrieb mit echtem Versand

* **Demo-Adressen erzeugen Bounces.** Die Keycloak-Testuser (`*@example.corp`)
  existieren nicht. Für jeden aktiven Empfänger mit solcher Adresse kommt ein
  Unzustellbarkeitsbericht ins Absenderpostfach. Zustand prüfen und aufräumen:

  ```sql
  SELECT email, is_active FROM users ORDER BY is_active DESC;
  DELETE s FROM subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.email LIKE '%@example.corp';
  UPDATE users SET is_active = 0 WHERE email LIKE '%@example.corp';
  ```

* **Login reaktiviert Testuser.** Meldet sich jemand per SSO an, wird sein Datensatz
  per JIT wieder aktiv (ADR-0010) — eine Anmeldung als `admin1` macht
  `admin1@example.corp` also erneut zum Empfänger von Pflicht-Verteilern. Nach
  Anmeldungen erneut aufräumen, oder dauerhaft absichern mit
  `MAIL_REDIRECT_TO=<eigene@adresse>`: dann gehen alle Mails ausschließlich dorthin,
  Bounces sind ausgeschlossen und `X-Original-Recipient` zeigt den gedachten Empfänger.

* **Integrationstests verändern Abos** (sie abonnieren/kündigen KAP für die Testuser)
  und würden mit echtem SMTP Mails nach außen schicken. Der Session-Guard bricht sie
  deshalb ab, solange `SMTP_HOST` nicht `mailpit` ist.

Praktikable Wege für einen echten Testversand:

| Weg | Aufwand | Anmerkung |
|---|---|---|
| **Mailpit** (Standard) | keiner | Zustellung nicht nötig, um Inhalt/Empfängerauflösung zu prüfen — Web-UI zeigt jede Mail |
| **Transaktions-Mail-Dienst** (Brevo, Mailjet, SMTP2GO …) | ~15 min | SMTP mit API-Key/Passwort, Free Tier reicht; die eigene Absenderadresse wird per Klick-Mail verifiziert — damit ist Versand *von* der eigenen Adresse möglich |
| **Gmail** mit App-Passwort | ~10 min | funktioniert weiterhin, Absender ist dann die Gmail-Adresse |
| **Konzern-Exchange-Relay** | Antrag | der eigentliche Zielweg — üblicherweise IP-Allowlist ohne Auth (`SMTP_AUTH_MODE=none`), klärt Frage B2 |
| **OAuth2 (Modern Auth)** | ~20 min Einrichtung | im Code umgesetzt (`SMTP_AUTH_MODE=oauth2`), Anleitung unten |

### Outlook.com / Exchange Online per OAuth2 (`SMTP_AUTH_MODE=oauth2`)

Der einzige Weg, aus einem Microsoft-Postfach zu senden. Einmalige Einrichtung:

**1. App im Azure-Portal registrieren** ([portal.azure.com](https://portal.azure.com),
Anmeldung mit dem Microsoft-Konto genügt — kein Abo nötig):

* *Microsoft Entra ID* → *App-Registrierungen* → *Neue Registrierung*
* Name z. B. `Stoerungsinfo SMTP`, Kontotyp: **„Konten in einem beliebigen
  Organisationsverzeichnis und persönliche Microsoft-Konten“**, Redirect-URI leer lassen
* Nach dem Anlegen die **Anwendungs-ID (Client)** kopieren
* *Authentifizierung* → **„Öffentliche Clientflows zulassen“ = Ja** (zwingend für den
  Device-Code-Flow, ohne das schlägt Schritt 2 fehl)
* *API-Berechtigungen* → *Hinzufügen* → *APIs, die meine Organisation verwendet* →
  `Office 365 Exchange Online` → *Delegierte Berechtigungen* → **`SMTP.Send`**
  (bei privaten Konten optional — der v2.0-Endpunkt fragt den Scope beim Login
  dynamisch ab und du stimmst selbst zu)

**2. Refresh-Token holen** (einmalig, im Repo-Verzeichnis):

```bash
python backend/scripts/get_oauth_token.py --client-id <ANWENDUNGS-ID>
```

Das Skript zeigt eine URL und einen Code; nach der Bestätigung im Browser gibt es die
fertigen `.env`-Zeilen aus.

**3. In die `.env` übernehmen** und neu starten:

```dotenv
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_AUTH_MODE=oauth2
SMTP_USER=<konto@outlook.de>          # Postfach, aus dem gesendet wird
SMTP_OAUTH_TENANT=consumers           # privates Konto; sonst Tenant-ID
SMTP_OAUTH_CLIENT_ID=<ANWENDUNGS-ID>
SMTP_OAUTH_REFRESH_TOKEN=<aus Schritt 2>
MAIL_FROM=<konto@outlook.de>          # muss zu SMTP_USER passen
```

**Betrieb:** Access-Tokens holt das Backend selbst und cacht sie bis kurz vor Ablauf
(~1 h). Der Refresh-Token ist ein **Geheimnis** (Passwort-Äquivalent, nur in der
`.env` mit `chmod 600`) und bleibt gültig, solange er regelmäßig genutzt wird — nach
längerer Pause (Consumer-Konten: ~90 Tage) Schritt 2 wiederholen. Typische Fehler
stehen im Log: `AADSTS70008` = Token abgelaufen, `AADSTS65001` = Zustimmung fehlt,
`535` mit gültigem Token = `SMTP.Send`-Berechtigung oder falscher Scope.

**Vorsicht Bounces:** Die Demo-Empfänger (`*@example.corp`) existieren nicht. Beim
Versand über einen echten Server kommen für jeden davon Unzustellbarkeitsberichte
zurück. Vor einem echten Test entweder nur an einen Verteiler mit erreichbaren
Adressen senden oder die Demo-Empfänger lokal umschreiben:

```sql
-- lokale DEV-DB, reversibel:
UPDATE users SET email = '<echte@adresse.de>' WHERE oidc_sub = 'seed-demo-1';
```

### Umleitung (nur wenn gewünscht)

`MAIL_REDIRECT_TO=<zieladresse>` schickt **alle** Mails an diese eine Adresse; die
Versandhistorie behält die echten Empfänger, jede Mail trägt zusätzlich
`X-Original-Recipient`. Nützlich für Demos, ohne reale Verteiler anzuschreiben —
erzeugt aber weiterhin **eine Mail je Empfänger** und flutet bei großen Verteilern
das Zielpostfach. **In Produktion leer lassen.**

**Immer:** Nach `.env`-Änderungen neu starten (`make dev` bzw. `make prod-localdb`) —
die Konfiguration wird beim Start gelesen. Nach Codeänderungen zusätzlich `--build`,
weil Code und Frontend ins Image gebacken sind.

## 3c. Öffentlich erreichbarer Pilotbetrieb (Internet-VM)

Für Demos außerhalb des Konzernnetzes läuft eine eigene Variante: `compose.public.yaml`.
Unterschied zu `compose.prod.yaml`: Keycloak läuft mit (es gibt keinen Konzern-IdP),
das Zertifikat kommt von Let us Encrypt statt aus der Konzern-PKI, und die Speicher-
limits sind auf eine kleine VM (1,8 GB RAM) ausgelegt.

**Aktuelle Instanz:** `https://kunden-stoerungs-info.com` auf 94.237.99.120
(Ubuntu 26.04, 2 vCPU, 1,8 GB RAM + 2 GB Swap).

### Aufbau von null

```bash
# 1. VM grundausstatten (Docker, Swap, Firewall 22/80/443, SSH nur Key, fail2ban)
scp deploy/vm/bootstrap.sh root@<host>:/tmp/ && ssh root@<host> bash /tmp/bootstrap.sh

# 2. DNS: A-Record der Domain auf die VM-IP (bei Cloudflare zunächst "DNS only",
#    sonst schlägt die Zertifikatsausstellung fehl)

# 3. Code auf die VM bringen (kein Registry-Zugang nötig)
tar --exclude=.git --exclude=.env -czf /tmp/app.tgz compose*.yaml backend frontend \
    deploy ops .env.example Makefile
scp /tmp/app.tgz root@<host>:/tmp/
ssh root@<host> 'mkdir -p /opt/stoerungsinfo && tar -xzf /tmp/app.tgz -C /opt/stoerungsinfo'

# 4. Ausrollen: erzeugt .env mit frischen Secrets, legt die Keycloak-DB an,
#    startet den Stack, holt das Zertifikat, konfiguriert den Realm
ssh root@<host> 'cd /opt/stoerungsinfo && export PUBLIC_HOST=<domain> \
    ACME_EMAIL=<mail> SMTP_HOST=… SMTP_USER=… SMTP_PASSWORD=… MAIL_FROM=… \
    && bash deploy/vm/deploy.sh'

# 5. Zertifikatserneuerung als Cron (zweimal täglich; erneuert nur bei < 30 Tagen)
ssh root@<host> "(crontab -l 2>/dev/null; echo '17 3,15 * * * \
    /opt/stoerungsinfo/deploy/vm/renew-cert.sh >> /var/log/stoerungsinfo-cert.log 2>&1') \
    | crontab -"

# 6. Benutzer anlegen (Admin für die Versand-Maske)
ssh root@<host> 'cd /opt/stoerungsinfo && bash deploy/vm/create-user.sh <mail> --admin'
```

`deploy.sh` ist idempotent: Ein erneuter Lauf aktualisiert Container und Realm, behält
aber Secrets und Zertifikat. Nur Mail-Variablen werden übernommen, wenn sie beim Aufruf
gesetzt sind.

### Betriebseigenschaften

| Thema | Umsetzung |
|---|---|
| **TLS** | NGINX terminiert; Zertifikat im Volume `certbot_conf`. Der TLS-Serverblock wird erst aktiv, wenn ein Zertifikat existiert (`entrypoint-public.sh`) — sonst könnte NGINX nicht starten und die ACME-Prüfung nie beantworten. |
| **Erneuerung** | `deploy/vm/renew-cert.sh` per Cron: erneuert und **lädt NGINX neu**. Ohne den Reload würde NGINX das neue Zertifikat nicht verwenden und der Dienst nach 90 Tagen ausfallen. |
| **Keycloak** | Produktionsmodus, Speicher in MariaDB (Datenbank `keycloak`), erreichbar unter `/idp`. Adminkonsole und `/idp/metrics` sind per NGINX mit 404 blockiert. |
| **Adminkonsole** | Nur über SSH-Tunnel: `ssh -L 8081:localhost:8081 root@<host>`, dann `http://localhost:8081/idp/`. Zugangsdaten: `KEYCLOAK_ADMIN*` in der `.env`. |
| **Secrets** | Alle in `/opt/stoerungsinfo/.env` (`chmod 600`), beim ersten Deploy per `openssl rand` erzeugt. Keine Dev-Werte, nichts aus dem Repo. |
| **Registrierung** | Offen (Entscheidung des Auftraggebers), mit Bestätigungsmail und Brute-Force-Schutz. Abschalten: `registrationAllowed` per Keycloak-Adminkonsole oder `configure-realm.sh` anpassen. |
| **Speicher** | Limits: nginx 96 MB, api 384 MB, mariadb 320 MB, keycloak 768 MB. Im Betrieb ~1,1 GB belegt, Swap als Puffer. |
| **Reboot** | `restart: unless-stopped` + aktivierter Docker-Dienst — der Stack kommt selbstständig wieder. |

### Prüfen, ob alles läuft

```bash
curl -s https://<domain>/healthz          # Version und Git-SHA
curl -s https://<domain>/readyz           # DB, SMTP, Outbox-Rückstau
ssh root@<host> 'cd /opt/stoerungsinfo && docker compose -f compose.yaml \
    -f compose.db.yaml -f compose.public.yaml ps'
```

### Paketfilter (Firewall)

```bash
bash deploy/vm/firewall.sh            # Regeln setzen (idempotent)
bash deploy/vm/firewall.sh --status   # anzeigen
CF_ONLY=false bash deploy/vm/firewall.sh   # Cloudflare-Beschränkung aufheben
```

| Regel | Wirkung |
|---|---|
| **443 nur von Cloudflare** | Ohne diese Regel ist die Server-IP direkt erreichbar und Cloudflares Schutz, WAF und Ratenlimits sind mit einem `curl https://<ip>/` umgangen. Die Bereiche kommen von `cloudflare.com/ips-v4`/`-v6`, mit lokalem Zwischenspeicher als Rückfalloption (IPv4 **und** IPv6). |
| **Port 80 bleibt offen** | Dort liegen nur ACME-Prüfung und Weiterleitung — kein Inhalt, keine Anmeldung. Sperrt man ihn mit (`CF_ONLY_HTTP=true`), scheitert die Zertifikatserneuerung, sobald Cloudflare auf „DNS only" steht. |
| **SSH mit Verbindungsbremse** | `ufw limit 22/tcp` erlaubt 6 Versuche in 30 s pro IP, zusätzlich zu fail2ban. |
| **Alles andere eingehend: verworfen** | ufw-Standard `deny incoming`; DROP statt REJECT, damit Scanner keine Rückmeldung erhalten. |

**Warum eine eigene iptables-Kette und nicht nur ufw:** Docker veröffentlicht
Container-Ports über eigene DNAT-Regeln, die die ufw-INPUT-Kette **umgehen** — ein
`ufw deny 443` bliebe hier wirkungslos. Wirksam ist nur die Kette `DOCKER-USER`, die
Docker vor seinen eigenen FORWARD-Regeln auswertet. Das Skript legt dafür eine eigene
Kette `STOERUNGSINFO` an (damit ein Flush keine fremden Regeln trifft) und hängt sie
dort ein.

**Persistenz:** iptables-Regeln überleben keinen Neustart, und Docker baut seine Ketten
beim Start neu auf. Die Unit `stoerungsinfo-firewall.service` (nach `docker.service`)
setzt sie deshalb erneut. Nach einem Docker-Neustart verifiziert.

**Nach einer Änderung immer beides prüfen** — sonst fällt eine zu strenge Regel erst
auf, wenn niemand mehr aufs Portal kommt:

```bash
curl -sk --max-time 8 https://<server-ip>/healthz     # muss ins Timeout laufen
curl -s https://<domain>/healthz                       # muss 200 liefern
ssh root@<server-ip> 'echo ok'                         # muss funktionieren
```

**Cloudflare-Bereiche aktualisieren** (Cloudflare ändert sie selten, aber nicht nie —
danach zeigten Ratenlimits und Logs auf Proxy-Adressen statt auf Nutzer):

```bash
bash deploy/vm/update-cloudflare-ranges.sh   # NGINX-Liste + Firewall in einem Schritt
```

**Echte Client-IP:** `deploy/nginx/includes/cloudflare-real-ip.inc` lässt NGINX die
Adresse aus `CF-Connecting-IP` übernehmen — aber nur, wenn die Anfrage aus einem
Cloudflare-Bereich kommt (sonst könnte jeder eine fremde IP behaupten). Ohne diese
Datei sehen alle Ratenlimits nur Cloudflare-Adressen: Echte Nutzer sperren sich
gegenseitig aus, ein Angreifer verteilt sich über mehrere Standorte.

### Weitere Härtungsmöglichkeiten (nicht aktiviert)

* **SSH auf feste Adressen beschränken** (`ufw allow from <ip> to any port 22`) — wirksam,
  aber bei wechselnder Heim-IP sperrt man sich schnell selbst aus. Alternative: SSH auf
  einen anderen Port legen (verringert nur das Rauschen, keine echte Sicherheit).
* **Ausgehende Verbindungen beschränken** (`ufw default deny outgoing` plus
  Ausnahmen für DNS, NTP, HTTPS, SMTP 587). Erschwert Datenabfluss, bricht aber leicht
  Image-Builds und Paketaktualisierungen — nur mit Testfenster einführen.
* **Cloudflare-Zugriffsregeln** ersetzen Firewallarbeit teilweise: Länder- oder
  Bot-Sperren, „Under Attack"-Modus, oder eine Access-Policy vor dem Portal (dann
  brauchte niemand mehr das offene Registrierungsformular).
* **Docker-Ports an Loopback binden** (`127.0.0.1:8081:8081`) für Dienste, die nur über
  einen SSH-Tunnel erreichbar sein sollen — umgeht das ufw-Problem elegant, weil gar
  nichts nach außen veröffentlicht wird.

### Absicherung gegen Missbrauch (öffentlich = Angriffsfläche)

Ein Sicherheitsreview dieser Konfiguration hat mehrere Lücken aufgedeckt, die behoben
sind. Wer die Konfiguration ändert, sollte wissen, warum sie so aussieht:

* **Keine Demo-Konten.** Der importierte Realm bringt DEV-Testnutzer mit dem Passwort
  `test` mit — einen davon mit Adminrolle. Öffentlich wäre das eine offene Tür zur
  Versandmaske und zur gesamten Empfängerliste. `configure-realm.sh` löscht alle Konten
  mit Beispiel-Domain bei **jedem** Deploy und bricht ab, falls eines übrig bleibt.
* **Allowlist statt Blockliste für `/idp`.** Nur Anmeldung, Registrierung, Protokoll-
  und Theme-Pfade des Realms `dev` werden durchgereicht; alles andere endet mit 404 —
  Adminkonsole, Admin-REST-API, `master`-Realm, Metriken, Health. Eine frühere
  Regex-Blockliste war per Matrix-Parameter (`/idp/admin;x/...`) umgehbar; `^~`-Präfixe
  erfassen solche Varianten. **Nicht auf eine Blockliste zurückbauen.**
* **Ratenlimits.** Registrierung und Passwort-Reset lösen je Aufruf eine Mail über das
  konfigurierte Postfach aus — ohne Bremse ließe sich der Dienst als Mailversender für
  Fremde missbrauchen und das Tageskontingent des Kontos in Sekunden verbrauchen.
  Wichtig: `SMTP_MAX_PER_MINUTE` greift hier **nicht**, weil Keycloak über seinen
  eigenen SMTP-Server sendet, nicht über den Outbox-Worker.
* **X-Forwarded-For wird gesetzt, nicht angehängt.** Sonst könnte ein Client eine fremde
  IP voranstellen und damit Brute-Force-Zähler und Ratenlimits auf eine andere Adresse
  umlenken.
* **Der API-Container erhält nur seine eigenen Variablen** (keine Datenbank-Root- und
  Keycloak-Adminpasswörter mehr über `env_file`).
* **Tageskontingent des Mailkontos**: Meldungen wie `550 5.4.5 Daily user sending limit
  exceeded` werden als vorübergehend behandelt, damit der Backoff greift statt alle
  restlichen Empfänger endgültig als fehlgeschlagen zu verbuchen.

### Offene Punkte für diese Instanz

* **Backup läuft, ist aber nicht automatisiert.** `ops/backup.sh` erkennt das
  Overlay inzwischen selbst und sichert **beide** Datenbanken (`newsletter` **und**
  `keycloak` — ohne die zweite gäbe es nach einem Restore keine Konten mehr).
  `deploy.sh` zieht vor jedem Ausrollen einen Dump. Für Dauerbetrieb noch als Cron
  einrichten:
  `0 2 * * * /opt/stoerungsinfo/ops/backup.sh >> /var/log/stoerungsinfo-backup.log 2>&1`
  und eine Kopie außerhalb der VM ablegen.
* **`.env` existiert nur auf der VM.** Geht sie verloren, passen die generierten
  Passwörter nicht mehr zu den Daten in den Volumes (MariaDB übernimmt ein neues
  Passwort nur bei leerem Datenverzeichnis). Verschlüsselte Kopie anlegen.
* **Offene Selbstregistrierung** ist eine bewusste Entscheidung. Wer sich registriert,
  wird Empfänger der Pflicht-Verteiler. Abschalten über die Keycloak-Adminkonsole
  (SSH-Tunnel) oder `registrationAllowed: False` in `configure-realm.sh`.
* **Cloudflare-Proxy** steht auf „DNS only". Nach der Zertifikatsausstellung kann auf
  „Proxied" mit *SSL/TLS → Full (strict)* umgestellt werden: versteckt die VM-IP und
  filtert Angriffe vorab. Die Erneuerung funktioniert weiter, weil Cloudflare
  `/.well-known/acme-challenge/` durchreicht. Danach in NGINX `set_real_ip_from` mit
  den Cloudflare-Netzen ergänzen, sonst sehen Ratenlimits nur noch Cloudflare-IPs.
* **Images werden auf der VM gebaut.** Während des Builds konkurriert `pip install` mit
  MariaDB und Keycloak um 1,8 GB RAM. Bei Problemen den Stack vor dem Build stoppen
  oder Images in CI bauen (ADR-0008).
* **Kein Monitoring.** `/readyz` wird von niemandem abgefragt. Für einen echten Pilot
  einen externen Check einrichten (Uptime-Dienst oder Cron mit Alarm-Mail).

## 4. Notfall-Versand bei Systemausfall

Fällt während einer Großstörung das Portal, die DB oder der IdP aus:

1. **Empfängerlisten-Export**: Tägliche Exporte liegen unter `/var/backups/stoerungsinfo/recipients_*.csv`.
2. **Manueller Versand**: Das Problemmanagement versendet die Benachrichtigung manuell über Outlook / Funktionspostfach an die exportierte CSV-Verteilerliste.

---

## 5. Secret- & Zertifikats-Management

* **Notfall-Session-Invalidierung**: Falls ein Secret kompromittiert wurde, `SESSION_SECRET` in `.env` ändern und `make prod` ausführen. Alle aktiven Sessions werden sofort ungültig.
* **Zertifikatsablauf**: Das Ablaufdatum des TLS-Zertifikats wird über `/readyz` überwacht (Warnung bei < 30 Tagen Restlaufzeit).

---

## 6. Topic-Pflege per SQL (ADR-016)

Neue Topics oder Beschreibungsänderungen werden direkt in der Datenbank gepflegt:

```sql
-- Neues Topic anlegen
INSERT INTO topics (id, name, description, is_mandatory, is_active)
VALUES ('sap-hr', 'SAP HR Störungen', 'Benachrichtigungen zu HR-Systemen', 0, 1);

-- Topic deaktivieren (wird sofort im UI ausgeblendet)
UPDATE topics SET is_active = 0 WHERE id = 'interflex';
```

---

## 7. Störungsbehebung (Troubleshooting Matrix)

| Symptom | Mögliche Ursache | Diagnose-Befehl | Maßnahme |
|---|---|---|---|
| `/readyz` zeigt `degraded` (outbox) | Stau unversendeter Mails | `docker compose logs api` | Relay-Erreichbarkeit prüfen, Rate-Limit prüfen |
| Login schlägt fehl (502) | IdP nicht erreichbar / OIDC-Secret falsch | `curl -vk $OIDC_ISSUER_URL` | Zertifikate, Proxy-Einstellungen & Secret prüfen |
| Platte voll | Docker Logs / Backup-Verzeichnis zu groß | `df -h`, `docker system df` | Pruning durchführen, alte Dumps aufräumen |
