# [ADR-0030] PostgreSQL im Container — auch in PROD, kein Umzug auf eine externe Datenbank

* **Status:** Akzeptiert (überholt die Aussagen zum DB-Cutover in
  [ADR-0011](0011-alembic-ab-tag-1.md) und zur externen Konzern-DB in
  [ADR-0027](0027-postgresql-statt-mariadb.md); beide gelten sonst weiter)
* **Datum:** 2026-10-07
* **Kontext:** Der Umsetzungsplan sah für die Datenbank zwei Phasen vor: Start mit einem
  Container auf der VM, später Umzug auf eine externe Datenbank des Konzerns (Plan 3.1, 3.2
  und 9.4, Frage B3). Darauf waren das Makefile (`prod-localdb` als Go-Live-Zustand, `prod` ohne
  DB-Overlay), RUNBOOK 2 (Cutover-Prozedur), die Egress-Matrix (Zeile Backend → Datenbank)
  und die Kommentare in `.env.example`, den Compose-Dateien und `ops/backup.sh` ausgerichtet.
  Entscheidung des Auftraggebers, mitgeteilt am 2026-10-07: PostgreSQL läuft auch in
  Produktion in Docker auf derselben Maschine wie die Anwendung.

## Entscheidung

PostgreSQL läuft in jeder Umgebung — DEV, öffentlicher Pilot, PROD — als Container auf der VM
der Anwendung (`compose.db.yaml`, Volume `pg_data`). Der Umzug auf eine externe Datenbank
entfällt.

* **Ein Aufruf:** `make prod` startet die PROD-Konfiguration mit dem DB-Overlay.
  `make prod-localdb` bleibt als zweiter Name dafür; die Variante ohne DB-Overlay gibt es
  nicht mehr.
* **`DATABASE_URL` bleibt konfigurierbar** — das kostet nichts. Eine externe Datenbank ist
  aber nicht geplant: Makefile, RUNBOOK und Sicherung setzen den Container `postgres` voraus.
* **Doku:** RUNBOOK 2 beschreibt statt der Cutover-Prozedur, wo die Datenbank läuft (die
  Abschnittsnummer bleibt); die Egress-Matrix führt keine Datenbankverbindung mehr.
* Der historische Plan bleibt unverändert stehen; die älteren ADRs werden nicht umgeschrieben
  (ADR-0011 und ADR-0027 tragen einen Nachtrag, der hierher zeigt).

## Konsequenzen

* **Positiv:**
  * Die Datenbankverbindung bleibt im Docker-Netz der VM, der Container veröffentlicht keinen
    Port. Dafür braucht es keine Firewall-Freischaltung, und die Punkte aus B3 (Version,
    TLS-Pflicht, Rechte des DB-Kontos) sind keine Fragen an Dritte mehr.
  * Keine Abhängigkeit von einem Datenbank-Team, weder für den Go-Live noch im Betrieb.
  * Eine Betriebsform für DEV, Pilot und PROD: überall dasselbe Postgres-Image mit
    Init-Skript und derselbe Migrationsweg; Pilot und PROD sichern mit demselben Skript.
* **Negativ / Risiken:**
  * **Sicherung und Wiederherstellung auf der VM sind das dauerhafte Konzept, kein Übergang
    mehr:** `ops/backup.sh` per Cron, Restore nach RUNBOOK 3. Das Skript legt den Dump unter
    `/var/backups/stoerungsinfo` ab — auf derselben Maschine wie die Datenbank — und löscht
    ihn nach 14 Tagen.
    * **Eine Kopie außerhalb der VM** legt die Anwendung nicht an. Dafür steht die
      Sicherung der VM: Der Tivoli Storage Manager sichert alle Linux- und Windows-VMs
      des Unternehmens täglich und stündlich, also auch diese samt Datenbank-Volume und
      Dumps (Auftraggeber, 2026-10-12 — weitere Vorkehrungen sind derzeit nicht verlangt).
      Daran hängt auch der Notfall-Versand (RUNBOOK 4): Antwortet die Datenbank nicht mehr,
      nimmt er die Empfängerliste aus dem letzten Dump.

    Was fehlt:
    * **Ein regelmäßiger Restore-Test.** `backup.sh` erinnert daran; eine Prozedur dafür
      steht im RUNBOOK nicht. Einmal geprobt ist der Weg Dump → frischer Cluster →
      Einspielen beim Umzug auf PostgreSQL 18 (RUNBOOK 2 und 3, 2026-10-12) — nicht mit
      dem echten Bestand und nicht aus der Sicherung der VM.
    * **Eine Überwachung der Sicherung.** Scheitert der Cron-Lauf, steht das nur in seiner
      Logdatei; `/readyz` prüft das Alter der Sicherung nicht.
  * **Patches und Versions-Upgrades von PostgreSQL liegen beim Betrieb der Anwendung** — wer
    das ist, ist offen (Frage B7, Owner der VM). Das Image baut auf `postgres:18-alpine`,
    per Digest gepinnt (18.6; bis 2026-10-12 war es 16.15): Eine neue Unterversion kommt
    erst mit einer Änderung des Dockerfiles ins Image. Ein Major-Upgrade ist kein
    Tag-Wechsel: Der Bestand zieht per Dump auf ein neues Volume um, das alte bleibt als
    Rückweg liegen (`deploy/vm/pg-umzug.sh`, RUNBOOK 2 — zuerst für 16 → 18 geschrieben;
    bis der Umzug durch ist, verweigern die Skripte der VM, die den Stack starten, den
    Start).
  * **Datenbank und Anwendung teilen sich eine Maschine** — CPU, Speicher, Platte und den
    Ausfall. `compose.prod.yaml` gibt dem Container `postgres` Log-Rotation wie `nginx` und
    `api`, aber keine Limits für CPU und Speicher: Die Größe der Ziel-VM steht nicht fest
    (Frage B7; das Pilot-Overlay setzt für seine kleine VM ein Speicherlimit). Welche Verfügbarkeit gefordert ist, ist offen
    (Frage A5).
  * **Das Log des Datenbank-Containers gehört damit zur Anwendung** — und ADR-0014 (keine
    Empfängeradressen in Logs) gilt auch dort. In der Voreinstellung schreibt der Server zu
    einem Unique-Verstoß die DETAIL-Zeile mit dem Schlüsselwert und zu jedem Fehler den Text
    der gescheiterten Anweisung. Er startet deshalb mit `log_error_verbosity=terse` und
    `log_min_error_statement=panic` (`compose.db.yaml`, wiederholt in `compose.public.yaml`,
    per Test festgehalten). Der Client erhält die volle Fehlermeldung weiterhin; im
    Server-Log steht zu einem Fehler nur noch die ERROR-Zeile — wer dort eine Anweisung
    sucht, findet sie im Log der Anwendung (ohne Parameterwerte). Was bleibt: Die ERROR-Zeile
    zitiert, was PostgreSQL nicht einordnen kann — eine Adresse in doppelten statt einfachen
    Anführungszeichen (`column "…" does not exist`) oder im Vergleich mit einer Zahl
    (`invalid input syntax …: "…"`). Die Anwendung sendet Werte als Parameter und prüft Typen
    vorher; es trifft von Hand eingegebenes SQL (RUNBOOK 2).

## Verworfene Alternativen

* **Externe Datenbank des Konzerns (bisheriger Plan):** hätte nach der Annahme des Plans
  Sicherung und Hochverfügbarkeit an einen zentralen Betrieb abgegeben — um den Preis einer
  Firewall-Freischaltung, eines Umzugs mit Wartungsfenster und der Abhängigkeit von einem
  weiteren Team. Ob und zu welchen Bedingungen der Konzern PostgreSQL bereitstellt, ist nie
  geklärt worden (B3 blieb offen). Entscheidung des Auftraggebers.
