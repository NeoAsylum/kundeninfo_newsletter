# [ADR-0031] Idempotenter Aufruf „Versand anlegen“

* **Status:** Akzeptiert — dass die API einen wiederholten Versand erkennt, ist Entscheidung
  des Auftraggebers (Frage C2 in `open-questions.md`); die Ausgestaltung wurde mit dieser
  Änderung gewählt
* **Datum:** 2026-10-07
* **Kontext:** `POST /api/v1/admin/dispatches` legt den Versand samt Empfänger-Snapshot an,
  der Outbox-Worker verschickt danach an bis zu ~5.000 Empfänger. Geht die Antwort verloren
  (Netz, Proxy-Timeout, während der Handler noch schreibt), kann der Admin nicht wissen, ob
  der Versand angelegt wurde — und ein zweiter Aufruf legte einen zweiten an: Alle bekämen
  die Meldung doppelt. Die Versand-Maske konnte den offenen Ausgang nur anzeigen;
  ausschließen kann den Doppelversand nur die API.

## Entscheidung

* **Schlüssel im Body:** `POST /api/v1/admin/dispatches` nimmt das optionale Feld
  `idempotency_key` (UUID; alles andere ist der übliche 422). Der Client erzeugt den Wert
  zufällig und schickt ihn bei einer Wiederholung derselben Meldung unverändert mit. Er
  trägt keine Angabe zu einer Person und steht in keiner Antwort. Die Vorschau nimmt das
  Feld nicht.
* **Eindeutige Spalte:** `dispatches.idempotency_key` (UUID, nullable) mit eindeutigem Index
  — Migration 0005, additiv (ADR-0011). Der Schlüssel wird in derselben Transaktion
  gespeichert wie Versand und Empfänger-Snapshot.
* **Wiederholung antwortet 200:** Gehört der Schlüssel schon zu einem Versand, legt die API
  nichts an — keinen Versand, keine Empfängerzeilen, keinen Audit-Eintrag — und antwortet
  mit `200` und diesem Versand in der Form der `201`-Antwort, mit Status und Zählern von
  jetzt. Das wird vor den Prüfungen für einen neuen Versand entschieden: Der Verteiler darf
  inzwischen deaktiviert, umbenannt oder ohne Empfänger sein.
* **Anderer Inhalt antwortet 409:** Derselbe Schlüssel mit anderem Verteiler, Schweregrad,
  Titel oder Text endet in `409 IDEMPOTENCY_KEY_REUSED` — nie in der stillen Rückgabe des
  anderen Versands, sonst hielte der Admin die geänderte Meldung für verschickt.
* **Gleichzeitige Aufrufe:** Treffen zwei Aufrufe mit demselben Schlüssel ein, bevor der
  erste abgeschlossen ist, findet der zweite dessen Versand beim Nachsehen noch nicht. Sein
  INSERT scheitert dann am eindeutigen Index; die API liest den Versand des ersten und
  antwortet wie auf eine Wiederholung. Den Ausschluss leistet die Datenbank, nicht die
  Reihenfolge im Code.
* **Ohne Schlüssel** bleibt alles wie bisher: `201`, jedes Mal ein neuer Versand.

## Konsequenzen

* **Positiv:** Ein Aufruf, der mit demselben Schlüssel wiederholt wird, legt keinen zweiten
  Versand an — auch nicht, wenn beide Aufrufe gleichzeitig laufen. Keine neue Komponente,
  kein neues Settings-Feld, kein Aufräumjob: Der Schlüssel ist eine Spalte der
  `dispatches`-Zeile.
* **Negativ / Risiken:**
  * **Ohne Schlüssel kein Schutz.** Das Feld ist optional; ein Client, der keines schickt,
    legt mit jedem Aufruf einen Versand an wie bisher.
  * **Der Schutz reicht so weit wie das Gedächtnis des Clients.** Hält er den Schlüssel nur
    im Speicher der Seite — so die Versand-Maske zum Zeitpunkt dieser Änderung —, trägt
    dieselbe Meldung nach einem Neuladen einen neuen Schlüssel und wird ein zweiter Versand.
    Dann bleibt wie bisher der Blick in die Historie. Die Versand-Maske verwendet den
    Schlüssel außerdem nur wieder, solange sie den Versand als offen führt — genau so lange
    steht ihr Hinweis über der Historie. Das endet mit einer Bestätigung, wenn die Historie
    den Entzug des Adminrechts meldet, oder mit der ersten Abfrage der Historie, die nach
    Ablauf der Frist beginnt — ob sie gelingt oder scheitert. Die Frist beträgt zwei
    Minuten ab dem Versand ohne Bestätigung; scheitert eine Abfrage, die vor ihrem Ablauf
    begonnen hat, beginnen die zwei Minuten neu, aber nie über 15 Minuten nach diesem
    Versand hinaus (eine abgelaufene Sitzung macht die Historie dauerhaft unlesbar). Jeder
    weitere Versand ohne Bestätigung — auch die unveränderte Wiederholung — setzt beide
    Fristen neu an. Danach gilt derselbe Text als neue Meldung: Sonst antwortete die API
    noch Tage später mit dem alten Versand, die Maske meldete „Versand angelegt“, und keine
    Mail ginge raus. Eine Ablehnung (4xx) beendet den offenen Ausgang nicht.
  * **Der Inhaltsvergleich hat eine bekannte Lücke.** Gespeichert sind nur der fertige
    Betreff (`[PRÄFIX] Verteilername: Titel`) und der Text, nicht der Titel für sich.
    Verteiler, Schweregrad und Text werden exakt verglichen, der Titel als Ende des Betreffs
    (`: Titel`). Das übersteht ein Umbenennen des Verteilers; ein Vergleich über den
    heutigen Namen wiese danach jede echte Wiederholung ab. Nicht erkannt wird dafür ein
    Titel, dem nur ein vorderes Stück fehlt, das auf „: “ endet (gespeichert
    „Login: Ausfall“, neu „Ausfall“): Die API antwortet 200 mit dem vorhandenen Versand.
    Dessen Betreff steht in der Antwort.
  * **Schlüssel gelten unbefristet und nicht je Admin.** Die Retention löscht `dispatches`
    nicht (ADR-0014); ein verwendeter Schlüssel bleibt belegt, solange sein Versand besteht.
    Er ist nicht an das anlegende Konto gebunden: Wer Adminrecht hat und ihn kennt, bekommt
    den Versand zurück, den die Historie ihm ohnehin zeigt.
  * **Der Worker bleibt at-least-once** (ADR-0004): Ein Absturz zwischen SMTP-Annahme und
    Datenbank-Update kann weiterhin eine einzelne Mail doppelt senden. Diese Entscheidung
    betrifft nur das doppelte Anlegen.

## Verworfene Alternativen

* **Inhalts-Hash in einem Zeitfenster** (dieselbe Meldung binnen N Minuten gilt als
  Wiederholung): käme ohne Zutun des Clients aus, kann aber eine gewollt gleichlautende
  zweite Meldung nicht von einer Wiederholung unterscheiden. Das Fenster wäre eine geratene
  Zahl und ein Settings-Feld mehr — zu kurz verfehlt es die späte Wiederholung, zu lang
  hält es die gewollte Meldung auf.
* **Header `Idempotency-Key` statt Body-Feld:** die bei HTTP-APIs verbreitete Form. Der
  Body blieb, weil der Schlüssel hier zur Meldung gehört: Er wird mit ihr gespeichert und
  gegen sie verglichen und steht im selben Schema wie die übrigen Felder (ein ungültiger
  Wert ist derselbe 422). Den Vorteil des Headers — Clients und Zwischenstationen, die ihn
  von sich aus kennen — nutzt hier niemand: Einziger Aufrufer im Repository ist die eigene
  Versand-Maske, und dass fremde Software Versände über die API anlegt, ist nach heutigem
  Stand nicht vorgesehen.
* **Titel oder Fingerabdruck der Anfrage zusätzlich speichern:** schlösse die Lücke im
  Vergleich, kostet aber eine zweite Spalte für einen Fall, den nur ein Client auslöst, der
  einen Schlüssel für eine geänderte Meldung wiederverwendet.
