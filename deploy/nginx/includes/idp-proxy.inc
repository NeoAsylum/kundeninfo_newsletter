# Gemeinsame Proxy-Einstellungen für die durchgereichten Keycloak-Pfade.
# X-Forwarded-* setzt NGINX selbst (nicht vom Client übernehmen), damit Keycloak
# keine gefälschten Host-/Proto-Angaben verarbeitet.
proxy_pass http://keycloak:8081;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
# NICHT verketten: Keycloak vertraut dem linkesten Eintrag als Client-IP
# (KC_PROXY_HEADERS=xforwarded) — ein Client könnte damit den Brute-Force-Zähler
# und die Ratenlimits auf eine fremde IP umlenken.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Port 443;
proxy_buffer_size 16k;
proxy_buffers 8 16k;
