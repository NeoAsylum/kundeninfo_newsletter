# [ADR-0023] Meldungshistorie für alle — eigener Endpunkt mit reduziertem Schema

* **Status:** Akzeptiert
* **Datum:** 2026-08-11
* **Kontext:** Mitarbeiter sollen nachlesen können, was bereits gemeldet wurde („war das
  gestern schon bekannt?“, „wann kam die Entwarnung?“). Bisher sah die Historie nur die
  Rolle `admin` in der Versand-Maske. Eine solche Nachschlagesicht ist der erste Schritt
  zu dem im Plan benannten Erweiterungspunkt „Dashboards/Newsfeed über die
  Störungshistorie“ (Plan 4.3) — die Datenquelle `dispatches` steht dafür bereit.

## Entscheidung

Ein **eigener Endpunkt** `GET /api/v1/dispatches` für alle angemeldeten Nutzer, mit
eigenem, reduziertem Schema:

| Feld | |
|---|---|
| enthalten | `id`, `topic_id`, `topic_name`, `severity`, `subject`, `body`, `created_at` |
| **nicht** enthalten | Empfängerzahl, Zustell- und Fehlerzähler, Status, Absender |

Sichtbar sind nur Versände in `completed` / `completed_with_errors`, dafür aber die
**aller Verteiler** — auch der nicht abonnierten und der inzwischen deaktivierten.
Dargestellt wird das in der Seite `/meldungen.html`.

### Warum nicht einfach die Admin-Historie freigeben

Sie liefert Empfängerzahlen sowie Zustell- und Fehlerzähler, und sie nennt die
Mailadresse des verfassenden Admins. Beides darf nicht an die Belegschaft:

* **Die Zähler sind Auswertungsdaten über Empfänger** und damit genau das, was
  [ADR-0014] ausschließt. Sie verraten zudem die Größe jedes Verteilers; bei kleinen
  Verteilern erlaubt eine Empfängerzahl Rückschlüsse auf konkrete Personen („der
  Verteiler hat drei Abonnenten, und wir wissen, wer im Team ist“).
* **Der Absender ist ein personenbezogenes Datum eines Beschäftigten.** Dass jede
  Meldung namentlich einer Person zugeordnet wird, ist dem Betriebsrat nicht zugesagt
  worden — die Meldung kommt fachlich vom Problemmanagement, nicht von einem Menschen.

Getrennte Route mit getrenntem Schema statt einer Feldfilterung im bestehenden Response:
Ein „hier weglassen, dort mitliefern“ am gleichen Modell verliert man beim nächsten
Feld, das jemand ergänzt.

### Warum nur abgeschlossene Versände

`pending` / `sending` bedeutet **nicht zugestellt** — eine Meldung anzeigen, die noch
nicht heraus ist, erzeugt Rückfragen statt Klarheit. `failed` ist ein Betriebsvorfall.
Beides gehört in die Admin-Ansicht, die es mit Statusanzeige und Zählern schon hat.

### Warum alle Verteiler und nicht nur die abonnierten

Die Ansicht ist ein **Nachschlagewerk**, keine personalisierte Zeitleiste. Ausgerechnet
bei einer Großstörung ist der Blick auf das Nachbarsystem wertvoll — eine Einschränkung
auf die eigenen Abos würde ihn verstellen. Wer filtern will, bekommt `?topic_id=`.

### Darstellung: ausschließlich `textContent`

Der Meldungstext ist nie gegen HTML validiert worden — er ist nur längenbegrenzt. In der
Mail ist das unkritisch (Jinja2 escaped), im Browser nicht: Die Anzeige setzt Betreff und
Text deshalb **ausschließlich per `textContent`**, nie per `innerHTML`. Würde die Historie
später serverseitig gerendert oder als HTML eingesetzt, wäre das gespeichertes XSS mit
einem Admin als Autor.

## Konsequenzen

* **Positiv:** Der Informationswert der Historie kommt bei denen an, für die die Meldungen
  gedacht sind, ohne eine der Zusagen aus [ADR-0014] oder dem Betriebsrat-Briefing zu
  berühren. Der Endpunkt ist read-only und trägt keinen Audit-Eintrag — Lesezugriffe
  werden nicht protokolliert ([ADR-0014]).
* **Positiv:** Der Erweiterungspunkt „Dashboards/Newsfeed“ ist damit angefangen; ein Feed
  braucht darüber hinaus nur noch `related_dispatch_id` (Entwarnung ↔ Störung), eine
  additive Migration.
* **Negativ / offener Punkt (B6):** Eine dauerhaft für **alle** sichtbare Historie erhöht
  die Aufbewahrungswirkung der `dispatches`-Zeilen, obwohl die Aufbewahrungsfrist
  ungeklärt ist. Hier wird bewusst **keine Frist erfunden**: Der Versand-Header überlebt
  die Retention weiterhin per Konstruktion ([ADR-0014]), die Detailzeilen verfallen über
  `RETENTION_DAYS_RECIPIENTS`. Die Frage, ob und ab wann alte Meldungen auch aus der
  Lesehistorie verschwinden sollen, steht als neuer Punkt zu B6 in
  [docs/open-questions.md](../open-questions.md).
* **Negativ:** Meldungen deaktivierter Verteiler bleiben sichtbar. Das ist gewollt (die
  Historie ist unveränderlich), heißt aber: Ein Verteiler verschwindet aus der Abo-Maske
  und taucht in der Historie weiter auf.

## Verworfene Alternativen

* **Admin-Historie für alle freischalten:** liefert Zähler und Absender mit — siehe oben.
* **Nur die abonnierten Verteiler zeigen:** verstellt genau in der Lage den Blick, in der
  die Ansicht gebraucht wird.
* **Historie im Abo-Screen mit anzeigen:** vermischt „was will ich bekommen“ mit „was ist
  passiert“; die Abo-Maske speichert automatisch und hätte dann zwei Bedeutungen.
* **Meldungstext als HTML anzeigen (Formatierung wäre schöner):** der Text ist
  ungeprüfte Eingabe; das wäre gespeichertes XSS für einen kosmetischen Gewinn.
