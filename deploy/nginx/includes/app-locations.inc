# Gemeinsame Locations für DEV- und PROD-Serverblock (eine Wahrheit, kein Drift).

location /api/ {
    proxy_pass http://api:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
}

location /auth/ {
    proxy_pass http://api:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

# Statisches Frontend
location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ =404;
}
