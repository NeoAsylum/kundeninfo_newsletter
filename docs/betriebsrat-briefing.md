# Betriebsrat-Briefing & Datenschutz-Vorlagedokument

**Projekt:** Self-Service-Portal „Störungsinfos“  
**Stand:** 2026-08-11  
**Zweck:** Vorlage für Betriebsrat (§87 Abs. 1 Nr. 6 BetrVG) und Datenschutzbeauftragten (DSB)

---

## 1. Ausgangslage & Zielsetzung

Bisher werden Störungsinformationen über händisch gepflegte E-Mail-Verteiler in Outlook versendet. Das neue Self-Service-Portal ermöglicht es allen Mitarbeitern, ihre Abonnements für Störungsthemen selbstständig zu verwalten. Die Anmeldung erfolgt über einen Identity Provider, im Zielbild das zentrale Konzern-SSO — das Portal speichert selbst keine Passwörter. Im aktuellen Pilotbetrieb übernimmt ein eigener Identity Provider (Keycloak) diese Rolle, weil die Anbindung an das Konzern-SSO noch nicht erfolgt ist.

---

## 2. Grundsätze der Datenverarbeitung (Privacy by Design)

1. **Null-Tracking**: Das Portal verzichtet vollständig auf Mechanismen zur Überwachung des Nutzerverhaltens.
   - **Keine Zählpixel** in E-Mails.
   - **Keine personalisierten Tracking-Links**.
   - **Keine Lese- oder Öffnungsbestätigungen**.
2. **Datenminimierung**: In der Datenbank werden ausschließlich betrieblich notwendige Attribute gespeichert:
   - SSO-Kennung (`oidc_sub`)
   - E-Mail-Adresse (`email`)
   - Anzeigename (`display_name`, optional)
   - Status (`is_active`)
   - Zeitstempel der letzten Anmeldung (`last_login_at`)
3. **Schutz der Entwickler- und Protokolldateien**:
   - Anwendung-Logs enthalten **keine E-Mail-Adressen von Empfängern**.
   - Die Fehlerdiagnose erfolgt ausschließlich über anonymisierte IDs (`dispatch_id`, `recipient_id`).

---

## 3. Datenmodell mit Personenbezug

* **Tabellenstruktur**:
  - `users`: Stammdaten zur Zuordnung von Abonnements.
  - `subscriptions`: Zuordnung von Nutzern zu gewählten Benachrichtigungstopics.
  - `dispatches`: Historie versendeter Störungsmeldungen (Ersteller, Betreff, Text, Zeitpunkt).
  - `dispatch_recipients`: Zustellstatus je Empfänger (erforderlich für automatische Retries bei Netzwerkfehlern).
  - `audit_log`: Auf administrative Aktionen beschränkt — abgeschickte Meldungen; Änderungen, die ein Administrator an fremden Empfängern vornimmt (Aktivieren/Deaktivieren, Abo setzen/entfernen); die Vergabe und der Entzug von Administratorrechten im Portal; sowie Anlegen, Ändern und Löschen von Verteilern. Protokolliert wird jeweils, **wer** die administrative Handlung vorgenommen hat und **was** sie betraf. Die Protokollierung von Abo-Änderungen, die Mitarbeiter **selbst** vornehmen, ist standardmäßig **deaktiviert** (`AUDIT_SUBSCRIPTIONS=false`) und bedarf der expliziten Freigabe.

---

## 3c. Administratorrechte und ihr Entzug

Wer im Portal administrieren darf — Meldungen versenden, Empfänger und Verteiler pflegen —
entscheidet **das Portal selbst** über ein Kennzeichen am Benutzerdatensatz, das ein
Administrator vergibt und entzieht. Rollen aus dem Verzeichnisdienst werden dafür nicht
ausgewertet.

Für die Mitbestimmung sind daran zwei Punkte wesentlich:

* **Der Entzug wirkt unmittelbar.** Die Berechtigung wird bei jedem einzelnen Zugriff aus
  der Datenbank gelesen, nicht aus einer beim Anmelden ausgestellten Bescheinigung. Ein
  entzogenes Recht ist mit dem nächsten Klick wirkungslos, nicht erst nach Ablauf der
  Sitzung.
* **Ein Austritt aus dem Konzern beendet die Administratorrolle nicht von allein.** Wird ein
  Konto im Verzeichnisdienst deaktiviert, kann sich die Person nicht mehr anmelden — das
  Kennzeichen im Portal bleibt aber gesetzt. Es muss beim Offboarding mit entzogen werden.
  Diese Aufgabe liegt beim Problemmanagement und ist im Betriebshandbuch festgehalten.

Jede Vergabe und jeder Entzug wird protokolliert (siehe Abschnitt 3, `audit_log`).

---

## 4. Pflicht-Abonnement „Zentrale Störungen“

Ein ausgewähltes Topic („Zentrale Störungen“) ist als Pflicht-Topic gekennzeichnet. Mitarbeiter können dieses Topic nicht abbestellen, da hierüber geschäftskritische Gesamtausfälle (z. B. IT-Netzwerkdown) kommuniziert werden. Das Pflicht-Abo ist als Datenattribut (`is_mandatory`) modelliert und kann bei Bedarf ohne Code-Änderung per Konfiguration angepasst werden.

---

## 5. Einsicht in die versendeten Meldungen

Alle angemeldeten Beschäftigten können die bereits versendeten Störungs- und Entwarnungsmeldungen im Portal nachlesen (Seite „Meldungen“). Zweck ist ausschließlich die Information: nachvollziehen, welche Störung wann gemeldet und wann entwarnt wurde — auch für Verteiler, die man selbst nicht abonniert hat.

Diese Ansicht ist bewusst **so weit reduziert, dass sie keine Aussage über Personen zulässt**. Sie enthält je Meldung nur:

* Verteiler, Schweregrad, Betreff, Meldungstext und Versandzeitpunkt.

Sie enthält **nicht**:

* **keine Empfängerdaten** — weder Namen noch E-Mail-Adressen noch die Anzahl der Empfänger. Die Empfängerzahl bliebe zwar anonym, würde aber die Größe jedes Verteilers offenlegen; bei kleinen Verteilern ließen sich daraus Rückschlüsse auf einzelne Personen ziehen.
* **keine Zustellinformationen** — keine Angabe, ob eine Mail zugestellt, geöffnet oder fehlerhaft war. Zustell- und Fehlerzähler sind für den technischen Betrieb erforderlich und bleiben auf die Administratorensicht beschränkt; Lese- oder Öffnungsbestätigungen gibt es grundsätzlich nicht (siehe Abschnitt 2).
* **keinen Absender** — es wird nicht angezeigt, welcher Administrator eine Meldung verfasst hat. Die Meldung ist eine Verlautbarung des Problemmanagements, keine persönliche Mitteilung eines Beschäftigten.

Ebenfalls nicht sichtbar sind Meldungen, deren Versand noch läuft oder technisch fehlgeschlagen ist — angezeigt wird nur, was tatsächlich hinausgegangen ist.

Das **Lesen dieser Ansicht wird nicht protokolliert**: Es entsteht kein Eintrag im `audit_log`, es wird nicht gespeichert, wer welche Meldung aufgerufen hat. Damit bleibt der Grundsatz aus Abschnitt 2 (Null-Tracking) auch für die Einsichtnahme gewahrt.

**Offener Punkt zur Aufbewahrung:** Wie lange versendete Meldungen im Portal sichtbar bleiben, ist noch nicht festgelegt. Die Aufbewahrungsfristen sind als Konfigurationswerte vorbereitet (siehe Abschnitt 2 und `docs/open-questions.md`, Punkt B6); eine Frist wird erst nach Abstimmung mit dem Datenschutzbeauftragten und dem Betriebsrat gesetzt. Personenbezogene Zustelldetails je Empfänger unterliegen dabei einer eigenen, kürzeren Löschung als der reine Meldungstext.
