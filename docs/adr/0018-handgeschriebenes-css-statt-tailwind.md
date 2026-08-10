# [ADR-0018] Handgeschriebenes CSS statt Tailwind-Standalone-CLI

* **Status:** Akzeptiert (Abweichung vom Plan 3.5)
* **Datum:** 2026-08-10
* **Kontext:** Der Plan sah Tailwind via Standalone-CLI mit versioniertem Build-Artefakt vor. Das CLI ist ein ~100-MB-Binary von GitHub — dessen Bezug ist hinter Konzern-Proxys ein eigener Klärpunkt.

## Entscheidung

Ein **handgeschriebenes CSS-Designsystem** (`frontend/public/assets/app.css`, ~350 Zeilen mit Design-Tokens als Custom Properties) statt Tailwind. Kein Build-Schritt, kein Binary-Bezug, keine Toolchain.

## Konsequenzen

* **Positiv:** Der Frontend-„Build“ entfällt komplett (noch proxy-sicherer als der Plan); vier Seiten teilen ein lesbares Stylesheet; die GitHub-Erreichbarkeitsfrage aus B8 entfällt.
* **Negativ:** Kein Utility-Vokabular — neue UI-Elemente brauchen bewusste CSS-Pflege. Bei deutlichem UI-Wachstum bleibt der Wechsel auf Tailwind (oder ein SPA, [ADR-0006]) möglich; die Klassenstruktur ist dafür neutral gehalten.

## Verworfene Alternativen

* **Tailwind-Standalone-CLI:** Binary-Beschaffung + Build-Schritt für vier statische Seiten unverhältnismäßig.
* **Tailwind via npm:** Node-Toolchain, die der Plan ausdrücklich vermeiden wollte.
