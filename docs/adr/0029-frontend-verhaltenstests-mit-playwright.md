# [ADR-0029] Frontend-Verhaltenstests mit Playwright im echten Browser

* **Status:** Akzeptiert — ein Test-Framework fürs Frontend ist Wunsch des Auftraggebers,
  die Auswahl (Playwright) hat er am 2026-10-07 bestätigt
* **Datum:** 2026-10-07
* **Kontext:** Die sieben Skripte in `frontend/public` (klassische Skripte ohne Build-Schritt,
  ADR-0006/0020) hatten keine Verhaltenstests; `test_frontend_statisch.py` prüft nur, was
  sich aus den Dateien ablesen lässt. Vier Ansätze wurden als lauffähige Spikes gegen die
  unveränderten Skripte gebaut und von drei unabhängigen Gutachten nachgemessen: `node --test`
  mit jsdom, `node --test` mit happy-dom, Vitest mit jsdom und Playwright im installierten
  Browser. Der Ausschlag: Das Frontend hatte sichtbare Fehler, die nur der echte Browser
  zeigte — das Attribut `hidden` wurde an vier Stellen von `display`-Regeln in `app.css`
  überstimmt (u. a. Admin-Links für Nicht-Admins im mobilen Menü). Alle drei
  DOM-Nachbildungen blieben darauf grün. Spikes und Gutachten liegen nicht im Repository.
  ADR-0006 („kein Node zur Laufzeit“) gilt weiter; diese Entscheidung betrifft nur
  Entwicklung und CI. Dort kommt damit die Node-Toolchain hinzu, die ADR-0018 für das
  ausgelieferte Frontend vermieden hat.

## Entscheidung

* **Ein Werkzeug:** `@playwright/test`, exakt gepinnt, eigenes Lockfile mit Integritätswerten
  (`npm ci`), `.npmrc` mit `ignore-scripts=true`. Drei Pakete, keine Install-Skripte.
* **Ort:** `frontend/tests/` — nie `frontend/public`. Das Verzeichnis ist aus Docker-Kontext
  und Deploy-Tar ausgeschlossen; ein statischer Test prüft, dass `frontend/public` kein
  Testwerkzeug enthält.
* **`harness.js`** liefert `frontend/public` per Route-Interception aus — ohne Webserver und
  Port, mit den Headern aus `deploy/nginx/includes/security-headers.inc` — und beantwortet
  `/api/` und `/auth/` aus einer Routentabelle je Test. Anfrage ohne Stub, CSP-Verstoß,
  Skriptfehler und unerwartete Rückfrage lassen den Test scheitern. Die Uhr der Seite steht
  und wird vom Test gestellt.
* **Ausführung auf dem Host:** Entwicklerrechner nutzen den installierten Browser (Edge
  unter Windows, sonst Chrome), ohne Download. Die CI nutzt das zur gepinnten
  Playwright-Version gehörende Chromium (`make install-frontend-browser`,
  `FRONTEND_BROWSER=chromium-headless-shell`).
* **Targets:** `install-frontend`, `install-frontend-browser`, `test-frontend`;
  `make check` schließt `test-frontend` ein.
* **Hausregeln** (`frontend/tests/README.md`); ein Test prüft die gängigen Schreibweisen
  der ersten vier: `test`/`expect` nur aus `./harness`, kein `test.fail`/`skip`/`only`,
  kein Warten auf Zeit. Ein bekannter Fehler wird behoben oder als Ist-Verhalten positiv
  festgehalten.
* `test_frontend_statisch.py` bleibt als zweite, Node-freie Schicht: Einen Inline-Handler
  meldet der Browser erst, wenn er feuert.

## Konsequenzen

* **Positiv:** Geprüft wird, was der Nutzer bekommt — CSS-Kaskade, durchgesetzte CSP (auch im
  Vorschau-iframe), echter Fokus, echte Navigation, echter Rückfrage-Dialog. Uhr, Dialoge
  und Warten kommen aus dem Framework; der eigene Code ersetzt nur den Server. Die Tests
  haben beim Einführen Fehler im Produktionscode aufgedeckt (siehe CHANGELOG).
* **Negativ / Risiken:**
  * `make check` braucht jetzt Node >= 22 und einen automatisierbaren Edge oder Chrome; je
    Rechner einmal `make install-frontend`.
  * Zweites Ökosystem mit eigenem Lockfile und eigener Aktualisierungsroutine (RUNBOOK 5c).
    Playwright bündelt Drittcode, den `npm audit` und eine SBOM nicht sehen.
  * Neue Verbindungen für Entwicklerrechner und CI, **nie für die VM**:
    `registry.npmjs.org`, für `npm audit signatures` zusätzlich `tuf-repo-cdn.sigstore.dev`,
    in der CI zusätzlich `cdn.playwright.dev` (Browser, rund 115 MiB; leitet auf weitere
    Download-Hosts weiter) und die Paketquellen des Runners (`--with-deps` ruft `apt-get`
    mit Root-Rechten auf). Erreichbarkeit hinter dem Konzern-Proxy ist offen (Frage B8).
  * Der Browser der Entwicklerrechner ist nicht gepinnt und aktualisiert sich selbst; die CI
    gleicht das mit dem gepinnten Chromium aus. Playwright bewusst und regelmäßig anheben.
  * Zwei Startparameter in `playwright.config.js` halten Edge/Chrome davon ab, während der
    Tests an ihren Hersteller zu funken. Kein Test bewacht sie.
  * Langsamer als eine DOM-Nachbildung und lastabhängig; deshalb 30 s Zeitlimit je Test und
    keine Wiederholungen (ein Wackler soll auffallen). Beobachtet bei doppelter Zahl
    paralleler Browser (12 statt 6): einmal blieb das Schließen eines Browser-Kontexts
    hängen, der Test lief ins Zeitlimit. Ursache ungeklärt, bei 6 nicht aufgetreten.
  * Die API-Antworten sind handgeschriebene Stubs (`daten.js`): Ein im Backend umbenanntes
    Feld fällt hier nicht auf. Eine Coverage-Zahl fürs Frontend gibt es nicht.
  * **Nicht geprüft:** ein echter Lauf in GitHub Actions; Browser-Automatisierung unter einer
    Konzern-Gruppenrichtlinie.
  * **Umkehrbedingung:** Ist die Automatisierung auf den Zielrechnern untersagt und der
    Chromium-Download nicht möglich, ist `node --test` mit jsdom der Ausweichweg — mit den
    blinden Flecken unten.

## Verworfene Alternativen

* **`node --test` mit jsdom oder happy-dom:** schnell und mit kleinem Baum, sieht aber weder
  CSS noch CSP noch Fokusverlust und blieb auf den vier Sichtbarkeitsfehlern grün. Die
  Navigation ließ sich nur über jsdom-Interna oder eine Naht im Produktionscode beobachten;
  happy-dom brauchte einen Workaround für `:checked`.
* **Vitest oder Jest mit jsdom:** etablierte Frameworks, sparen bei klassischen Skripten ohne
  Module aber keinen Eigenbau, bringen ein Vielfaches an Paketen mit und führen die
  Seitenskripte als Funktionen statt als Skripte aus — vertauschte `<script>`-Tags blieben
  grün.
* **Playwright im Container:** ein Abbild von über 800 MB; ohne Bind-Mounts (OneDrive)
  müsste der Code je Lauf eingebacken werden, und getestet würde ein anderer Browser als
  der der Nutzer.
* **Playwright über die Python-Anbindung:** käme ohne npm aus, wurde aber nicht als Spike
  gebaut; eine Stichprobe zeigte einen Konflikt mit den asynchronen Backend-Tests in
  derselben pytest-Sitzung.
