# [ADR-0005] Einzelmails statt BCC-Sammelmail

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Zustellung an bis zu ~5.000 Empfänger je Störungsmeldung (Plan 6.4).

## Entscheidung

**Eine Mail pro Empfänger** mit sauberem `To:`. Durchsatzsteuerung über `SMTP_BATCH_SIZE` (Verbindungs-Reuse), `SMTP_MAX_PER_MINUTE` (Drossel) und Retry mit Backoff (`WORKER_RETRY_BACKOFF_S`).

## Konsequenzen

* **Positiv:** Empfängergenauer Sendestatus (Retry/Audit), bessere Outlook-Filter-Eigenschaften, späteres Bounce-Tracking möglich, personalisierbarer Footer bleibt möglich (aktuell bewusst generisch — Null-Tracking, [ADR-0014]).
* **Negativ:** 5.000 SMTP-Transaktionen statt weniger BCC-Chunks (bei konservativen 10/s ≈ 8–9 min — für Störungsinfos akzeptabel).
* BCC-Chunks bleiben dokumentierter Fallback, falls das Relay wider Erwarten restriktiv limitiert (Frage B2).

## Verworfene Alternativen

* **BCC-Sammelmail:** müsste an Exchange-Empfängerlimits (oft 500/Mail) ohnehin chunken — erbt die Komplexität und verliert empfängergenauen Status. Hinweis: Exchange-Empfänger-Ratenlimits zählen Envelope-Empfänger — Chunking reduziert die Transaktionszahl, nicht die gezählte Empfängermenge.
* **Versand an AD-Verteilergruppen (serverseitige Expansion, „wie heute aus Outlook"):** Eine Mail an die Gruppenadresse, Exchange fächert intern auf — deshalb greifen beim heutigen manuellen Versand an 2.000+-Verteiler keine Limits. Verworfen, weil die App dann Abos in AD-Gruppen zurücksynchronisieren müsste: Service-Account mit AD-Gruppen-Schreibrechten (heikel, antragspflichtig), Mitgliedschafts-Wahrheit in zwei Systemen mit Sync-Drift, und der empfängergenaue Versandstatus (Historie, Retry, spätere Dashboards) ginge vollständig verloren — Exchange meldet nicht zurück, wer aus einer Gruppe zugestellt wurde.
