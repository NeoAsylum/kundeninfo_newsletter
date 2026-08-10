# Betriebsrat-Briefing & Datenschutz-Vorlagedokument

**Projekt:** Self-Service-Portal „Störungsinfos“  
**Stand:** 2026-08-10  
**Zweck:** Vorlage für Betriebsrat (§87 Abs. 1 Nr. 6 BetrVG) und Datenschutzbeauftragten (DSB)

---

## 1. Ausgangslage & Zielsetzung

Bisher werden Störungsinformationen über händisch gepflegte E-Mail-Verteiler in Outlook versendet. Das neue Self-Service-Portal ermöglicht es allen Mitarbeitern, ihre Abonnements für Störungsthemen selbstständig zu verwalten. Die Anmeldung erfolgt ausschließlich über das zentrale Konzern-SSO.

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
  - `audit_log`: Im MVP auf administrative Aktionen beschränkt (`dispatch_created`). Die Protokollierung von Abo-Änderungen einzelner Mitarbeiter ist standardmäßig **deaktiviert** (`AUDIT_SUBSCRIPTIONS=false`) und bedarf der expliziten Freigabe.

---

## 4. Pflicht-Abonnement „Zentrale Störungen“

Ein ausgewähltes Topic („Zentrale Störungen“) ist als Pflicht-Topic gekennzeichnet. Mitarbeiter können dieses Topic nicht abbestellen, da hierüber geschäftskritische Gesamtausfälle (z. B. IT-Netzwerkdown) kommuniziert werden. Das Pflicht-Abo ist als Datenattribut (`is_mandatory`) modelliert und kann bei Bedarf ohne Code-Änderung per Konfiguration angepasst werden.
