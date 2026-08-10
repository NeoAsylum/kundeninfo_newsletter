add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy no-referrer always;
# style-src 'unsafe-inline': die E-Mail-Live-Vorschau (srcdoc-iframe) rendert
# Outlook-taugliches Inline-CSS und erbt die CSP der Seite.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'" always;
