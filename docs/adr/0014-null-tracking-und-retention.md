# [ADR-0014] Null-Tracking & Retention-per-Konfig als Compliance-Vorsorge

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Regulatorische Vorgaben (DSGVO, Betriebsrat, Aufbewahrung) sind noch unklar — die Architektur darf sie nicht raten, muss ihre spätere Erfüllung aber billig machen (Plan 10).

## Entscheidung

1. **Null-Tracking als Architekturentscheidung:** keine Tracking-Pixel, keine personalisierten Links, keine Lese-/Öffnungs-/Klickauswertung; der Mail-Footer ist für alle Empfänger identisch. Logs enthalten keine Empfänger-Mailadressen.
2. **Retention als Konfigwert:** `RETENTION_DAYS_RECIPIENTS` / `RETENTION_DAYS_AUDIT`, Default **aus** (keine Frist raten). Ein täglicher In-App-Job löscht nur personenbezogene Detailzeilen; der Versand-Header (`dispatches`) bleibt dauerhaft (Datenquelle für spätere Dashboards/Newsfeeds).

## Konsequenzen

* **Positiv:** Die wahrscheinlichsten Betriebsrats-/DSB-Auflagen (kein Verhaltens-Monitoring, Löschfristen) sind eine Konfigzeile statt eines Umbaus; stärkstes Argument in `docs/betriebsrat-briefing.md`.
* **Negativ:** Kein Zustell-/Öffnungsreporting für das Problemmanagement — bewusst.

## Verworfene Alternativen

* **Tracking „weil man es hat“:** im Beschäftigtenkontext mitbestimmungspflichtig und für Störungsinfos ohne Fachnutzen.
