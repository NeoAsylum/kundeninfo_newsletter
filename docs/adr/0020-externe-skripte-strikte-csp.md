# [ADR-0020] Externe Seiten-Skripte + strikte CSP (script-src 'self')

* **Status:** Akzeptiert (ersetzt die Zwischenlösung `script-src 'unsafe-inline'`)
* **Datum:** 2026-08-10
* **Kontext:** Die Masken nutzten anfangs Inline-`<script>`-Blöcke. Die strikte CSP (`script-src 'self'`) blockierte sie — als Zwischenlösung wurde `'unsafe-inline'` erlaubt (Commit a74d30c), was den XSS-Schutz der CSP für Skripte faktisch aufhebt.

## Entscheidung

Seiten-Skripte liegen als **externe Dateien** vor (`app.js`, `abos.js`, `versand.js`), Inline-Skripte und Inline-Event-Handler (`onclick=`) sind entfernt. Die CSP steht wieder auf **`script-src 'self'`**. `style-src 'unsafe-inline'` bleibt: die E-Mail-Live-Vorschau (srcdoc-iframe erbt die CSP) rendert Outlook-taugliches Inline-CSS.

## Konsequenzen

* **Positiv:** Selbst wenn ein Escaping-Fehler HTML einschleusen ließe, führt der Browser kein injiziertes Skript aus — die CSP ist wieder eine echte zweite Verteidigungslinie. In einem Portal, das an ~5.000 Empfänger mailt, ist das die richtige Priorität.
* **Negativ:** Neue Seiten brauchen eine eigene JS-Datei statt eines Inline-Blocks (bewusste Disziplin).
* **Regel:** Keine Inline-Skripte/-Handler im Frontend — CSP-Verstöße fallen sofort in der Browser-Konsole auf.

## Verworfene Alternativen

* **`script-src 'unsafe-inline'` beibehalten:** funktioniert, gibt aber die wichtigste CSP-Schutzwirkung auf.
* **Nonce-basierte CSP:** erfordert dynamisches HTML-Rendering — die Seiten sind bewusst statisch ([ADR-0006]).
