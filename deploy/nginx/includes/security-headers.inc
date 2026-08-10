add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options SAMEORIGIN always;
add_header Referrer-Policy no-referrer always;
# script-src & style-src 'unsafe-inline': erlaubt Seiten-Scripte & E-Mail-Live-Vorschau (srcdoc-iframe)
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'" always;
