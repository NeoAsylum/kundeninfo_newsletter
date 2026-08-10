# [ADR-0003] BFF-Muster mit HttpOnly-Session-Cookie statt Token im Browser

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Der Rough Sketch nannte „lokales Token/Session-Handling“ im Browser. Bewusste Abweichung (Plan 5.3).

## Entscheidung

Das FastAPI-Backend ist Confidential Client und führt den kompletten OIDC-Flow selbst (`/auth/login` → IdP → `/auth/callback`). Der Browser erhält nur ein **Fernet-verschlüsseltes, signiertes Session-Cookie** (`HttpOnly`, `SameSite=Lax`; `Secure` bei https-`PUBLIC_BASE_URL`) mit sub, email, roles. Kein Session-Store, kein Redis. Laufzeit `SESSION_MAX_AGE` (Default 8 h).

## Konsequenzen

* **Positiv:** Kein Token im `localStorage` (XSS kann nichts exfiltrieren), kein Token-Refresh-JS, einfacher **und** sicherer als der Sketch.
* **Negativ (dokumentierter Trade-off):** Rollenentzug/Deaktivierung wirken erst mit Session-Ablauf (max. 8 h). Notfallhebel: `SESSION_SECRET` tauschen invalidiert sofort alle Sessions (RUNBOOK 5).
* Das `Secure`-Flag wird nur bei https gesetzt (DEV läuft auf `http://localhost` — robuster über Browser hinweg; PROD ist immer https).

## Verworfene Alternativen

* **JWT im Browser + Bearer-Header:** XSS-Exfiltrationsrisiko, Silent-Renew-Komplexität.
* **Serverseitiger Session-Store (Redis):** zusätzliche Infrastrukturkomponente ohne MVP-Nutzen.
