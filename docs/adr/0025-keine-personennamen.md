# [ADR-0025] Keine Personennamen im Portal

* **Status:** Akzeptiert (ändert [ADR-0010](0010-jit-provisioning.md) im Umfang der übernommenen Claims)
* **Datum:** 2026-08-11
* **Kontext:** Das Portal übernahm beim Login den Namen aus dem IdP-Claim (`name`, ersatzweise `preferred_username`), führte ihn im Session-Cookie mit, speicherte ihn in `users.display_name` und lieferte ihn in `/api/v1/me` sowie in der Empfänger-Liste aus. **Angezeigt wurde er nirgends** — die Empfänger-Maske ist verteiler-zentriert und ohne Namensspalte gebaut, die Kopfzeile zeigt die E-Mail, und die Suche ist ausdrücklich E-Mail-only. Der Auftraggeber hat die Namen als nicht hilfreich verworfen.

## Entscheidung

Das Portal verarbeitet **keine Personennamen**. Konkret:

* `identity_from_claims` liest den Namens-Claim nicht mehr; `Identity` hat kein
  Namensfeld, und das Session-Cookie trägt keines.
* JIT-Provisioning schreibt `display_name` nicht mehr ([ADR-0010] gilt sonst unverändert:
  `email` und `last_login_at` werden weiter je Login aktualisiert).
* `MeOut` und `AdminUserOut` liefern kein Namensfeld mehr.
* Der Demo-Seed legt keine Namen an.
* **Migration 0004** leert die Bestandswerte. Die **Spalte bleibt** — Migrationen sind
  additiv ([ADR-0011]), ein `DROP COLUMN` wäre nicht rückholbar und bringt nichts. Sie ist
  nullable und wird von niemandem mehr beschrieben.

Was **nicht** dazugehört: Der IdP hat weiter Vor- und Nachname als Pflichtfelder, weil
Keycloak sonst bei jedem Login die Aktion `VERIFY_PROFILE` erzwingt und der Anmeldevorgang
stehen bleibt. Deshalb setzt `create-user.sh --name` sie weiterhin — das ist Datenhaltung
des Identity Providers, nicht des Portals.

## Konsequenzen

* **Positiv (Datenminimierung):** Ein personenbezogenes Datum weniger in Datenbank, Cookie
  und API-Antworten — und eines weniger, das in einem Log oder einem Fehlerbericht landen
  kann. Das ist keine Kosmetik: Der Name war das einzige gespeicherte Attribut ohne
  Verwendungszweck, und genau solche Felder sind in einer DSGVO-Prüfung erklärungsbedürftig.
* **Positiv:** Die Auskunfts- und Löschprozeduren werden kürzer, weil ein Feld entfällt.
* **Negativ:** Eine künftige Anzeige „Wer hat diese Meldung verfasst" oder eine
  Empfängerliste mit Namen bräuchte das Feld wieder. Wiederherstellbar ist das billig (der
  Claim liegt im Token), die alten Werte sind aber weg. Beides ist gewollt: Wer die Anzeige
  will, entscheidet neu — inklusive der Betriebsrats-Frage, die eine namentliche
  Empfängerliste aufwirft.
* Die Suche in der Empfänger- und Rollen-Maske bleibt E-Mail-only. Sie war es schon vorher,
  jetzt ist sie es zwangsläufig.

## Verworfene Alternativen

* **Spalte und Claim behalten, nur nicht anzeigen:** war der Zustand vorher. Ein
  gespeichertes personenbezogenes Feld, das niemand liest, ist Risiko ohne Gegenwert.
* **`DROP COLUMN display_name`:** verstößt gegen [ADR-0011] (nur additive Migrationen) und
  macht ein späteres Zurückrudern zur Schemaänderung, ohne dass Platz oder Klarheit
  gewonnen wären.
* **Namen nur für Admins ausliefern:** hätte die Empfänger-Maske um eine Spalte erweitert,
  die der Auftraggeber ausdrücklich nicht wollte, und die Betriebsrats-Diskussion um
  Verhaltens- und Personendaten unnötig ausgeweitet.

## Teilweise abgelöst durch [ADR-0028](0028-nur-email-und-passwort.md)

Nicht mehr gültig ist der Absatz „Was **nicht** dazugehört“: Der mitlaufende Keycloak
verlangt und speichert keine Vor- und Nachnamen mehr, der Client bekommt den Scope `profile`
nicht, und `create-user.sh --name` ist entfallen. Damit stimmt auch die Aussage nicht mehr,
eine Namensanzeige sei billig wiederherstellbar, weil der Claim im Token liege: Er liegt
dort nicht mehr. Alles Übrige gilt unverändert.
