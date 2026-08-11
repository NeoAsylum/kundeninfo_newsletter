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
6. **Erreichbarkeit prüfen** — `/readyz` deckt DB, SMTP und Outbox-Rückstau in einem
   Aufruf ab und schlägt fehl, wenn eine Egress-Freischaltung fehlt:
   ```bash
   curl -fsS -k https://localhost/readyz
   ```

---

## 3. Backup & Restore (Lokale DB-Phase)

* **Backup**: `ops/backup.sh` legt einen Dump unter
  `/var/backups/stoerungsinfo/stoerungsinfo_<datum>_<zeit>.sql.gz` ab (Rechte `600`, weil
  er personenbezogene Klartextdaten und Passwort-Hashes enthält). Gesichert werden
  `newsletter` und — falls vorhanden — `keycloak`. Als Cron einrichten: siehe Abschnitt 3c.
* **Restore**: Der Dump entsteht mit `--databases` und bringt `CREATE DATABASE`/`USE` mit,
  wird also ohne Datenbanknamen eingespielt — und als `root`, damit auch `keycloak`
  zurückkommt:
  ```bash
  gunzip -c /var/backups/stoerungsinfo/stoerungsinfo_<datum>_<zeit>.sql.gz | \
    docker compose exec -T mariadb sh -c 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD"'
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
> Admin-Zugriff). Auch Modern Auth/OAuth2 scheitert dort mit demselben Fehler, weil
> die Sperre am Postfach hängt und nicht am Auth-Verfahren. Für ein Microsoft-Postfach
> im Konzern-Tenant kann OAuth2 dagegen greifen — dann ist es Nacharbeit in der App
> (ADR-0012, Frage B2).

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
| **Konzern-Exchange-Relay** | Antrag | der eigentliche Zielweg — üblicherweise IP-Allowlist ohne Auth (`SMTP_AUTH_MODE=none`). Verlangt der Relay Modern Auth/OAuth2, ist das Nacharbeit (ADR-0012, Frage B2) |

### Umleitung (nur wenn gewünscht)

`MAIL_REDIRECT_TO=<zieladresse>` schickt **alle** Mails an diese eine Adresse. Erzeugt
weiterhin eine Mail je Empfänger und flutet bei großen Verteilern das Zielpostfach.
**In Produktion leer lassen.**

**Immer:** Nach `.env`-Änderungen neu starten (`make dev` bzw. `make prod-localdb`) —
die Konfiguration wird beim Start gelesen. Nach Codeänderungen zusätzlich `--build`,
weil Code und Frontend ins Image gebacken sind.

## 3c. Öffentlich erreichbarer Pilotbetrieb (Internet-VM)

Für Demos außerhalb des Konzernnetzes läuft eine eigene Variante: `compose.public.yaml`.
Unterschied zu `compose.prod.yaml`: Keycloak läuft mit (es gibt keinen Konzern-IdP),
das Zertifikat kommt von Let's Encrypt statt aus der Konzern-PKI, und die Speicher-
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

# 6. Benutzer anlegen. Adminrechte kommen NICHT von hier, sondern aus dem Portal:
#    Die in ADMIN_BOOTSTRAP_EMAILS eingetragene Adresse (deploy.sh übernimmt dafür
#    ACME_EMAIL) wird beim ersten Login Admin — solange kein aktiver Admin existiert.
#    Alle weiteren Rechte danach in der Maske "Rollen" (/rollen.html).
ssh root@<host> 'cd /opt/stoerungsinfo && bash deploy/vm/create-user.sh <mail>'
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
| **Speicher** | Limits: nginx 96 MB, api 320 MB, mariadb 288 MB, keycloak 640 MB, certbot 128 MB. Im Betrieb ~1,1 GB belegt, Swap als Puffer. |
| **Reboot** | `restart: unless-stopped` + aktivierter Docker-Dienst — der Stack kommt selbstständig wieder. |

### Prüfen, ob alles läuft

```bash
curl -s https://<domain>/healthz          # Version und Git-SHA
curl -s https://<domain>/readyz           # DB, SMTP, Outbox-Rückstau
ssh root@<host> 'cd /opt/stoerungsinfo && docker compose -f compose.yaml \
    -f compose.db.yaml -f compose.public.yaml ps'
```

### Demo-Betrieb: Stack nur bei Bedarf laufen lassen

Die wirksamste Absicherung eines öffentlich erreichbaren Portals ist, es außerhalb von
Vorführungen abzuschalten — ein gestoppter Stack hat keine Angriffsfläche: keine
Anmeldung, keine Registrierung, kein Mailversand. Die Daten (Abos, Historie, Konten)
bleiben in den Volumes.

```bash
bash deploy/vm/demo-mode.sh start    # vor der Demo
bash deploy/vm/demo-mode.sh stop     # danach
bash deploy/vm/demo-mode.sh status   # Zustand + letzte Sicherungen
```

* **`stop`** zieht vorher eine Sicherung — der nächtliche Cron-Job kann bei gestopptem
  Stack nichts tun, sonst fehlte bei längeren Pausen jede Sicherung.
* **`start`** prüft die Restlaufzeit des Zertifikats und erneuert bei unter 30 Tagen.
  Wichtig, weil der Erneuerungs-Cron ebenfalls einen laufenden Stack braucht: Bei
  mehrmonatiger Pause wäre das Zertifikat sonst unbemerkt abgelaufen.
* Cloudflare antwortet bei gestopptem Stack mit **521** („Web Server Is Down") — ein
  normaler Zustand, kein Fehler.

Ist die ganze VM abgeschaltet, kommen Container und Paketfilterregeln beim Start von
allein zurück (`restart: unless-stopped`, aktivierter Docker-Dienst,
`stoerungsinfo-firewall.service`). Verifiziert: alle Container nach ~26 Sekunden
betriebsbereit, Cloudflare-Beschränkung wieder aktiv.

### Demo-Zugänge (Zugangsdaten zum Weitergeben)

```bash
# 1. Konto anlegen (festes Passwort, Name gegen die VERIFY_PROFILE-Sperre)
bash deploy/vm/create-user.sh <mail> --password "<pw>" --name "Vor Nach"
# 2. Adminrechte gibt das Portal, nicht das Skript: als Admin anmelden und in
#    /rollen.html das Häkchen setzen. Kontrolle per SQL: Abschnitt 6b.

# nach der Demo sperren — Abos und Historie bleiben erhalten
bash deploy/vm/create-user.sh <mail> --disable
bash deploy/vm/create-user.sh <mail> --enable    # wieder freigeben
```

`--disable` sperrt die Anmeldung im IdP **und** setzt `users.is_active = 0` im Portal.
Beides muss zusammenlaufen: Ein nur im IdP gesperrter Admin bliebe für die Anwendung
ein *aktiver* Admin und würde den Notausgang `ADMIN_BOOTSTRAP_EMAILS` dauerhaft
blockieren (der greift nur, solange kein aktiver Admin existiert) — wer den letzten
Admin nach einer Demo sperrt, hätte sonst ein Portal, das sich nur per SQL wieder
öffnen lässt. Ein etwaiges Adminrecht bleibt gesetzt, zählt aber nicht mehr als aktiv.
Meldet sich die Person später wieder an, reaktiviert das JIT-Provisioning die Zeile
(ADR-0010).

**Was ein Admin-Zugang kann** — vor der Weitergabe abwägen:

* **Alle Empfängeradressen einsehen** (Empfänger-Maske). Wer den Zugang bekommt, sieht
  jede registrierte Adresse — bei einem öffentlichen Portal mit Selbstregistrierung
  können das fremde, personenbezogene Adressen sein.
* **Echte Mails an alle Abonnenten verschicken**, über das konfigurierte Postfach und auf
  dessen Tageskontingent. Ein unbedachter Testversand an den Pflicht-Verteiler erreicht
  jeden registrierten Empfänger.
* **Empfänger deaktivieren** (schließt sie vom Versand aus).
* **Weitere Admins ernennen** (Maske „Rollen“) — für jeden Empfänger, auch fremde
  selbstregistrierte. Das Recht steht im Portal, nicht im IdP: Es **überlebt das Sperren
  des Demo-Zugangs** (`create-user.sh <mail> --disable`) und muss einzeln entzogen werden.
  Kontrolle, wer es hat: der SELECT in Abschnitt 6b.
* **Verteiler endgültig löschen**, solange keine Meldung darüber verschickt wurde — samt
  aller Abo-Zeilen, die dabei verloren gehen (ihre Zahl steht danach nur noch im
  `audit_log`). Verteiler mit Historie sind nur deaktivierbar.

**Wirksamste Eingrenzung für Demophasen:** `MAIL_REDIRECT_TO=<eigene@adresse>` in der
`.env` setzen und `deploy.sh` erneut laufen lassen. Dann landen alle Mails ausschließlich
dort, die Historie zeigt weiterhin die gedachten Empfänger, und ein Demo-Nutzer kann
niemanden Fremdes anmailen. Für die Demo bleibt alles sichtbar — nur die Zustellung ist
umgeleitet.

Weitere Möglichkeiten: Demo-Empfänger statt echter Privatadressen anlegen (dann zeigt die
Empfänger-Maske keine realen Adressen), Zugang nach der Demo sperren, Passwort danach
ändern.

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

### Absicherung gegen Missbrauch (öffentlich = Angriffsfläche)

Wer diese Konfiguration ändert, sollte wissen, warum sie so aussieht:

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

### Weg zurück, wenn ein Deploy schiefgeht

Es gibt **kein** Image-Rollback: `IMAGE_TAG` bleibt `local` (auf der VM liefert
`git describe` nichts, weil der Transport `.git` ausschließt), der Neubau nimmt dem
alten Image den Tag, und `docker image prune` räumt es am Ende weg. Der Weg zurück ist
deshalb zweiteilig:

1. **Daten:** Der Dump, den `deploy.sh` vor dem Ausrollen zieht (siehe Abschnitt 3
   für das Einspielen). Er entsteht immer, wenn Nutzerdatensätze vorhanden sind —
   unabhängig davon, ob der Stack lief.
2. **Code:** Den vorigen Stand erneut hochladen (`tar`-Schritt aus „Aufbau von null",
   Schritt 3) und `deploy.sh` nochmals laufen lassen. Deshalb lohnt es sich, das
   Archiv des letzten funktionierenden Stands aufzubewahren:
   `cp /tmp/app.tgz /root/app-$(date +%F).tgz`.

Bis dahin liefert NGINX 502, sobald der api-Container nicht startet. Der schnellste
Zwischenschritt ist `demo-mode.sh stop` — dann ist die Instanz sauber aus statt halb
kaputt.

### Offene Punkte für diese Instanz

* **Backup ist nicht automatisiert.** `ops/backup.sh` sichert beide Datenbanken
  (`newsletter` und `keycloak` — ohne die zweite gäbe es nach einem Restore keine
  Konten mehr), und `deploy.sh` zieht vor jedem Ausrollen einen Dump. Für Dauerbetrieb
  als Cron einrichten und eine Kopie außerhalb der VM ablegen:
  `0 2 * * * /opt/stoerungsinfo/ops/backup.sh >> /var/log/stoerungsinfo-backup.log 2>&1`
* **`.env` existiert nur auf der VM.** Geht sie verloren, passen die generierten
  Passwörter nicht mehr zu den Daten in den Volumes (MariaDB übernimmt ein neues
  Passwort nur bei leerem Datenverzeichnis). Verschlüsselte Kopie anlegen.
* **Offene Selbstregistrierung** ist eine bewusste Entscheidung. Wer sich registriert,
  wird Empfänger der Pflicht-Verteiler. Abschalten über die Keycloak-Adminkonsole
  (SSH-Tunnel) oder `registrationAllowed: False` in `configure-realm.sh`.
* **Images werden auf der VM gebaut.** Während des Builds konkurriert `pip install` mit
  MariaDB und Keycloak um 1,8 GB RAM. Bei Problemen den Stack vor dem Build stoppen
  oder Images in CI bauen (ADR-0008).
* **Kein Monitoring.** `/readyz` wird von niemandem abgefragt — im Demo-Betrieb mit
  gestopptem Stack wäre ein Uptime-Check ohnehin ein Dauerfehlalarm. Für einen echten
  Dauerbetrieb einen externen Check einrichten.

## 4. Notfall-Versand bei Systemausfall

Fällt während einer Großstörung das Portal, die DB oder der IdP aus:

1. **Empfängerliste beschaffen** — aus dem letzten Datenbank-Dump
   (`/var/backups/stoerungsinfo/`) oder, solange die DB noch antwortet, direkt:

   ```sql
   SELECT u.email FROM users u JOIN subscriptions s ON s.user_id = u.id
   WHERE s.topic_id = '<topic>' AND u.is_active = 1
   UNION
   SELECT email FROM users WHERE is_active = 1
     AND (SELECT is_mandatory FROM topics WHERE id = '<topic>') = 1;
   ```

2. **Manueller Versand**: Das Problemmanagement versendet die Benachrichtigung über
   Outlook / Funktionspostfach an diese Liste.

Ein automatisierter Notfall-Export ist bewusst nicht gebaut — er wäre ein zweiter
Versandweg, der mitgepflegt werden müsste.

---

## 5. Secret- & Zertifikats-Management

* **Notfall-Session-Invalidierung**: Falls ein Secret kompromittiert wurde,
  `SESSION_SECRET` in der `.env` ändern und den Stack neu starten (`make prod` bzw. im
  öffentlichen Pilot `bash deploy/vm/deploy.sh`). Alle aktiven Sessions werden sofort
  ungültig, weil sie ohne Session-Store allein aus dem Cookie gelesen werden.
* **Zertifikatsablauf**: `/readyz` prüft das Zertifikat **nicht**. Im öffentlichen Pilot
  erneuert der Cron-Job `renew-cert.sh` unterhalb von 30 Tagen Restlaufzeit, und
  `demo-mode.sh start` prüft die Restlaufzeit zusätzlich bei jedem Start. Im Zielbild
  mit Konzern-PKI liegt die Überwachung beim Zertifikatsprozess des Konzerns.

---

## 6. Verteiler-Pflege (Regelweg: Oberfläche, ADR-0024)

Verteiler werden **in der Oberfläche** gepflegt: `/verteiler.html`, Navigationspunkt
„Verteiler“, Rolle `admin`. Dort gibt es Anlegen, Umbenennen, Beschreibung und
Pflicht-Kennzeichen, Deaktivieren/Reaktivieren und Löschen — inklusive der Abonnenten- und
Versandzahlen, die für jede Lösch-Entscheidung nötig sind. Jede Änderung landet im
`audit_log`, `updated_at` wird fortgeschrieben.

Was die Maske absichtlich nicht kann (Begründungen in [ADR-0024](adr/0024-verteiler-crud-in-der-oberflaeche.md)):

* **Slug ändern** — `topics.id` ist Primärschlüssel mit Referenzen aus `subscriptions` und
  `dispatches`. Falscher Slug: neuen Verteiler anlegen, alten löschen (solange ohne
  Versandhistorie) bzw. deaktivieren.
* **Verteiler mit Versandhistorie löschen** (`409 TOPIC_IN_USE`) — die Historie ist
  unveränderlich und seit [ADR-0023](adr/0023-meldungshistorie-fuer-alle.md) für alle
  sichtbar. Stattdessen deaktivieren.
* **Umbenennen, während ein Versand läuft** (`409 TOPIC_RENAME_BLOCKED`) — kurz warten,
  der Versand ist in Minuten durch.

### Notfallweg: SQL

Nur zwei Lagen rechtfertigen den direkten DB-Zugriff: Es hat **niemand mehr Adminrechte**
(dann zuerst 6b) oder die **Oberfläche ist nicht erreichbar**, während eine Störungsmeldung
über einen neuen bzw. deaktivierten Verteiler raus muss.

```sql
-- Neuen Verteiler anlegen
INSERT INTO topics (id, name, description, is_mandatory, is_active)
VALUES ('sap-hr', 'SAP HR Störungen', 'Benachrichtigungen zu HR-Systemen', 0, 1);

-- Verteiler deaktivieren (verschwindet sofort aus Abo-Maske und Versand-Auswahl)
UPDATE topics SET is_active = 0 WHERE id = 'interflex';

-- Pflicht-Kennzeichen kippen (z. B. wenn der Betriebsrat das Zwangs-Abo nicht mitträgt)
UPDATE topics SET is_mandatory = 0 WHERE id = 'zentrale-stoerungen';
-- Kontrolle: ein Tippfehler im Slug wäre ein stiller No-op
SELECT id, is_mandatory FROM topics WHERE id = 'zentrale-stoerungen';
```

> **Zwei Unterschiede zum Regelweg, beide bewusst:** Per SQL entsteht **kein**
> `audit_log`-Eintrag — wer die Änderung nachvollziehbar halten will, schreibt ihn selbst
> mit (`action` = `topic_created` / `topic_updated` / `topic_deleted`, siehe
> [ADR-0017](adr/0017-audit-log-umfang.md)). Und `updated_at` wird nicht fortgeschrieben,
> die Zeile sieht also unverändert aus. Deshalb ist SQL der Notfall- und nicht der
> Regelweg. Die Guards der API greifen hier ebenfalls nicht: Ein `UPDATE topics SET name`
> während eines laufenden Versands verfälscht den Titel in den bereits erzeugten Mails.

---

## 6b. Adminrechte per SQL vergeben (Aussperrung auflösen)

Der dokumentierte Ausweg, wenn niemand mehr Adminrechte hat — etwa weil der letzte Admin
offboardet wurde oder die Datenbank neu aufgesetzt ist. **Der bequemere Weg zuerst:**
`ADMIN_BOOTSTRAP_EMAILS` in der `.env` setzen und neu starten — diese Adressen bekommen
beim Login das Adminrecht, solange kein aktiver Admin existiert. Genau dann ist das der
Fall. Das SQL unten braucht man, wenn die Person sich nicht neu anmelden kann oder der
Stack nicht neu gestartet werden soll. Referenziert
von [ADR-0022](adr/0022-adminrechte-im-portal.md) und Migration
`0003_admin_flag.py`.

Voraussetzung: Die Person hat sich mindestens einmal am Portal angemeldet — erst dann
existiert ihre Zeile in `users` (JIT-Provisioning, [ADR-0010](adr/0010-jit-provisioning.md)).

```sql
-- Adminrecht setzen
UPDATE users SET is_admin = 1 WHERE email = 'vorname.nachname@example.corp';

-- Kontrolle: wer hat das Portal-Kennzeichen?
SELECT id, email, is_active, is_admin FROM users WHERE is_admin = 1;
```

Wirkt sofort — die Autorisierung liest das Kennzeichen bei jeder Anfrage. Die
Navigationspunkte erscheinen nach einem Neuladen der Seite. Ist der Empfänger
deaktiviert (`is_active = 0`), zuerst reaktivieren, sonst endet die Anmeldung an
„Bitte neu anmelden“.

Ab hier läuft die Rechtevergabe wieder über die Oberfläche: `/rollen.html`. Auch hier
entsteht per SQL **kein** `audit_log`-Eintrag (`admin_granted`) — bei einer Aussperrung ist
das vertretbar, ein Vermerk im Change gehört trotzdem dazu.

---

## 7. Störungsbehebung (Troubleshooting Matrix)

| Symptom | Mögliche Ursache | Diagnose-Befehl | Maßnahme |
|---|---|---|---|
| `/readyz` zeigt `degraded` (outbox) | Stau unversendeter Mails | `docker compose logs api` | Relay-Erreichbarkeit prüfen, Rate-Limit prüfen |
| Login schlägt fehl (502) | IdP nicht erreichbar / OIDC-Secret falsch | `curl -vk $OIDC_ISSUER_URL` | Zertifikate, Proxy-Einstellungen & Secret prüfen |
| Platte voll | Docker Logs / Backup-Verzeichnis zu groß | `df -h`, `docker system df` | Pruning durchführen, alte Dumps aufräumen |
