# [ADR-0002] OIDC statt Kerberos für die Nutzer-Authentifizierung

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Der Auftraggeber nannte „Kerberos oder so“. Das betrifft zwei getrennte Baustellen: Web-Portal-Login und SMTP-Relay-Auth (Plan 5.2).

## Entscheidung

Web-Portal-Login ausschließlich per **OIDC Authorization Code Flow + PKCE** gegen einen konfigurierbaren IdP (`OIDC_ISSUER_URL`): DEV = Keycloak-Container, PROD = Konzern-IdP (voraussichtlich Entra ID). Kerberos/SPNEGO wird **nicht** an der Web-App implementiert.

## Konsequenzen

* **Positiv:** Kein AD-Join der Linux-VM, keine SPNs/Keytabs; Windows-SSO liefert der IdP für Domänengeräte transparent mit — für Anwender identisches Ergebnis (kein Login-Dialog). IdP-Wechsel ist reine Konfiguration.
* **Negativ:** Abhängigkeit von der App-Registrierung beim IdP (Frage B1, Vorlaufzeit).
* Für die SMTP-Seite siehe [ADR-0012] (Auth-Abstraktion, Kerberos-Adapter reserviert).

## Verworfene Alternativen

* **SPNEGO/Integrated Windows Auth direkt an der App:** aufwändig, fragil, bindet die App an AD-Interna.
* **Eigene Passwortverwaltung:** maximaler Pflege- und Sicherheitsaufwand, im Konzern unerwünscht.
