# Frontend-Verhaltenstests

Playwright Test im echten Browser gegen die unveränderten Seiten in `frontend/public`
([ADR-0029](../../docs/adr/0029-frontend-verhaltenstests-mit-playwright.md)). Kein Webserver,
keine API, kein Netz: `harness.js` liefert die Dateien per Route-Interception aus — mit den
Sicherheits-Headern aus der NGINX-Konfiguration — und beantwortet `/api/` und `/auth/` aus
der Routentabelle des Tests. Nichts aus diesem Verzeichnis gelangt in ein Image.

## Ausführen

```sh
make install-frontend      # einmalig: drei Pakete aus dem Lockfile (Node 22+)
make test-frontend         # alle Tests; Teil von `make check`
cd frontend/tests && npx playwright test abos.spec.js          # eine Datei
cd frontend/tests && npx playwright show-trace test-results/<test>/trace.zip   # Fehlersuche
```

Genutzt wird der installierte Browser (Edge unter Windows, sonst Chrome). Die CI setzt
`FRONTEND_BROWSER=chromium-headless-shell` und lädt dafür das zur Playwright-Version
gehörende Chromium (`make install-frontend-browser`) — derselbe Weg gilt für einen Rechner
ohne Edge und Chrome.

## Regeln

Die Schnittstelle des Harness steht im Kopfkommentar von `harness.js`, die Testdaten in
`daten.js`. Ein Test in `harness.spec.js` prüft die gängigen Schreibweisen der ersten vier
Regeln; `npm test` (und damit `make check`) lehnt außerdem ein vergessenes `test.only` ab.

1. `test` und `expect` kommen aus `./harness`, nie aus `@playwright/test` — sonst gibt es
   weder Stubs noch CSP-Prüfung noch gestellte Uhr.
2. Kein `test.fail`/`skip`/`fixme`/`only`. Ein bekannter Fehler wird behoben oder als
   „IST-VERHALTEN (Befund): …“ positiv festgehalten.
3. Nicht auf Zeit oder Netzruhe warten, sondern auf das, was der Nutzer sieht
   (`await expect(locator).toHaveText(…)`).
4. Rückfragen über `api.confirmNext(true|false)` beantworten, den Toast über `expectToast()`
   prüfen (`toBeVisible()` ist auch beim ausgeblendeten Toast wahr). `expectToast()` prüft
   einen Zustand: Vor einer zweiten Aktion mit demselben Text die Uhr vorstellen, bis der
   erste Toast verschwunden ist — sonst trifft die Prüfung noch den alten.
5. Jede Anfrage braucht einen Stub; eine ohne lässt den Test scheitern. Geprüft wird, was
   die Seite gesendet hat: `api.calls("PUT /api/v1/…")` mit `query`, `json`, `headers`.
6. Die Uhr der Seite steht. Entprellung, Polling und Toast-Fristen laufen nur mit
   `await page.clock.runFor(ms)` — beide Seiten der Grenze prüfen (349 ms / 1 ms).
7. Vor jeder Aussage „es ging nichts raus“ oder „die verspätete Antwort hat nichts
   überschrieben“: `await api.sync()` — danach ist die Seite zur Ruhe gekommen, auch
   Folgeanfragen sind protokolliert. Sendet sie ohne Ende weiter, scheitert der Test daran.
8. Zwischenzustände (gesperrt während der Anfrage, Rollback) mit `hold()` prüfen. „Gesperrt“
   heißt: ein zweiter Klick sendet nichts — `toBeDisabled()` allein ist auch bei bloßem
   `aria-disabled` wahr. Und zwar für Maus UND Tastatur: zusätzlich die Leertaste auf dem
   fokussierten Feld prüfen.
9. Sichtbarkeit prüfen (`toBeVisible()` / `toBeHidden()`), nicht das Attribut `hidden`.
10. Für jedes Feld aus der API, das die Seite anzeigt, ein Test mit dem Angriffstext `XSS`
    aus `daten.js`: Er muss als Text erscheinen, es darf kein Element entstehen.
11. Eine Datei je Skript (`<seite>.spec.js`), Titel als deutsche Sätze, ein Verhalten je Test.
12. `getByRole(…, { name })` trifft auch Teilstrings, ohne Rücksicht auf Groß-/Kleinschreibung —
    `exact: true`, wo sich zwei Zeilen nur darin unterscheiden.
13. Netzfehler über `api.stub(KEY, { abort: true })`; ein Navigationsziel nie mit `hold()`
    zurückhalten (Kopfkommentar von `harness.js`).
14. Fokus-Rückgabe prüfen: Einem gesperrten oder versteckten Element nimmt der Browser den
    Fokus erst mit dem nächsten Rendering. Die Antwort mit `hold()` zurückhalten und vor der
    Freigabe auf `await expect(element).not.toBeFocused()` warten — sonst behält das Element
    den Fokus von allein, und der Test beweist nichts.
15. Die Leertaste blättert animiert (rund 0,2 s). Gibt ein Test währenddessen eine Antwort
    frei, läuft der Bildlauf über das hinweg, was sie auslöst — die Seite dafür mit
    `window.scrollTo` verschieben (ohne Animation). Auf den Bildlauf einer Taste ist auch
    sonst kein Verlass: Gemessen bewegte der Browser die Seite in 5 von rund 1.000 Läufen
    nicht, obwohl die Taste bei ihr ankam.
