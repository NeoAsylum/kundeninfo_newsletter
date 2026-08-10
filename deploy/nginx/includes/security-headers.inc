# HSTS gehört mit in diese Datei: NGINX ersetzt add_header aus dem Serverblock
# vollständig, sobald eine Location eigene add_header setzt. Über http (DEV)
# ignorieren Browser den Header, dort ist er also unschädlich.
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy no-referrer always;
# script-src 'self': Seiten-Skripte liegen extern (app.js, abos.js, versand.js) — keine
# Inline-Skripte, kein 'unsafe-inline' für Scripts (XSS-Härtung).
# style-src 'unsafe-inline': nötig für die E-Mail-Live-Vorschau (srcdoc-iframe erbt die
# CSP und rendert Outlook-taugliches Inline-CSS) sowie style-Attribute der Fehlerkarten.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'" always;
