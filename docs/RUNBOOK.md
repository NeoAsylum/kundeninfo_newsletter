# RUNBOOK — Betriebs- und Notfallhandbuch „Störungsinfos“

Dieses Dokument richtet sich an Entwickler und Systemadministratoren zur Durchführung von Deploys, Updates, Backups, Notfall-Maßnahmen und Wartungsarbeiten.

---

## 1. Schnellstart & Deployment (PROD)

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
3. **PROD-Stack starten** (NGINX, API und die Datenbank als Container):
   ```bash
   make prod
   ```
4. **Smoke-Test durchführen**:
   ```bash
   make smoke BASE_URL=https://stoerungsinfo.konzern.example
   ```
5. **Zertifikate von IdP und Mailrelay prüfen** — einmal vor dem ersten Einsatz im
   Konzernnetz. Seit Python 3.13 (das Image läuft auf 3.14) prüft die Anwendung
   Zertifikatsketten streng nach RFC 5280; eine Kette ohne Authority Key Identifier oder
   mit einer CA ohne kritische Basic Constraints wird abgelehnt, auch wenn ältere Clients
   sie annehmen. `/readyz` und der Smoke-Test zeigen das nicht:
   ```bash
   docker compose -f compose.yaml -f compose.db.yaml -f compose.prod.yaml exec api \
     python -c "import httpx, os; print(httpx.get(os.environ['OIDC_ISSUER_URL'] + '/.well-known/openid-configuration', timeout=10).status_code)"
   docker compose -f compose.yaml -f compose.db.yaml -f compose.prod.yaml exec api \
     python scripts/check_smtp.py                 # Relay: Verbindung, TLS, Anmeldung — ohne Mail
   ```
   Beide Aufrufe nehmen den Weg der Anwendung: denselben Proxy (`HTTPS_PROXY`), denselben
   Vertrauensspeicher (`SSL_CERT_FILE`, sonst der mitgelieferte von certifi — nicht der des
   Betriebssystems) und dieselbe strenge Prüfung. Erwartet ist `200`. Danach einmal
   wirklich anmelden und einen Testversand bis „Zugestellt“ verfolgen.
   Scheitert die Prüfung, nennt die Meldung den Grund (etwa `Missing Authority Key
   Identifier`); das ist eine Frage an die PKI (Frage B4), kein Schalter der Anwendung.

---

## 2. Datenbank: Container auf derselben VM

PostgreSQL läuft in jeder Umgebung als Container auf derselben Maschine wie die Anwendung
(`compose.db.yaml`, Volume `pg_data`) — auch in PROD. Ein Umzug auf eine externe Datenbank
ist nicht geplant ([ADR-0030](adr/0030-postgresql-im-container-auch-in-prod.md)); die
Cutover-Prozedur, die früher hier stand, ist entfallen. Die Verbindung bleibt im
Docker-Netz, der Container veröffentlicht keinen Port.

Damit liegt beim Betrieb der VM, was sonst ein Datenbank-Team übernähme (wer das ist: offen,
Frage B7):

* **Sicherung und Wiederherstellung:** Abschnitt 3.
* **Patches:** PostgreSQL kommt aus dem Base-Image `postgres:18-alpine`, per Digest gepinnt
  (`deploy/postgres/Dockerfile`; die Test-DB in `compose.dev.yaml` nennt denselben Digest).
  Eine neue Unterversion erreicht die VM erst, wenn der Digest an beiden Stellen angehoben
  und das Image neu gebaut ist — den aktuellen zeigt
  `docker buildx imagetools inspect postgres:18-alpine`.
* **Major-Upgrade:** kein bloßer Tag-Wechsel — der neue Server liest das Datenverzeichnis
  des alten nicht. Der Weg ist Dump und Restore auf ein neues Volume; siehe unten.
* **Server-Log:** `docker compose … logs postgres` zeigt zu einem Fehler nur die ERROR-Zeile
  — ohne DETAIL, HINT, CONTEXT und ohne die gescheiterte Anweisung (ADR-0014; der Server
  startet mit `log_error_verbosity=terse` und `log_min_error_statement=panic`). Die
  vollständige Meldung steht in der Ausgabe des Clients (`psql`) und, für Fehler der
  Anwendung, in deren Log (ohne Parameterwerte). Die ERROR-Zeile selbst zitiert, was
  PostgreSQL nicht einordnen kann: Wer in von Hand eingegebenem SQL eine Adresse in doppelte
  statt einfache Anführungszeichen setzt oder sie mit einer Zahl vergleicht, schreibt sie
  ins Log.

### Major-Upgrade von PostgreSQL (zuletzt 16 → 18)

Der Server einer neuen Hauptversion startet nicht auf dem Datenverzeichnis der alten. Seit
PostgreSQL 18 erwartet das Image sein Volume außerdem unter `/var/lib/postgresql` (vorher
`/var/lib/postgresql/data`) und bricht mit einer Fehlermeldung ab, wenn es dort einen alten
Bestand findet. Deshalb zieht der Bestand per Dump auf ein **neues** Volume um (`pg_data`);
das alte (`db_data`) wird nicht migriert und bleibt als Rückweg liegen.

Den Umzug macht `deploy/vm/pg-umzug.sh`. Solange er aussteht, verweigern `deploy.sh`,
`demo-mode.sh start` und `update-cloudflare-ranges.sh` den Start (`pg-umzug-sperre.sh`):
Mit dem neuen Stand des Codes legte jedes „compose up“ einen leeren Cluster an, und das
Portal liefe ohne Konten und Historie weiter — bei offener Registrierung. **Bis der Umzug
durch ist, nichts von Hand mit `docker compose … up` oder `make prod` starten.**

1. **Code auf den neuen Stand bringen** — Pilot: Archiv wie in Abschnitt 3c (das bisherige
   Archiv aufheben, es gehört zum Rückweg); sonst `git pull`.
2. **Umziehen:**
   ```bash
   cd /opt/stoerungsinfo
   bash deploy/vm/pg-umzug.sh                              # öffentlicher Pilot
   OVERLAY=compose.prod.yaml bash deploy/vm/pg-umzug.sh    # Konzern-VM
   ```
   Das Skript hält den Stack an, liest den Bestand mit einem von Hand gestarteten
   PostgreSQL 16, sichert jede Datenbank einzeln
   (`/var/backups/stoerungsinfo/umzug_pg16_<datum>_<zeit>.sql.gz`), startet **nur** die neue
   Datenbank, spielt ein und vergleicht in jeder Datenbank — auch der von Keycloak — je
   Tabelle die Zeilenzahl und je Sequenz den Stand (nicht den Inhalt der Zeilen). Erst wenn
   alles übereinstimmt, trägt es `PG_UMZUG_ERLEDIGT=1` in die `.env` ein. Bei einem Fehler
   bricht es ab; die übrigen Container startet es nie. Ist der neue Server dabei schon
   angelegt, liegt ein halbfertiges neues Volume da — die Meldung nennt den Befehl, es zu
   entfernen; danach das Skript erneut.
3. **Stack starten** — Pilot: `PUBLIC_HOST=<domain> ACME_EMAIL=<adresse> bash
   deploy/vm/deploy.sh` (baut neu, stellt den Realm ein, prüft die Erreichbarkeit);
   Konzern-VM: `make prod`. Keycloak hebt sein eigenes Schema beim ersten Start selbst an —
   das dauert auf der kleinen VM bis zu einigen Minuten.

**Meldet das Skript „enthält keinen Bestand von PostgreSQL 16“** (etwa bei einem Volume aus
der MariaDB-Zeit, ADR-0027): Dann gibt es nichts umzuziehen, die Sperre gilt aber weiter,
solange das Volume liegt. Wer mit leerer Datenbank neu beginnt, entfernt es bewusst —
`cd / && docker compose -p stoerungsinfo down` (hält den Stack an, ohne die Compose-Dateien
zu lesen; die neuen können eine ältere `.env` abweisen), dann `docker volume rm
stoerungsinfo_db_data`. Dessen Daten sind damit weg.

**Rückweg**, solange das alte Volume liegt: Stack stoppen (`docker compose … down`), die
Zeile `PG_UMZUG_ERLEDIGT=1` aus der `.env` nehmen, den vorigen Stand des Codes zurückholen
(Pilot: das aufgehobene Archiv; sonst auschecken) und mit `deploy.sh` bzw. `make prod`
starten — beide bauen die Images neu, und der alte Server findet sein Volume `db_data` vor.
`demo-mode.sh start` genügt hier nicht: Unter den Tags liegen noch die Images des neuen
Stands, und PostgreSQL 18 verweigert das alte Volume. Was seit dem Umzug geschrieben wurde,
ist dann weg. Für Keycloak ist das der einzige vorgesehene Weg zurück: Die alte Version
startet auf dem angehobenen Schema zwar, warnt aber („Possibly incorrect state of
migration“).

**Später**, wenn Sicherungen vom neuen Stand vorliegen: `docker volume rm
stoerungsinfo_db_data` und den Dump des Umzugs löschen (er enthält die Konten im Klartext).

---

## 3. Backup & Restore

Die Sicherung auf der VM ist das dauerhafte Konzept, auch in PROD (ADR-0030).

* **Backup**: `ops/backup.sh` legt einen Dump unter
  `/var/backups/stoerungsinfo/stoerungsinfo_<datum>_<zeit>.sql.gz` ab (Rechte `600`, weil
  er personenbezogene Klartextdaten und Passwort-Hashes enthält). Gesichert werden
  `newsletter` und — falls vorhanden — `keycloak`. Als nächtlichen Cron einrichten (User
  root):
  `0 2 * * * /opt/stoerungsinfo/ops/backup.sh >> /var/log/stoerungsinfo-backup.log 2>&1`
* **Sicherung der VM**: Die Ziel-VM wird wie alle Linux- und Windows-VMs des Unternehmens
  täglich und stündlich vom Tivoli Storage Manager gesichert (Auftraggeber, 2026-10-12).
  Der Dump liegt auf der VM und ist damit Teil dieser Sicherung — ebenso die
  Empfängerliste für den Notfall-Versand (Abschnitt 4). Eine eigene Kopie außerhalb der
  VM legt die Anwendung nicht an; nach Entscheidung des Auftraggebers ist dafür derzeit
  nichts weiter zu tun. Für die öffentliche Testmaschine (Abschnitt 3c) gilt das nicht.
* **Geprobt** ist der Weg Dump → frischer Cluster → Einspielen einmal, beim Umzug auf
  PostgreSQL 18 (Abschnitt 2, 2026-10-12): mit `deploy/vm/pg-umzug.sh` und dem
  Pilot-Overlay auf einem eigens gebauten Bestand (PostgreSQL 16.15, Schema und
  Beispieldaten der Anwendung, dazu Schema und Realm eines echten Keycloak 26.4.7).
  Zeilenzahlen und Sequenzstände aller 100 Tabellen und Sequenzen stimmten überein; danach
  startete Keycloak 26.8.0 auf dem umgezogenen Bestand, hob sein Schema an und kannte die
  Konten noch. In einer zweiten Probe stammte der alte Bestand aus dem Compose-Stack des
  vorigen Code-Stands (PostgreSQL 16.13); dabei lief auch der Rückweg aus Abschnitt 2
  durch. **Nicht geprobt:** mit dem echten Bestand der Pilot-VM, der Lauf von `deploy.sh`
  bzw. `make prod` danach und ein Restore aus der Sicherung der VM. `backup.sh`
  erinnert nach jedem Dump daran. Die Schritte unten taugen für eine Probe nicht
  unverändert: Sie löschen den laufenden Bestand.
* **Restore**: Der Dump enthält Schema und Daten je Datenbank (mit vorangestelltem
  `\connect`), aber **keine Rollen und kein `CREATE DATABASE`** — die legt das Init-Skript
  des Images beim ersten Start des frischen Clusters an. Also erst `pg_data` leeren, den
  Postgres-Container hochfahren (Init-Skript erzeugt Rollen + leere DBs `newsletter`/
  `keycloak`) und dann als Superuser einspielen (die Befehle zeigen den öffentlichen
  Pilot; auf der Konzern-VM steht in `P` `compose.prod.yaml` statt `compose.public.yaml`):
  ```bash
  cd /opt/stoerungsinfo
  P="docker compose -f compose.yaml -f compose.db.yaml -f compose.public.yaml"
  $P down
  docker volume rm stoerungsinfo_pg_data
  $P up -d postgres                              # Init-Skript: Rollen + leere DBs
  # Über TCP warten: Der Hilfsserver des ersten Starts ist nur über den Unix-Socket
  # erreichbar (`--wait` und pg_isready ohne -h meldeten ihn schon als bereit), und ein
  # Restore, der dann beginnt, bräche ab, sobald er dem echten Server weicht.
  for i in $(seq 1 60); do $P exec -T postgres pg_isready -h 127.0.0.1 -U postgres -q && break; sleep 2; done
  gunzip -c /var/backups/stoerungsinfo/stoerungsinfo_<datum>_<zeit>.sql.gz | \
    $P exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=0
  $P up -d --wait                                # restliche Container starten
  ```
  Der Restore muss **vor** dem ersten `api`-Start laufen: Die Migration käme sonst dem
  Dump zuvor und die Tabellen existierten bereits. Nach dem Restore steht die
  Alembic-Version aus dem Dump — der Migrations-Schritt beim `api`-Start ist dann ein No-op.

---

## 3b. Versand über ein echtes Postfach (Abnahme/Demo)

Vier **unabhängige** Schalter in der `.env` — nicht verwechseln:

| Schalter | Bedeutung |
|---|---|
| `MAIL_FROM` / `MAIL_FROM_NAME` | **Absender** der Mails (`From:`-Header) |
| `SMTP_*` | **Wer transportiert** — Mailpit (sammelt, stellt nicht zu) oder ein echter Server |
| `MAIL_REDIRECT_TO` | **Umleitung aller Mails** an eine Adresse statt an die Abonnenten (Default: aus) |
| `SMTP_MAX_PER_DAY` | **Obergrenze** der Mails in 24 Stunden — was darüber liegt, wird nicht gesendet (Default: `0` = keine) |

### Absender setzen

Reine Konfiguration, sofort wirksam nach Neustart:

```dotenv
MAIL_FROM=<absender@example.de>
MAIL_FROM_NAME="Störungsinfo (Test)"
```

Werte mit Leerzeichen oder Klammern gehören in Anführungszeichen: Die Skripte unter
`deploy/vm/` und `ops/backup.sh` lesen die `.env` mit der Shell ein.

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
  DELETE FROM subscriptions s USING users u
      WHERE u.id = s.user_id AND u.email LIKE '%@example.corp';
  UPDATE users SET is_active = false WHERE email LIKE '%@example.corp';
  ```

* **Login reaktiviert Testuser.** Meldet sich jemand per SSO an, wird sein Datensatz
  per JIT wieder aktiv (ADR-0010) — eine Anmeldung als `admin1` macht
  `admin1@example.corp` also erneut zum Empfänger von Pflicht-Verteilern. Nach
  Anmeldungen erneut aufräumen, oder dauerhaft absichern mit
  `MAIL_REDIRECT_TO=<eigene@adresse>`: dann gehen alle Mails ausschließlich dorthin,
  Bounces sind ausgeschlossen und `X-Original-Recipient` zeigt den gedachten Empfänger.

* **Integrationstests verändern Abos** (sie abonnieren/kündigen KAP für die Testuser)
  und würden mit echtem SMTP Mails nach außen schicken. Der Session-Guard bricht sie
  deshalb ab, solange `SMTP_HOST` nicht `mailpit` ist — ebenso, solange eine Umleitung
  oder ein Tageslimit gesetzt ist: Damit scheiterten die Tests auch über Mailpit.

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
Erlaubt ist genau eine Adresse; mit einer Liste oder einem Anzeigenamen startet die
Anwendung nicht. **In Produktion leer lassen.**

### Tageslimit (Testversand über ein privates Postfach)

`SMTP_MAX_PER_DAY=<n>` begrenzt, wie viele Mails der Versand innerhalb von 24 Stunden an
den SMTP-Server übergibt ([ADR-0032](adr/0032-tageslimit-fuer-testversand.md)). Gezählt
wird aus der Datenbank — über alle Versände und über Neustarts hinweg, umgeleitete Mails
eingeschlossen. Ist die Grenze erreicht, werden die übrigen Empfänger **nicht** beliefert
und in der Historie als fehlgeschlagen geführt; nachgesendet wird nichts.
**In Produktion `0` lassen** — sonst gehen Störungsmeldungen verloren.

Für einen Testversand über ein privates Postfach beides setzen:

```dotenv
SMTP_MAX_PER_DAY=5
MAIL_REDIRECT_TO=<eigene@adresse>
```

Danach den Stack neu starten und — wo Keycloak einen Mailserver hat — das Realm-Skript
laufen lassen (siehe unten).

**Was gezählt wird:** jede Mail der letzten 24 Stunden, die der Versand als übergeben
vermerkt hat, gleich über welchen Server sie ging. Wer vorher über Mailpit getestet hat
und dann auf das private Postfach umstellt, hat diese Mails noch im Zähler: Der erste
echte Versand kann als „Fehlgeschlagen 0/n“ enden, ohne dass eine Mail das Postfach
berührt hat. So viele zählen gerade:

```sql
SELECT count(*) FROM dispatch_recipients
WHERE status = 'sent' AND sent_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours';
```

Nicht gezählt wird die Testmail von `check_smtp.py --send-to` — und eine Mail, die der
Server annahm, deren Bestätigung aber verloren ging (ADR-0032).

**Warum ein Versand gescheitert ist,** zeigt die Versand-Maske nicht — dort steht nur
„Fehlgeschlagen“ oder „Mit Fehlern“. Der Grund steht im Log des api-Containers, eine Zeile
je betroffenem Versand (`docker compose … logs api | grep "Tageslimit erreicht"`):

```
Versand 12: Tageslimit erreicht (SMTP_MAX_PER_DAY=5) — 3 Empfänger nicht gesendet
```

und je Empfänger in der Datenbank:

```sql
-- Gründe der nicht belieferten Empfänger je Versand, neueste zuerst
SELECT dispatch_id, last_error, count(*) AS empfaenger
FROM dispatch_recipients
WHERE status = 'failed'
GROUP BY dispatch_id, last_error
ORDER BY dispatch_id DESC
LIMIT 20;
```

**Welches Limit gilt,** steht in der Startzeile des Workers im api-Log:
`Outbox-Worker gestartet (Poll-Intervall 5.0s, Tageslimit: 5 Mails in 24 Stunden)` bzw.
`… kein Tageslimit)`. `python backend/scripts/check_smtp.py` zeigt den Wert aus der `.env`
— er gilt erst nach dem Neustart.

**Keycloak sendet mit gesetztem Limit keine eigenen Mails** — sie gingen über dasselbe
Postfach und würden nicht mitgezählt. Die Realm-Skripte richten den Realm dann ohne
Mailserver ein und schalten „Passwort vergessen“ ab; umgestellt wird erst, wenn sie laufen:

* lokal: `python ops/configure_dev_realm.py` (nur nötig, wenn der DEV-Realm je den
  Mailserver aus der `.env` bekommen hat — frisch importiert hat er keinen);
* Pilot-VM (3c): das Limit über einen erneuten Lauf von `deploy.sh` setzen und wieder
  aufheben, nicht nur in der `.env` — `demo-mode.sh start` stellt den Realm nicht um:
  `PUBLIC_HOST=<domain> ACME_EMAIL=<adresse> SMTP_MAX_PER_DAY=5 bash deploy/vm/deploy.sh`
  (bzw. `=0`; die beiden ersten Angaben verlangt das Skript bei jedem Lauf). Ob Keycloak
  umgestellt ist, zeigt die Ausgabe (`Tageslimit gesetzt (SMTP_MAX_PER_DAY=5): Realm ohne
  Mailserver, Passwort-Reset abgeschaltet — …`) und die Anmeldeseite: Der Link „Passwort
  vergessen“ fehlt. Bricht `deploy.sh` vorher ab, ist Keycloak NICHT umgestellt. Wer in
  dieser Zeit sein Passwort vergisst, bekommt ein neues über
  `bash deploy/vm/create-user.sh <email>`.

**Immer:** Nach `.env`-Änderungen neu starten (`make dev` bzw. `make prod`) —
die Konfiguration wird beim Start gelesen. Nach Codeänderungen zusätzlich `--build`,
weil Code und Frontend ins Image gebacken sind.

## 3c. Öffentlich erreichbarer Pilotbetrieb (Internet-VM)

Für Demos außerhalb des Konzernnetzes läuft eine eigene Variante: `compose.public.yaml`.
Unterschied zu `compose.prod.yaml`: Keycloak läuft mit (es gibt keinen Konzern-IdP),
das Zertifikat kommt von Let's Encrypt statt aus der Konzern-PKI, und die Speicher-
limits sind auf eine kleine VM (1,8 GB RAM) ausgelegt.

**Aktuelle Instanz:** `https://kunden-stoerungs-info.com`
(Ubuntu 26.04, 2 vCPU, 1,8 GB RAM + 2 GB Swap). Die Origin-Adresse der VM wird nicht im
Repository geführt: Die VM steht hinter Cloudflare, und das Repository ist öffentlich.

### Aufbau von null

```bash
# 1. VM grundausstatten (Docker, Swap, Firewall 22/80/443, SSH nur Key, fail2ban)
scp deploy/vm/bootstrap.sh root@<host>:/tmp/ && ssh root@<host> bash /tmp/bootstrap.sh

# 2. DNS: A-Record der Domain auf die VM-IP (bei Cloudflare zunächst "DNS only",
#    sonst schlägt die Zertifikatsausstellung fehl)

# 3. Code auf die VM bringen (kein Registry-Zugang nötig)
tar --exclude=.git --exclude=.env --exclude=frontend/tests -czf /tmp/app.tgz compose*.yaml backend frontend \
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

Zum Realm gehört seit ADR-0028 „nur E-Mail und Passwort“: `configure-realm.sh` leert
gespeicherte Namen, nimmt Vor-/Nachname aus dem Benutzerprofil und den Scope `profile` vom
Client. Die Anwendung muss dafür schon auf dem neuen Stand laufen (sie fragt `profile`
nicht mehr an) — `deploy.sh` hält diese Reihenfolge ein, und `configure-realm.sh` bricht
vor dem Umbau ab, solange die laufende Anwendung `profile` noch anfragt. `create-user.sh` erst
danach verwenden: Gegen einen noch nicht umgestellten Realm bleibt ein Konto ohne Namen beim
Login an „Update Account Information“ hängen.

### Betriebseigenschaften

| Thema | Umsetzung |
|---|---|
| **TLS** | NGINX terminiert; Zertifikat im Volume `certbot_conf`. Der TLS-Serverblock wird erst aktiv, wenn ein Zertifikat existiert (`entrypoint-public.sh`) — sonst könnte NGINX nicht starten und die ACME-Prüfung nie beantworten. |
| **Erneuerung** | `deploy/vm/renew-cert.sh` per Cron: erneuert und **lädt NGINX neu**. Ohne den Reload würde NGINX das neue Zertifikat nicht verwenden und der Dienst nach 90 Tagen ausfallen. |
| **Keycloak** | Produktionsmodus, Speicher in PostgreSQL (Datenbank `keycloak`), erreichbar unter `/idp`. Adminkonsole und `/idp/metrics` sind per NGINX mit 404 blockiert. |
| **Adminkonsole** | Nur über SSH-Tunnel: `ssh -L 8081:localhost:8081 root@<host>`, dann `http://localhost:8081/idp/`. Zugangsdaten: `KEYCLOAK_ADMIN*` in der `.env`. |
| **Secrets** | Alle in `/opt/stoerungsinfo/.env` (`chmod 600`), beim ersten Deploy per `openssl rand` erzeugt. Keine Dev-Werte, nichts aus dem Repo. |
| **Registrierung** | Offen und **ohne** Bestätigungsmail (Entscheidung des Auftraggebers, ADR-0021) — eine Adresse muss also niemandem gehören. Brute-Force-Schutz ist an. Abschalten: `registrationAllowed` per Keycloak-Adminkonsole oder `configure-realm.sh`. |
| **Speicher** | Limits: nginx 96 MB, api 320 MB, postgres 288 MB, keycloak 640 MB, certbot 128 MB. Im Betrieb ~1,1 GB belegt, Swap als Puffer. |
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
# 1. Konto anlegen (festes Passwort)
bash deploy/vm/create-user.sh <mail> --password "<pw>"
# 2. Adminrechte gibt das Portal, nicht das Skript: als Admin anmelden und in
#    /rollen.html das Häkchen setzen. Kontrolle per SQL: Abschnitt 6b.

# nach der Demo sperren — Abos und Historie bleiben erhalten
bash deploy/vm/create-user.sh <mail> --disable
bash deploy/vm/create-user.sh <mail> --enable    # wieder freigeben
```

`--disable` sperrt die Anmeldung im IdP **und** setzt `users.is_active = false` im Portal.
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

> **Warum die Ports in `compose.public.yaml` auf `0.0.0.0` gebunden sind:** Ohne die
> explizite Adresse bindet Docker zusätzlich `[::]`. Diese IPv6-Verbindungen bedient der
> userland `docker-proxy` über INPUT — an der Kette in `DOCKER-USER` (FORWARD) vorbei,
> in der die Cloudflare-Beschränkung steht. Der Origin war dadurch über IPv6 direkt
> erreichbar, während die IPv4-Prüfung Erfolg meldete. Wer die Ports-Zeile ändert,
> öffnet das wieder. Gegenprobe gehört von AUSSEN gefahren, nicht von der VM:
> `curl -6 -sk --max-time 8 https://[<origin-v6>]/healthz` muss scheitern.

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

* **Keine Demo-Konten.** Der importierte Realm bringt DEV-Testnutzer mit dem bekannten
  Passwort `test` mit. Öffentlich könnte sich damit jeder anmelden — und `admin1@example.corp`
  würde Admin, wo die Adresse noch in `ADMIN_BOOTSTRAP_EMAILS` steht und kein Admin
  existiert. `configure-realm.sh` löscht alle Konten
  mit Beispiel-Domain bei **jedem** Deploy und bricht ab, falls eines übrig bleibt.
* **Allowlist statt Blockliste für `/idp`.** Nur Anmeldung, Registrierung, Protokoll-
  und Theme-Pfade des Realms `dev` werden durchgereicht; alles andere endet mit 404 —
  Adminkonsole, Admin-REST-API, `master`-Realm, Metriken, Health. Eine frühere
  Regex-Blockliste war per Matrix-Parameter (`/idp/admin;x/...`) umgehbar; `^~`-Präfixe
  erfassen solche Varianten. **Nicht auf eine Blockliste zurückbauen.**
* **Ratenlimits.** Ein Passwort-Reset löst je Aufruf eine Mail über das konfigurierte
  Postfach aus (die Registrierung nur, wenn die Bestätigungsmail eingeschaltet ist) —
  ohne Bremse ließe sich der Dienst als Mailversender für Fremde missbrauchen und das
  Tageskontingent des Kontos in Sekunden verbrauchen. Wichtig: `SMTP_MAX_PER_MINUTE`
  und `SMTP_MAX_PER_DAY` greifen hier **nicht**, weil Keycloak über seinen eigenen
  SMTP-Zugang sendet, nicht über den Outbox-Worker. Die Ratenlimits gelten je
  Client-Adresse und Minute, nicht je Tag; mit gesetztem Tageslimit sendet Keycloak
  deshalb gar nicht (Abschnitt 3b).
* **X-Forwarded-For wird gesetzt, nicht angehängt.** Sonst könnte ein Client eine fremde
  IP voranstellen und damit Brute-Force-Zähler und Ratenlimits auf eine andere Adresse
  umlenken.
* **Der API-Container erhält nur seine eigenen Variablen** (keine Datenbank-Root- und
  Keycloak-Adminpasswörter mehr über `env_file`).
* **Tageskontingent des Mailkontos**: Meldungen wie `550 5.4.5 Daily user sending limit
  exceeded` werden als vorübergehend behandelt, damit der Backoff greift statt alle
  restlichen Empfänger endgültig als fehlgeschlagen zu verbuchen.

### Verteiler `technische-pruefung` — nicht anfassen

Auf der Instanz liegt ein Verteiler „Technischer Prüfversand (nicht abonnieren)" mit
**genau einem Abonnenten**. Die Verifikation nach einem Deploy versendet darüber, damit
ein Prüflauf genau **eine** Mail erzeugt.

Warum nicht über einen echten Verteiler: Pflicht-Verteiler lösen auf *alle aktiven
Empfänger* auf. Sobald sich Fremde selbst registrieren — bei offener Registrierung der
Normalfall — schickt jeder Prüflauf echte Mails an Menschen, die nichts damit zu tun
haben. Genau das ist passiert, bevor dieser Verteiler existierte.

Und warum nicht `MAIL_REDIRECT_TO`: Das erzeugt weiterhin eine Mail **je** Empfänger,
nur alle an dieselbe Adresse — bei 5.000 Abonnenten also 5.000 Mails in ein Postfach.

Zwei Dinge dürfen mit ihm nicht passieren: **nicht abonnieren** und **nicht auf Pflicht
umstellen**. Beides würde die Empfängerzahl erhöhen. Das Prüfskript verweigert dann den
Versand und meldet einen Fehlschlag, statt stillschweigend mehr Mails zu verschicken.

### Bewusst offene Türen dieser Testmaschine

Drei Entscheidungen des Auftraggebers machen die Instanz leichter bedienbar und
gleichzeitig angreifbar. Sie stehen hier zusammen, damit sie beim Schritt zu einem
produktiven Betrieb nicht einzeln übersehen werden — **jede einzelne muss dann fallen:**

1. **Registrierung offen** (`registrationAllowed: true`) — bewusst offen gehalten für
   den Demo-Betrieb (Betreiber-Entscheidung, 2026-08-12).
2. **Keine Mailbestätigung** (`verifyEmail: false`, ADR-0021) — eine Adresse muss
   niemandem gehören.
3. **Adressen auf `@demo.invalid` erhalten beim Login automatisch Adminrechte**
   (`backend/app/domain/users.py`, `DEMO_ADMIN_SUFFIX`). Anders als
   `ADMIN_BOOTSTRAP_EMAILS` ist das keine Notfallregel, sondern dauerhaft offen. Die
   Demo-Admins `admin1`–`admin6@demo.invalid` teilen ein Passwort (privater Kanal).

Zusammen ergeben sie einen Weg aus dem offenen Internet zu vollen Adminrechten:
registrieren mit `irgendwas@demo.invalid`, keine Bestätigung nötig, anmelden — fertig.

Für die Testmaschine ist das abgewogen und akzeptiert. **Absicherung, die bleibt:** Das
früher im README dokumentierte Demo-Passwort ist rotiert und aus dem öffentlichen Repo
entfernt (der alte Wert in der Git-Historie ist wertlos); außerhalb von Vorführungen den
Stack gestoppt halten (`demo-mode.sh stop`). Im Zielbild mit AD-Anbindung (offene Frage
B1) entfallen Punkt 1 und 2 von selbst; Punkt 3 muss aktiv aus dem Code entfernt werden.

### Weg zurück, wenn ein Deploy schiefgeht

Über den Wechsel auf PostgreSQL 18 und Keycloak 26.8 hinweg gilt ein anderer Rückweg: der
aus Abschnitt 2 (altes Volume `db_data` und das vorige Archiv). Der Dump, den `deploy.sh`
bei diesem Lauf zieht, stammt schon vom umgezogenen Bestand; den Stand davor hält der Dump
von `pg-umzug.sh`. Ist das alte Volume gelöscht, führt kein Weg mehr unter diese beiden
Versionen zurück.

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

Liegt der vorige Stand vor ADR-0028, fragt er noch den Scope `profile` an. Hat
`configure-realm.sh` den Realm schon umgestellt, endet damit jede Anmeldung mit
`invalid_scope`: Dann den Dump von **vor** der Umstellung einspielen (er enthält auch die
Datenbank `keycloak`) oder dem Client den Scope `profile` wieder zuweisen.

### Offene Punkte für diese Instanz

* **Backup ist nicht automatisiert.** `ops/backup.sh` sichert beide Datenbanken
  (`newsletter` und `keycloak` — ohne die zweite gäbe es nach einem Restore keine
  Konten mehr), und `deploy.sh` zieht vor jedem Ausrollen einen Dump. Für Dauerbetrieb
  als Cron einrichten und eine Kopie außerhalb der VM ablegen — Cron-Zeile und was für
  die Kopie fehlt: Abschnitt 3.
* **`.env` existiert nur auf der VM.** Geht sie verloren, passen die generierten
  Passwörter nicht mehr zu den Daten in den Volumes (das Init-Skript vergibt die
  DB-Passwörter nur bei leerem Datenverzeichnis). Verschlüsselte Kopie anlegen.
* **Offene Selbstregistrierung** ist eine bewusste Entscheidung. Wer sich registriert,
  wird Empfänger der Pflicht-Verteiler. Abschalten über die Keycloak-Adminkonsole
  (SSH-Tunnel) oder `registrationAllowed: False` in `configure-realm.sh`.
* **Images werden auf der VM gebaut.** Während des Builds konkurriert `pip install` mit
  PostgreSQL und Keycloak um 1,8 GB RAM. Bei Problemen den Stack vor dem Build stoppen
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
   WHERE s.topic_id = '<topic>' AND u.is_active
   UNION
   SELECT email FROM users WHERE is_active
     AND (SELECT is_mandatory FROM topics WHERE id = '<topic>');
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

## 5b. Lockfile, Stücklisten & Schwachstellenbericht (Lieferkette, ADR-0026)

`requirements.txt` ist die menschenlesbare Quelle. Nach **jeder** Änderung daran — und nach
jedem Anheben eines Basis-Image — das Lockfile und die Unterlagen in `docs/governance/` neu
erzeugen:

```sh
# 1. Gepinntes, gehashtes Lockfile aus requirements.txt — im Basis-Image aus
#    backend/Dockerfile, damit die aufgelösten Versionen zum Laufzeit-Image passen.
#    Bestehende Pins bleiben stehen; ein einzelnes Paket hebt
#    `--upgrade-package <name>` an (etwa nach einer Sicherheitsmeldung), alle zusammen
#    hebt `--upgrade` an. Nicht pip-tools 7.6.1 mit click ab 8.5: Die Paarung schreibt
#    ein nie übergebenes `--no-index` in die Kopfzeile des Lockfiles.
docker run --rm -v "$PWD/backend:/w" -w /w python:3.14.8-slim sh -c '
  pip install -q pip-tools==7.6.2 &&
  pip-compile --generate-hashes --strip-extras -o requirements.lock requirements.txt'

# 2. Stücklisten, Komponentenliste und Schwachstellenbericht
make governance                      # Windows: .\make.ps1 governance
```

Der Container-Build zieht das Lockfile automatisch (`--require-hashes`, Dockerfile). Unter
Windows im OneDrive-Pfad verweigert Docker Desktop den Bind-Mount (`-v`) in Schritt 1: die
Dateien stattdessen mit `docker cp` in einen per `docker create` angelegten Container hinein-
und das Ergebnis wieder herauskopieren. Schritt 2 kommt ohne Bind-Mount aus.

Schritt 2 läuft auf einem Entwicklerrechner, nicht auf der VM: Er braucht einen Git-Checkout
(die Unterlagen nennen den Commit), Docker mit `buildx`, Python ab 3.11, eine `.env` für
`docker compose build` und die bestehende `docs/governance/stoerungsinfo-app.cdx.json`. Am
besten auf einem eingecheckten Stand laufen lassen — sonst tragen die Unterlagen den Vermerk
„mit nicht eingecheckten Änderungen“ (in der Stückliste: `-dirty`).

**Was `make governance` tut** (`ops/governance.py erzeuge`, nach dem Bau der Images unter
dem Tag `local`, gleich was `IMAGE_TAG` in der `.env` sagt):

* **Stückliste der Anwendung** (`stoerungsinfo-app.cdx.json`, CycloneDX 1.6): `cyclonedx-bom`
  7.5.0 liest die Python-Umgebung im gebauten Image. Das Skript ergänzt je Paket die Autoren
  (aus den Metadaten des Pakets, ohne Adressen) und das, was das Paket in seiner eigenen
  Stückliste nennt, und setzt die Anwendung als Wurzel. Name, Version und Herausgeber der
  Wurzel übernimmt es aus der bestehenden Datei; der Commit darin ist der Stand, auf dem
  erzeugt wurde.
* **Stückliste und Scan je Image** mit Trivy — per Digest gepinnt, als Container, ohne
  Docker-Socket: Das Image geht als Archiv hinein, der Scan läuft ohne Netz. Vorher lädt das
  Skript die Schwachstellen-Datenbank in das Volume `stoerungsinfo-trivy-cache` (gut 1 GB
  Download, rund 3 GB belegt; die Datenbank gilt einen bis drei Tage, danach lädt der
  nächste Lauf sie neu. `docker volume rm stoerungsinfo-trivy-cache` gibt den Platz frei).
  Erreichbar sein müssen: Docker Hub (Scanner-Image), `mirror.gcr.io` oder ersatzweise
  `ghcr.io` (Datenbank), `pypi.org` und `files.pythonhosted.org` (Werkzeug der Stückliste).
  Ob ein Basis-Image noch aktuell ist, fragt das Skript bei dessen Registry ab (Docker Hub,
  `quay.io`); ohne Antwort steht im Bericht „nicht geprüft“.
* **`KOMPONENTEN.md` und `SCHWACHSTELLEN.md`** aus diesen Dateien.

**Danach von Hand:** In `SCHWACHSTELLEN.md`, Abschnitt 3, steht jede Lücke einmal, die
CRITICAL, HIGH oder noch nicht eingestuft ist (UNKNOWN). Was dort „in Prüfung“ heißt, ist
neu und braucht einen Eintrag in `schwachstellen-bewertung.toml` (der Kopf der Datei erklärt
die Felder); der letzte Abschnitt, „Bewertungen ohne Fund“, nennt Einträge und Kennungen,
die auf keinen Fund mehr zutreffen. Abschnitt 4 trägt Angaben von Hand zu dem, was der
Scanner nicht sieht — meldet er dort „Veraltet“, ist die Angabe für die neue Version neu zu
prüfen. Dann genügt

```sh
python ops/governance.py bericht      # schreibt nur die beiden Markdown-Dokumente neu
```

`make test` prüft, dass `requirements.txt`, Lockfile und Stückliste zueinander passen, dass
der Scan die Basis-Images aus den vier Dockerfiles der untersuchten Images beschreibt und
dass beide Markdown-Dokumente dem entsprechen, was das Skript aus den Dateien daneben
schreibt. Nicht erfasst: neue Versionen von Mailpit und Certbot (unverändert bezogene
Images, nicht im Scan).

**Trivy anheben:** Version und Digest stehen in `ops/governance.py` (`TRIVY`); den Digest
liefert `docker buildx imagetools inspect aquasec/trivy:<version>`. Immer per Digest beziehen:
Im März 2026 lagen unter den Tags 0.69.4 bis 0.69.6 manipulierte Images
(GHSA-69fq-xp46-6x23).

## 5c. Testwerkzeug der Frontend-Tests anheben (ADR-0029)

Playwright ist in `frontend/tests/package.json` exakt gepinnt. Weil sich der Browser der
Entwicklerrechner selbst aktualisiert, gehört das Anheben zur Routine:

```sh
cd frontend/tests
# 1. Version in package.json ändern, dann das Lockfile neu schreiben
npm install --package-lock-only
# 2. Installieren, Herkunft der installierten Pakete prüfen (Registry-Signaturen),
#    erst dann die Tests laufen lassen
npm ci && npm audit signatures && npm test
```

Die CI lädt das Chromium, das zur gepinnten Version gehört (`make install-frontend-browser`);
dort ändert sich nichts von selbst. Nichts hiervon gelangt auf die VM.

Vor dem Anheben die Versionshinweise und die offenen Fehlerberichte der neuen Version lesen.
Stand 2026-10-12 bleibt es bei 1.63.0: 1.64.0 beendet eine Navigation nicht mehr, die mit
204 beantwortet wird (microsoft/playwright#43279) — so fangen die Tests Seitenwechsel ab
(Regel 13 in `frontend/tests/README.md`), sie blieben dort hängen.

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
VALUES ('sap-hr', 'SAP HR Störungen', 'Benachrichtigungen zu HR-Systemen', false, true);

-- Verteiler deaktivieren (verschwindet sofort aus Abo-Maske und Versand-Auswahl)
UPDATE topics SET is_active = false WHERE id = 'interflex';

-- Pflicht-Kennzeichen kippen (z. B. wenn der Betriebsrat das Zwangs-Abo nicht mitträgt)
UPDATE topics SET is_mandatory = false WHERE id = 'zentrale-stoerungen';
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
UPDATE users SET is_admin = true WHERE email = 'vorname.nachname@example.corp';

-- Kontrolle: wer hat das Portal-Kennzeichen?
SELECT id, email, is_active, is_admin FROM users WHERE is_admin;
```

Wirkt sofort — die Autorisierung liest das Kennzeichen bei jeder Anfrage. Die
Navigationspunkte erscheinen nach einem Neuladen der Seite. Ist der Empfänger
deaktiviert (`is_active = false`), zuerst reaktivieren, sonst endet die Anmeldung an
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
