# HSTS gehört mit in diese Datei: NGINX ersetzt add_header aus dem Serverblock
# vollständig, sobald eine Location eigene add_header setzt. Über http (DEV)
# ignorieren Browser den Header, dort ist er also unschädlich.
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy no-referrer always;
# script-src 'self': Jede Seite lädt app.js plus ihre eigene Datei — keine Inline-Skripte,
# kein 'unsafe-inline' für Scripts (XSS-Härtung). Bewusst ohne Aufzählung der Dateien:
# 'self' erlaubt jedes Skript gleicher Herkunft, eine Liste hier wäre nur Pflegeschuld.
# style-src 'unsafe-inline': nötig für die E-Mail-Live-Vorschau (srcdoc-iframe erbt die
# CSP und rendert Outlook-taugliches Inline-CSS).
# form-action 'self': default-src deckt Formularziele nicht ab — ohne die Angabe dürfte
# ein eingeschleustes Formular an jede fremde Adresse senden.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" always;
