# [ADR-0016] Topic-Verwaltung per Seed-Migration + RUNBOOK-SQL statt Admin-CRUD

* **Status:** Abgelöst durch [ADR-0024](0024-verteiler-crud-in-der-oberflaeche.md)
* **Datum:** 2026-08-10
* **Kontext:** Das MVP hat exakt die 5 im Sketch vorgegebenen Topics; sie ändern sich selten (Plan 4.3/7.2).

## Entscheidung

Topics entstehen per idempotenter Seed-Migration (0002). Änderungen (Neuanlage, Umbenennung, Deaktivierung, `is_mandatory`-Wechsel) laufen als **dokumentierte RUNBOOK-Prozedur mit SQL** inklusive `audit_log`-INSERT (RUNBOOK 6). Es gibt bewusst **kein** Admin-Topic-CRUD (weder API noch UI).

## Konsequenzen

* **Positiv:** Spart API-, UI-, Test- und Angriffsfläche für ein Feature, das selten gebraucht wird; konsistent zum Muster „Pflicht-Abo per `UPDATE` abschaltbar“ ([ADR-0009]).
* **Negativ:** Topic-Änderungen brauchen DB-Zugriff und die RUNBOOK-Disziplin (Audit-INSERT nicht vergessen).
* **Erweiterungspunkt:** volles Topic-CRUD — dann API **und** UI zusammen, nicht ein halbes Feature.

## Verworfene Alternativen

* **Admin-CRUD im MVP:** halbes Feature mit vollem Aufwand (Validierung, Berechtigungen, Tests, Audit).

## Nachtrag

Der oben benannte Erweiterungspunkt ist eingelöst: Der Auftraggeber hat die Verwaltung angefordert, API **und** UI sind zusammen gebaut — [ADR-0024](0024-verteiler-crud-in-der-oberflaeche.md). Das SQL aus RUNBOOK 6 bleibt als Notfallweg dokumentiert, ist aber nicht mehr der Regelweg.
