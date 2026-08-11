# [ADR-0017] Audit-Log-Umfang: Admin-Aktionen ab Tag 1, Abo-Änderungen erst nach Freigabe

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Nachvollziehbarkeit ist gefordert (Ziel Z6); das Protokollieren von Abo-Änderungen einzelner Mitarbeiter wäre aber Verhaltensdaten-Logging von Beschäftigten — Betriebsrats-/DSB-Klärung offen (Fragen B5/B6, Plan 4.3).

## Entscheidung

Die append-only-Tabelle `audit_log` protokolliert **ausschließlich Admin-Aktionen**:

| Aktion | Auslöser |
|---|---|
| `dispatch_created` | Störungsmeldung abgeschickt |
| `user_activated` / `user_deactivated` | Empfänger über die Admin-API geschaltet |
| `admin_subscribe` / `admin_unsubscribe` | Admin ändert das Abo eines anderen Nutzers |
| `admin_granted` / `admin_revoked` | Adminrecht im Portal vergeben oder entzogen ([ADR-0022]) |
| `admin_bootstrap` | Adminrecht über `ADMIN_BOOTSTRAP_EMAILS` vergeben, weil kein aktiver Admin existierte ([ADR-0022]) |
| `admin_demo_suffix` | Adminrecht wegen der Adress-Endung `@demo.invalid` vergeben — Demo-Regel der Testmaschine, siehe RUNBOOK 3c |
| `topic_created` / `topic_updated` / `topic_deleted` | Verteiler angelegt, geändert oder gelöscht ([ADR-0024]) |

Abo-Änderungen durch die Nutzer selbst (`subscribe`/`unsubscribe`) werden erst nach Freigabe über den Konfig-Schalter `AUDIT_SUBSCRIPTIONS=true` geschrieben (Code liegt bereit, Default `false`). Lese-/Öffnungsverhalten wird **nie** protokolliert ([ADR-0014]) — auch nicht das Lesen der für alle sichtbaren Meldungshistorie ([ADR-0023]).

Zwei Details, weil die Einträge sonst nichts wert wären: `topic_deleted` hält die Zahl der per CASCADE mitgelöschten Abos fest (danach nicht mehr rekonstruierbar), `topic_updated` nur die tatsächlich geänderten Felder. Verteilerpflege per SQL — der Notfallweg aus [RUNBOOK 6](../RUNBOOK.md) — erzeugt weiterhin **keinen** Eintrag von allein und muss ihn mitschreiben.

## Konsequenzen

* **Positiv:** Nachvollziehbarkeit des Versands ist über `dispatches`/`dispatch_recipients` vollständig gegeben; der Abo-Ist-Zustand steht ohnehin in `subscriptions` (inkl. `created_at`). Keine Überraschungen gegenüber dem Betriebsrat.
* **Negativ:** Ohne Freigabe keine Historie einzelner Abo-Wechsel (bewusst).

## Verworfene Alternativen

* **Abo-Audit ab Tag 1:** stünde in Spannung zum eigenen Datenminimierungs-Prinzip, solange B5/B6 ungeklärt sind.
