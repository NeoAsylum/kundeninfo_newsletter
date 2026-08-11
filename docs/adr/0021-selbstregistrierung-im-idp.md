# [ADR-0021] Selbstregistrierung im IdP statt eigener Registrierungsmaske

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Für den Pilot- und Demobetrieb sollen sich Nutzer selbst anmelden können, ohne dass ein Administrator jeden Zugang anlegt. Es gibt keinen angebundenen Konzern-IdP (Frage B1 offen), im DEV-Stack läuft Keycloak.

## Entscheidung

Die Registrierung übernimmt der **IdP**, nicht das Portal. Im DEV-Realm sind
`registrationAllowed`, `registrationEmailAsUsername`, `loginWithEmailAllowed`,
`resetPasswordAllowed` aktiv — Keycloak zeigt
einen „Registrieren“-Link auf der Anmeldeseite. Nach der Registrierung ist der Nutzer
angemeldet und wird im Portal per JIT als Empfänger angelegt ([ADR-0010]); Pflicht-Verteiler
greifen sofort ([ADR-0009]), Rollen bleiben bei `employee` ([ADR-0013]).

Konfiguration: Flags in `deploy/keycloak/realm-dev.json`; Realm-SMTP und nachträgliche
Umschaltung über `ops/configure_dev_realm.py` lokal bzw. `deploy/vm/configure-realm.sh`
auf der VM (Zugangsdaten aus der `.env`, damit keine Geheimnisse in der versionierten
Realm-Datei landen).

Im öffentlichen Pilot ist die Registrierung **offen** — eine bewusste Entscheidung für den
Demobetrieb, siehe RUNBOOK 3c.

## Konsequenzen

* **Positiv:** Kein Zeilencode im Portal, keine Passwortspeicherung, kein Reset-/Sperr-Flow — die Architekturentscheidung „Auth gehört dem IdP“ ([ADR-0002], [ADR-0003]) bleibt unangetastet. Im Zielbild mit Konzern-IdP entfällt der Schalter ganz: dort registriert niemand, jeder Mitarbeiter hat bereits ein Konto.
* **Negativ:** Registrierungsseite und Bestätigungsmail tragen das Keycloak-Layout, nicht das Portal-Design. Anpassbar über ein Keycloak-Theme, im MVP nicht gemacht.
* **Keine Mailbestätigung** (`verifyEmail: false`, Entscheidung des Auftraggebers vom
  2026-08-11). Die Registrierung ist damit einen Klick lang und braucht keinen
  funktionierenden Realm-SMTP. Der Preis ist benannt: Wer sich registriert, muss die
  Adresse nicht besitzen — es entstehen Konten mit fremden oder erfundenen Adressen, und
  die Verteiler-Mails gehen dann an das echte Postfach der eingetragenen Adresse. Für
  eine Testmaschine ist das vertretbar.
* **Langfristig entfällt die Frage.** Im Zielbild kommen die Nutzer aus dem
  Verzeichnisdienst (AD-Anbindung, offene Frage B1): Dann registriert sich niemand mehr
  selbst, die Adresse ist durch das Konzern-Konto belegt, und `registrationAllowed`
  gehört auf `false`. Dieses ADR beschreibt bis dahin einen Übergangszustand — es ist
  nicht der Endzustand.
* Die Selbstregistrierung löst **nicht** Frage A1: Pflicht-Verteiler erreichen weiterhin nur Personen, die das Portal benutzt haben. Der dokumentierte Erweiterungspunkt dafür bleibt „Empfänger per Admin-Maske oder Verzeichnis-Sync anlegen“.

## Verworfene Alternativen

* **Eigene Registrierungsmaske mit Passwort im Portal:** bricht mit [ADR-0002]/[ADR-0003], bringt Passwort-Hashing, Bestätigungs- und Reset-Flow, Sperrlogik und Compliance-Fragen zur Passwortspeicherung ins Projekt — für eine Funktion, die der IdP mitbringt und die im Zielbild ohnehin entfällt.
* **Zugänge ausschließlich durch Administratoren anlegen:** funktioniert, skaliert aber im Pilotbetrieb schlecht und macht das Problem aus A1 nicht kleiner.
