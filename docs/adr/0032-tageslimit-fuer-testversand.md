# [ADR-0032] Tageslimit für den Mailversand im Testbetrieb

* **Status:** Akzeptiert
* **Datum:** 2026-10-12
* **Kontext:** Für Tests und Vorführungen versendet das Portal über ein privates Postfach
  (RUNBOOK 3b: Gmail mit App-Passwort). Der Auftraggeber lässt das zu, solange dabei
  höchstens eine Handvoll Mails am Tag hinausgeht (2026-10-12). Das stellte bisher nichts
  sicher: `SMTP_MAX_PER_MINUTE` verteilt die Mails nur über die Zeit, `MAIL_REDIRECT_TO`
  erzeugt weiterhin eine Mail je Empfänger, und ein Versand an einen Pflicht-Verteiler hat
  so viele Empfänger, wie es aktive Konten gibt — auf der öffentlichen Testmaschine mit
  offener Registrierung also beliebig viele (RUNBOOK 3c).

## Entscheidung

Eine Einstellung `SMTP_MAX_PER_DAY` (Voreinstellung `0` = kein Limit) begrenzt, wie viele
Mails der Outbox-Worker innerhalb von 24 Stunden an den SMTP-Server übergibt.

* **Gezählt** werden die Empfängerzeilen mit Status `sent`, deren `sent_at` in den letzten
  24 Stunden liegt — aus der Datenbank, über alle Versände hinweg. Ein Neustart setzt die
  Zählung deshalb nicht zurück, und umgeleitete Mails (`MAIL_REDIRECT_TO`) zählen mit.
  Die Umleitung nimmt genau eine Adresse an — mit zweien ginge jede gezählte Mail an beide.
* **Geprüft** wird vor jeder einzelnen Mail. Der Worker ist der einzige Absender und läuft
  in genau einem Prozess (ADR-0004); zwischen Prüfen und Senden kommt ihm niemand
  dazwischen. Der Stand kommt je Batch einmal aus der Datenbank und wird im Batch
  mitgezählt.
* **Ist das Limit erreicht,** werden alle noch offenen Empfänger dieses Versands auf einmal
  endgültig als fehlgeschlagen vermerkt, mit dem Grund im Fehlertext — auch die, die nach
  einem Fehlversuch noch auf ihre Wiederholung warten. Der Versand schließt damit im selben
  Durchlauf ab (`completed_with_errors`, oder `failed`, wenn keine Mail hinausging), das
  Log erhält genau eine Warnung je Versand, und nichts wird später nachgesendet. Weil das
  Abschreiben endgültig ist, liest der Worker den Stand unmittelbar davor noch einmal aus
  der Datenbank: Sind inzwischen ältere Mails aus dem 24-Stunden-Fenster gefallen, sendet
  er weiter.
* **Keycloak sendet mit gesetztem Limit keine eigenen Mails.** Sie gingen über dasselbe
  Postfach, am Worker und seiner Zählung vorbei. Solange ein Limit gesetzt ist, richten
  die Realm-Skripte den Realm deshalb ohne Mailserver und ohne Passwort-Reset ein
  (`deploy/vm/configure-realm.sh` auf der Pilot-VM, `ops/configure_dev_realm.py` lokal).

## Konsequenzen

* **Positiv:**
  * Eine Obergrenze, unabhängig davon, wie groß ein Verteiler ist und wer den Versand
    auslöst. Die Zählung liegt in der Datenbank und übersteht jeden Neustart; sie beginnt
    nur mit einem leeren oder zurückgespielten Bestand neu.
  * Was nicht hinausging, steht in der Historie als fehlgeschlagen — der Versand bleibt
    nicht tagelang „in Arbeit“.
* **Negativ / Risiken:**
  * **Mails über dem Limit sind verloren, nicht verschoben.** Die Einstellung ist für den
    Testbetrieb gedacht; in PROD bleibt sie `0`. Wer sie dort setzt, lässt Störungsmeldungen
    fallen.
  * **Gezählt wird, was der Worker als übergeben vermerken konnte — nicht, was der Server
    angenommen hat.** Nimmt der Server eine Mail an und geht nur die Bestätigung verloren
    (die Antwort kommt nicht vor `SMTP_TIMEOUT_S`, die Verbindung bricht nach DATA ab, das
    Datenbank-Update scheitert, der Prozess stürzt ab oder wird mitten in einer Mail
    gestoppt — auch ein gewöhnlicher Neustart), ist die Mail zugestellt, aber nicht
    gezählt, und der Worker versucht sie erneut, solange das Limit nicht erreicht ist. Je
    Vorfall geht also eine Mail mehr hinaus, als gezählt wird, und der Empfänger erhält sie
    doppelt (dieselbe Lücke, die ADR-0004 für den Doppelversand nennt). Antwortete der
    Server durchgehend zu spät, griffe das Limit nicht.
  * **Nicht gezählt** wird, was nicht über den Worker dieser Instanz läuft: die eine
    Testmail von `backend/scripts/check_smtp.py --send-to` und der Versand einer zweiten
    Instanz am selben Postfach (eigene Datenbank, eigene Zählung).
  * **Keycloak wird erst umgestellt, wenn das Realm-Skript läuft** — nicht schon dadurch,
    dass die `.env` geändert und der Stack neu gestartet wird (auf der Pilot-VM:
    `deploy.sh` erneut ausführen; `demo-mode.sh start` stellt den Realm nicht um). Die
    Ratenlimits in NGINX gelten je Client-Adresse und Minute, nicht je Tag, und ersetzen
    das nicht. Mit Limit gibt es kein „Passwort vergessen“.
  * **Der Grund steht nicht in der Oberfläche.** Die Versand-Maske zeigt „Fehlgeschlagen“
    oder „Mit Fehlern“; dass das Limit die Ursache war, steht im Log und in der Datenbank
    (RUNBOOK 3b).

## Verworfene Alternativen

* **Warten statt verwerfen** (Empfänger über dem Limit bleiben offen und gehen am nächsten
  Tag hinaus): Ein versehentlich großer Versand tröpfelte dann wochenlang mit der
  Tagesmenge aus dem Postfach, und der Versand stünde so lange auf „in Arbeit“. Für den
  Zweck — ein privates Postfach schützen — ist das die falsche Richtung.
* **Schon beim Anlegen ablehnen** (die API prüft das Limit, bevor ein Versand entsteht):
  greift nicht für Versände, die schon in der Warteschlange stehen, und nicht für
  Wiederholungen. Als zusätzlicher Hinweis in der Versand-Maske denkbar, als Schutz
  allein nicht ausreichend.
* **Das Limit des Anbieters abwarten** (Gmail: einige Hundert am Tag): weit über „einer
  Handvoll“, und der Worker behandelt dessen Kontingent-Meldung als vorübergehend und
  versucht es erneut.
* **`SMTP_MAX_PER_MINUTE` klein stellen:** eine Mail je Minute sind 1.440 am Tag.
