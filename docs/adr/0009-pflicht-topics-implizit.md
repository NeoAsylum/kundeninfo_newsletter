# [ADR-0009] Pflicht-Topics implizit statt materialisiert

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Topics mit `is_mandatory = 1` (z. B. „Zentrale Störungsmeldungen“) müssen alle Mitarbeiter erreichen und dürfen nicht abwählbar sein (Plan 4.3).

## Entscheidung

Pflicht-Topics erzeugen **keine** `subscriptions`-Zeilen. Die Empfängermenge wird zur Laufzeit aufgelöst: Pflicht-Topic → alle `users` mit `is_active = 1`; normales Topic → Abonnenten. Die API lehnt Abo-Änderungen an Pflicht-Topics mit `409 TOPIC_MANDATORY` ab; das UI sperrt den Toggle nur zusätzlich.

## Konsequenzen

* **Positiv:** **Es gibt keinen falschen Zustand** — materialisierte Pflicht-Abos bräuchten Sync-Logik an drei Stellen (User-Anlage, Topic wird pflichtig, Topic wird freiwillig). Preis: ein `if` in genau zwei Codepfaden (Empfängerauflösung, Abo-Maske).
* Wird ein Topic nachträglich pflichtig, bleiben alte Abo-Zeilen stehen und werden ignoriert; wird es wieder freiwillig, sind sie noch da.
* **Politisch:** `is_mandatory` ist ein Datenattribut — kippt der Betriebsrat das Zwangs-Abo, genügt ein `UPDATE`, kein Release (RUNBOOK 6).

## Verworfene Alternativen

* **Auto-Abo bei User-Anlage:** genau der Sync-Sonderfall, den dieses Design vermeidet.
