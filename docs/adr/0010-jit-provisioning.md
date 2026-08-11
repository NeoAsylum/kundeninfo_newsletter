# [ADR-0010] JIT-Provisioning statt AD-Import

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Woher kommen die `users`-Zeilen? Ein AD-/SCIM-Sync bräuchte Anträge und Vorlauf (Plan 4.3).

## Entscheidung

Ein `users`-Datensatz entsteht beim **ersten erfolgreichen Login** (Upsert auf das stabile `oidc_sub`-Claim); `email` und `last_login_at` werden bei jedem Login aktualisiert (der Name seit [ADR-0025](0025-keine-personennamen.md) nicht mehr). **E-Mail-Kollisionsbehandlung ist verbindlich** (Unit-getestet): Hängt die Adresse an einer Alt-Zeile mit anderem `sub` (Recycling/Namenswechsel), wird die Alt-Zeile deaktiviert und ihre Adresse archiviert (`user-<id>@invalid.archiviert`) — der Login bricht nie mit Constraint-Fehler ab. Login reaktiviert deaktivierte User (IdP-Konto beweist Existenz).

## Konsequenzen

* **Positiv:** Kein Sync-Job, kein Graph-API-Antrag vor dem ersten Nutzen; datensparsam (nur wer das Portal nutzt, steht in der DB).
* **Negativ (ausgesprochen):** Pflicht-Topics erreichen im MVP nur Mitarbeiter, die sich mindestens einmal angemeldet haben → Rollout-Thema (Parallelbetrieb Alt-Verteiler, Frage A1), keine Architekturfrage: ein späterer Verzeichnis-Sync erzeugt nur zusätzliche Zeilen.

## Verworfene Alternativen

* **AD-Initialimport/SCIM vor Go-Live:** Antragsvorlauf, Datenhaltungspflichten ohne Nutzen fürs MVP.
