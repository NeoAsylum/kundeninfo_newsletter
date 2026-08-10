# [ADR-0006] Statisches HTML + Vanilla-JS statt SPA-Framework

* **Status:** Akzeptiert
* **Datum:** 2026-08-10
* **Kontext:** Zwei Masken (Abos, Versand) plus Datenschutzseite; Sketch sah „Plain HTML & Fetch API“ vor (Plan 3.5).

## Entscheidung

Statische Seiten in `frontend/public/`, ausgeliefert vom NGINX-Container (beim Image-Build eingebacken), Vanilla-JS (`app.js` + je ein Seiten-Skript) gegen die REST-API. Kein Node zur Laufzeit, keine CDN-Abhängigkeit, kein Build-Schritt.

## Konsequenzen

* **Positiv:** Firewall-/proxy-freundlich, vollständig lesbarer Code, kein Framework-Lock-in. Die REST-API ist der stabile Vertrag — ein späteres SPA konsumiert dieselbe API ohne Backend-Änderung.
* **Negativ:** Kein Komponenten-Modell; bei wachsender UI-Komplexität steigt der Pflegeaufwand (dann SPA-Erweiterungspunkt ziehen).
* CSS-Entscheidung: siehe [ADR-0018] (handgeschrieben statt Tailwind). CSP-Konsequenz: siehe [ADR-0020].

## Verworfene Alternativen

* **React/Vue-SPA:** Build-Pipeline, npm-Abhängigkeitsbaum und Token-Handling im Browser für zwei Masken unverhältnismäßig.
* **Server-side Rendering (Jinja2):** vermischt API- und UI-Auslieferung; statisches Frontend hält NGINX/Backend-Trennung sauber.
