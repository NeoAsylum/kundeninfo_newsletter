# Gemeinsame Locations für DEV- und PROD-Serverblock (eine Wahrheit, kein Drift).
#
# X-Forwarded-For wird auf $remote_addr gesetzt, NICHT verkettet: NGINX ist der
# einzige vertrauenswürdige Proxy. Bei $proxy_add_x_forwarded_for könnte ein Client
# eine fremde IP voranstellen — Keycloak (KC_PROXY_HEADERS=xforwarded) nimmt den
# linkesten Eintrag als Client-IP, womit sich Brute-Force-Zähler und Ratenlimits
# unterlaufen ließen.

location /api/ {
    # Auch API-Antworten bekommen die Sicherheits-Header. Sie werden bewusst NICHT
    # serverweit gesetzt (das überschriebe die Header der durchgereichten
    # Keycloak-Seiten), aber jede Antwort, die aus DIESER Anwendung kommt, soll sie
    # tragen — insbesondere nosniff, damit eine JSON-Antwort nirgends als HTML
    # interpretiert werden kann.
    include /etc/nginx/includes/security-headers.inc;
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
}

# Die Empfänger- und Rollen-Suche überträgt Adressen als ?query=… . Das Access-Log lässt den
# Query-String weg (nginx.conf: $uri), das Fehlerlog lässt sich nicht formatieren: Es nennt
# zu jedem Fehler die ganze Anfragezeile — antwortet die API nicht, stünde die gesuchte
# Adresse darin (ADR-0014). Für genau diesen Pfad schreibt NGINX deshalb kein Fehlerlog; ein
# Ausfall der API steht für jeden anderen Pfad weiter darin. Alles Übrige wie in /api/.
location = /api/v1/admin/users {
    error_log /dev/null;
    include /etc/nginx/includes/security-headers.inc;
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
}

location /auth/ {
    include /etc/nginx/includes/security-headers.inc;
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
}

# Health-Endpunkte von außen erreichbar (Smoke-Test, Konzern-Monitoring — Plan 7.1)
location = /healthz {
    proxy_pass http://api:8000;
    proxy_set_header X-Request-ID $request_id;
}

location = /readyz {
    proxy_pass http://api:8000;
    proxy_set_header X-Request-ID $request_id;
}

# Lokaler Stub für den Container-Healthcheck — bewusst ohne Backend-Kopplung (Plan 3.2)
location = /nginx-health {
    access_log off;
    return 200 "ok\n";
}

# Statisches Frontend — hier gelten die Sicherheits-Header (CSP & Co.). Sie werden
# bewusst NICHT serverweit gesetzt, damit sie nicht über durchgereichte
# Keycloak-Seiten gelegt werden, die ihre eigenen Header mitbringen.
location / {
    include /etc/nginx/includes/security-headers.inc;
    # Jede statische Datei bei jedem Aufruf revalidieren (ETag, meist 304). Ohne die Angabe
    # halten Browser ihre Kopie heuristisch für frisch und fragen nach einem Deploy zunächst
    # nicht nach — alte Seite gegen neue API.
    add_header Cache-Control "no-cache" always;
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ =404;
}
