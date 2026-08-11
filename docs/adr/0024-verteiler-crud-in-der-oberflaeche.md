# [ADR-0024] Verteiler-Verwaltung in API und Oberfläche statt RUNBOOK-SQL

* **Status:** Akzeptiert (löst [ADR-0016](0016-topic-pflege-ohne-admin-crud.md) ab)
* **Datum:** 2026-08-11
* **Kontext:** [ADR-0016] verzichtete auf Topic-CRUD und begründete das mit
  MVP-Einfachheit — bei fünf selten wechselnden Verteilern war die RUNBOOK-Prozedur mit
  SQL billiger als API, UI, Validierung und Tests. Dasselbe ADR nannte als
  Erweiterungspunkt ausdrücklich „volles Topic-CRUD — dann API **und** UI zusammen, nicht
  ein halbes Feature“. Genau das passiert hier: Der Auftraggeber hat die Verwaltung
  angefordert. Im öffentlichen Pilot kommt hinzu, dass ein SQL-Weg einen SSH-Zugang zur VM
  voraussetzt, den das Problemmanagement nicht hat.

## Entscheidung

Verteiler werden über `/api/v1/admin/topics` und die Maske „Verteiler“ gepflegt:
anlegen, umbenennen, Beschreibung und Pflicht-Kennzeichen ändern, deaktivieren,
reaktivieren, löschen. Die Liste zeigt **auch deaktivierte** Verteiler samt
Abonnentenzahl, Zahl der Versände und laufendem Versand — ohne diese Zahlen wäre keine
Lösch- oder Umbenenn-Entscheidung möglich. Jede Änderung schreibt einen `audit_log`-Eintrag
(`topic_created`, `topic_updated`, `topic_deleted`, [ADR-0017]).

Vier Grenzen, alle aus dem Datenmodell begründet:

* **Der Slug (`topics.id`) ist unveränderlich.** Er ist Primärschlüssel, und
  `subscriptions` wie `dispatches` verweisen ohne `ON UPDATE` darauf — ein Slug-Wechsel
  wäre ein PK-Update, das die Datenbank bei jeder Referenz ablehnt. Änderbar ist der
  Anzeigename; der Slug ist eine technische Kennung und im UI auch als solche beschriftet.
* **Löschen nur ohne Versandhistorie** (`409 TOPIC_IN_USE`). `dispatches.topic_id` ist mit
  `ON DELETE RESTRICT` verdrahtet, und Versände werden nie gelöscht — die Historie ist
  unveränderlich und seit [ADR-0023] für alle sichtbar. Mit Historie bleibt das
  Deaktivieren: Der Verteiler verschwindet aus Abo-Maske und Versand-Auswahl, die
  Meldungen bleiben nachvollziehbar. Abos gehen beim echten Löschen per `CASCADE` mit;
  **ihre Zahl steht im Audit-Eintrag**, weil sie danach nicht mehr rekonstruierbar wäre.
* **Umbenennen bei laufendem Versand gesperrt** (`409 TOPIC_RENAME_BLOCKED`). Der Betreff
  wird bei der Anlage eingefroren (`[STÖRUNG] Verteilername: Titel`), der Worker schneidet
  den Titel zur Sendezeit aber per Textsuche nach dem *aktuellen* Verteilernamen wieder
  heraus. Passt der Marker nicht mehr, landet der komplette alte Betreff als Titel in der
  Mail — sichtbar falsch, bei bis zu 5.000 Empfängern.
* **Kein Abo-Aufräumen beim Pflicht-Umschalten.** Wird ein Verteiler pflichtig, bleiben
  bestehende Abo-Zeilen liegen und werden von der Empfängerauflösung ignoriert; wird er
  wieder freiwillig, gelten sie erneut. [ADR-0009] verwirft die Sync-Logik ausdrücklich —
  „es gibt keinen falschen Zustand“ gilt weiter, und die Maske weist auf die Wirkung hin.

**Namens-Eindeutigkeit prüft die Anwendung, nicht die Datenbank** (`409
TOPIC_NAME_EXISTS`). Ein `UNIQUE` auf `topics.name` wäre eine nicht-additive
Schemaänderung ([ADR-0011]) und müsste an bestehenden Daten scheitern können; der Nutzen
ist gering, weil Verteiler ausschließlich über diese eine Route entstehen. Zwei
gleichnamige Verteiler wären trotzdem schlecht: Abo-Maske und Versand-Dropdown zeigen den
Namen, nicht den Slug.

## Konsequenzen

* **Positiv:** Verteilerpflege braucht keinen DB-Zugriff und keine RUNBOOK-Disziplin mehr
  — der vergessene `audit_log`-INSERT, den [ADR-0016] als Nachteil notierte, kann nicht
  mehr passieren, und `updated_at` wird korrekt fortgeschrieben.
* **Positiv:** Die politisch relevante Schraube aus [ADR-0009] (`is_mandatory` kippen,
  wenn der Betriebsrat das Zwangs-Abo nicht mitträgt) ist jetzt ein Klick statt eines
  SQL-Statements.
* **Negativ:** Mehr Angriffs- und Testfläche hinter dem Admin-Gate — genau der Preis, den
  [ADR-0016] vermeiden wollte. Abgesichert durch Slug-Muster
  (`^[a-z0-9][a-z0-9-]{1,63}$`), Längengrenzen (Name 2–120, Beschreibung ≤ 2000) und die
  drei Guards oben.
* **Negativ:** Ein Verteiler mit Historie lässt sich nie mehr entfernen, nur stilllegen.
  Deaktivierte Verteiler sammeln sich also in der Admin-Liste (nur dort).
* **Der SQL-Weg bleibt als Notfallweg dokumentiert** ([RUNBOOK 6](../RUNBOOK.md)) — für
  den Fall, dass niemand mehr Adminrechte hat oder die Oberfläche nicht erreichbar ist.
  Dort entsteht kein Audit-Eintrag und `updated_at` wird nicht fortgeschrieben; das ist
  der Grund, warum er nicht der Regelweg ist.

## Verworfene Alternativen

* **Nur Soft-Delete, kein echtes Löschen:** einfacher (keine Lösch-Guards, keine
  CASCADE-Frage), aber dann bleibt jeder Tippfehler-Verteiler für immer in der Liste
  stehen — angelegt, nie benutzt, nicht entfernbar.
* **Slug-Umbenennung mit Referenz-Migration** (neue Zeile anlegen, `subscriptions` und
  `dispatches` umschreiben, alte löschen): technisch machbar, aber eine
  Datenmigration in einer Bearbeitungsmaske — viel Aufwand ohne Bedarf, denn der Slug ist
  nirgends sichtbar außer in der Admin-Liste.
* **`UNIQUE` auf `topics.name`:** nicht-additive Schemaänderung ([ADR-0011]) für einen
  Schutz, den die einzige schreibende Route ohnehin leistet.
* **Bei der RUNBOOK-SQL-Prozedur bleiben:** setzt SSH-Zugang zur VM voraus, den das
  Problemmanagement nicht hat und nicht bekommen soll.
