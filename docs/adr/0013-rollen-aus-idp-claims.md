# [ADR-0013] Rollen ausschließlich aus IdP-Claims, keine DB-Rollentabellen

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Wer darf die Versand-Maske nutzen? (Plan 5.4, Frage A2)

## Entscheidung

Zwei Rollen, mehr nicht: `employee` = jeder erfolgreich Eingeloggte; `admin` = der konfigurierbare Rollen-Claim (`OIDC_ROLES_CLAIM`, Default `realm_access.roles`) enthält `ADMIN_ROLE_VALUE` (Default `stoerungsinfo-admin`). Keine Rollen-/Berechtigungstabellen in der DB. Durchsetzung serverseitig als FastAPI-Dependency an allen `/api/v1/admin/*`-Routen; das UI blendet nur zusätzlich aus.

## Konsequenzen

* **Positiv:** Der IdP ist die einzige Wahrheit; Berechtigungsvergabe läuft über den gewohnten AD-Gruppen-/App-Rollen-Antrag der Konzern-IT. PROD-Empfehlung: Entra **App-Rolle** statt Gruppen-Claim (vermeidet Groups-Overage bei > 200 AD-Gruppen).
* **Negativ:** Feingranulare Rechte (Dispatcher nur für bestimmte Topics) brauchen später eine `topic_permissions`-Tabelle (benannter Erweiterungspunkt).

## Verworfene Alternativen

* **Rollen in der DB pflegen:** zweite Wahrheit neben dem IdP, eigener Admin-Aufwand, Drift-Risiko.

## Abgelöst durch [ADR-0022](0022-adminrechte-im-portal.md), soweit es die Rolle `admin` betrifft

Nicht mehr gültig: Die Rolle `admin` kommt **nicht** mehr aus einem IdP-Claim. Sie steht
allein in der Datenbank (`users.is_admin`) und wird bei jeder Anfrage dort geprüft;
`OIDC_ROLES_CLAIM` und `ADMIN_ROLE_VALUE` sind entfallen, ein Rollen-Claim im Token wird
nicht gelesen. Damit ist auch die verworfene Alternative „Rollen in der DB pflegen“ zur
getroffenen Entscheidung geworden — die Begründung dagegen (zweite Wahrheit, Drift) hat
sich umgekehrt: Genau die **eine** Wahrheit war das Ziel, und der IdP konnte sie nicht
liefern, weil seine Adminkonsole im Pilot bewusst unerreichbar ist.

Weiter gültig: `employee` gilt für jeden angemeldeten Nutzer, die Rollenmenge bleibt
`employee`/`admin`, die Durchsetzung bleibt serverseitig als FastAPI-Dependency, und der
benannte Erweiterungspunkt `topic_permissions` bleibt unangetastet.
