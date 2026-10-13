/* Test-Harness für die Seiten in frontend/public (ADR-0029).

   Der Browser ist echt, alles dahinter ist ersetzt: Dieses Modul liefert frontend/public
   ohne Webserver aus (Route-Interception, kein Port) — mit den ECHTEN Sicherheits-Headern
   aus deploy/nginx/includes/security-headers.inc — und beantwortet /api/ und /auth/ aus
   einer Routentabelle des Tests. HTML, app.js und Seitenskript laufen unverändert.

   Was jeder Test über die Fixture `api` bekommt:
     api.stub("GET /api/v1/me", { json: {...} })     Antwort festlegen: { status, json } | { status, html }
     api.stub({ "GET /a": {...}, "PUT /b": {...} })  … mehrere auf einmal
     api.stub("PUT /api/v1/x", (call) => antwort)    … berechnet; auch async oder zurückgehalten (hold)
     api.stub("GET /api/v1/x", { abort: true })      Netzfehler: die Anfrage scheitert, fetch() wirft
     api.calls("PUT /api/v1/x")                      was die Seite gesendet hat: { key, query, headers, json }
     api.calls()                                     … alle Anfragen in Reihenfolge
     await api.sync()                                die Seite ist zur Ruhe gekommen: Alles, was sie abgesetzt hat, ist
                                                     protokolliert — auch Folgeanfragen —, und jede freigegebene
                                                     Antwort (hold) ist bei ihr angekommen
     api.confirmNext(true | false)                   die NÄCHSTE Rückfrage (window.confirm) beantworten
     api.dialogs                                     Texte aller gestellten Rückfragen
     api.problems                                    was das Harness beanstandet (nur harness.spec.js fasst das an)

   Der Schlüssel ist "METHODE /pfad" ohne Query (die steht in call.query); für Ziele
   außerhalb der Anwendung "METHODE https://host/pfad".

   Am Testende scheitert der Test, wenn die Seite etwas getan hat, das er nicht vorgesehen
   hat: Anfrage ohne Stub, fehlende Datei, CSP-Verstoß, Skriptfehler, unerwartete oder
   ausgebliebene Rückfrage, Anfragen ohne Ende. Vorher wartet die Fixture wie api.sync(), bis
   die Seite zur Ruhe gekommen ist — auch was sie nach der letzten Prüfung des Tests noch
   tut, zählt.

   Die Uhr der Seite steht. Timer (Entprellung, Polling, Toast) und Date.now() bewegen sich
   nur, wenn der Test `await page.clock.runFor(ms)` aufruft.

   Grenzen, die man kennen muss:
   - Ein Navigationsziel (GET /auth/login, der IdP) nie mit hold() zurückhalten: Solange die
     Navigation hängt, wartet Playwright bei JEDER Aktion und Prüfung bis zum Zeitlimit. Wer
     die Seite „während der Weiterleitung“ ansehen will, beantwortet das Ziel mit
     { status: 204 } — dann bleibt der Browser auf der Seite.
   - Nach `await api.sync()` darf ein gerade zurückgehaltener Schlüssel neu belegt werden:
     Die hängende Anfrage behält ihre Antwort, spätere bekommen den neuen Stub.
   - api.sync() nicht mehr aufrufen, nachdem die Seite zu einem fremden Host navigiert ist
     (der Marker ginge dann an dessen Origin).
   - Läuft am Testende noch ein Seitenwechsel, endet das Warten mit ihm: Was die nächste
     Seite tut, zählt nicht mehr. Wer dorthin navigiert, wartet im Test auf das Ziel.
   - Timer mit Verzögerung 0, die eine Seite schon beim Laden setzt, laufen von selbst; ein
     Fehler darin landet nur in der Konsole. Die Seiten haben keinen solchen Timer.
   - Der Browser läuft ohne Back/Forward-Cache: page.goBack() lädt neu. Was eine aus diesem
     Cache zurückgeholte Seite tut, lässt sich nur über das Ereignis `pageshow` nachstellen. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test: base, expect } = require("@playwright/test");

const REPO = path.resolve(__dirname, "..", "..");
const PUBLIC = path.join(REPO, "frontend", "public");
const JETZT = new Date("2026-01-15T08:00:00Z"); // feste Startzeit jeder Seite
const SYNC = "/api/__sync"; // Markeranfrage von api.sync(), erscheint nicht in api.calls()
const KEINE_RUHE = "die Seite kommt nicht zur Ruhe: Sie sendet auch nach 20 Runden noch Anfragen";

// Eine Wahrheit: dieselbe Datei, die NGINX per include lädt. Jede add_header-Zeile muss
// gelesen werden — eine, die das Muster nicht trifft (ohne `always`, eingerückt, zweimal
// derselbe Name), fehlte hier sonst still, während NGINX sie sendet.
const HEADER_DATEI = fs.readFileSync(path.join(REPO, "deploy", "nginx", "includes", "security-headers.inc"), "utf8");
const HEADER_ZEILEN = [...HEADER_DATEI.matchAll(/^add_header\s+(\S+)\s+(?:"([^"]*)"|(\S+))\s+always;$/gm)];
const SECURITY_HEADERS = Object.fromEntries(HEADER_ZEILEN.map(([, name, quoted, bare]) => [name, quoted ?? bare]));
if (Object.keys(SECURITY_HEADERS).length !== (HEADER_DATEI.match(/^\s*add_header\b/gm) || []).length) {
  throw new Error("security-headers.inc: nicht jede add_header-Zeile ist lesbar (Form: add_header Name Wert always;)");
}
// Wie NGINX im Linux-Container: Groß-/Kleinschreibung zählt, auch wenn das Dateisystem des
// Entwicklerrechners sie ignoriert.
const DATEIEN = new Set();
(function sammle(verzeichnis, pfad) {
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    if (eintrag.isDirectory()) sammle(path.join(verzeichnis, eintrag.name), pfad + eintrag.name + "/");
    else if (eintrag.isFile()) DATEIEN.add(pfad + eintrag.name);
  }
})(PUBLIC, "/");

const test = base.extend({
  api: [async ({ context, page, baseURL }, use) => {
    const origin = new URL(baseURL).origin;
    const stubs = new Map(); // "GET /api/v1/me" → Antwort | (call) => Antwort
    const calls = []; // jede Anfrage an /api/, /auth/ und an fremde Hosts
    const dialogs = []; // Texte der Rückfragen
    const answers = []; // vom Test vorab hinterlegte Antworten auf Rückfragen
    const problems = []; // am Testende nicht leer → Test rot
    const unterwegs = new Set(); // Antworten, die gerade an den Browser übergeben werden

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const extern = url.origin !== origin;
      if (!extern && url.pathname === SYNC) return route.fulfill({ status: 204, headers: SECURITY_HEADERS });
      if (extern || /^\/(api|auth)\//.test(url.pathname)) {
        const call = {
          key: request.method() + " " + (extern ? url.origin : "") + url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers: request.headers(),
          json: request.postDataJSON(),
        };
        calls.push(call);
        let answer = stubs.get(call.key);
        if (typeof answer === "function") answer = await answer(call);
        if (answer && answer.abort) return route.abort("failed"); // Netzfehler, kein Harness-Problem
        if (!answer) {
          problems.push("kein Stub für " + call.key);
          return route.abort();
        }
        const html = answer.html !== undefined;
        const uebergabe = route.fulfill({
          status: answer.status ?? 200,
          headers: { ...SECURITY_HEADERS, "content-type": html ? "text/html" : "application/json" },
          body: html ? answer.html : answer.json === undefined ? "" : JSON.stringify(answer.json),
        }).catch(() => {}); // Seite inzwischen weg (Navigation, Testende)
        unterwegs.add(uebergabe);
        await uebergabe;
        unterwegs.delete(uebergabe);
        return;
      }
      // wie nginx: index index.html; try_files $uri =404. Der Content-Type folgt der Endung.
      let pfad = null;
      try { pfad = decodeURIComponent(url.pathname); } catch { /* kaputte Kodierung: 404 */ }
      if (pfad && pfad.endsWith("/")) pfad += "index.html";
      if (!DATEIEN.has(pfad)) {
        problems.push("Datei fehlt: " + url.pathname);
        return route.fulfill({ status: 404, headers: SECURITY_HEADERS, body: "" });
      }
      return route.fulfill({ path: path.join(PUBLIC, pfad), headers: SECURITY_HEADERS });
    });

    // Ohne eigenen Handler würde Playwright jede Rückfrage still ABLEHNEN — der Test liefe
    // dann unbemerkt durch den Abbrechen-Zweig. Deshalb: jede Rückfrage braucht eine
    // vorab hinterlegte Antwort, sonst ist sie ein Problem.
    context.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      if (!answers.length) {
        problems.push("unerwartete Rückfrage: " + dialog.message());
        return dialog.dismiss();
      }
      return answers.shift() ? dialog.accept() : dialog.dismiss();
    });

    // CSP-Verstöße schreibt der Browser als Fehler in die Konsole — auch die aus dem
    // sandboxed Vorschau-iframe, in dem kein Skript mithören könnte.
    context.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) problems.push("CSP: " + message.text());
    });
    context.on("weberror", (webError) => problems.push("Skriptfehler: " + webError.error().message));

    // Eine Stunde VOR JETZT installieren: Ab install läuft die Uhr mit der echten Zeit, bis
    // pauseAt sie anhält. Braucht ein ausgelasteter Rechner dazwischen länger als der Abstand
    // zum Ziel, scheitert pauseAt („Cannot fast-forward to the past“) — der Test fiele im
    // Aufbau um, was immer er prüft. Jede Seite startet trotzdem bei JETZT + 1 s.
    await page.clock.install({ time: new Date(JETZT.getTime() - 3600000) });
    await page.clock.pauseAt(new Date(JETZT.getTime() + 1000));

    // Eine Runde: freigegebene Antworten (hold) fertig übergeben, dann eine Markeranfrage
    // durch die Seite schicken. Anfragen erreichen das Harness in der Reihenfolge, in der die
    // Seite sie absetzt — ist der Marker beantwortet, sind alle früheren protokolliert.
    // Wiederholt, bis eine Runde nichts Neues bringt: So sind auch Folgeanfragen erfasst, die
    // die Seite erst als Reaktion auf eine Antwort absetzt.
    const runde = async () => {
      await new Promise((weiter) => setImmediate(weiter)); // freigegebene Handler anlaufen lassen
      await Promise.all([...unterwegs]);
      await page.evaluate((marker) => fetch(marker).then(() => undefined), SYNC);
    };
    // limit (ms): so lange darf EINE Runde dauern, sonst endet das Warten ohne Befund — für
    // das Testende, an dem eine hängende Navigation die Runde aufhält.
    const ruhe = async (limit) => {
      let stand = -1;
      for (let i = 0; i < 20 && stand !== calls.length + problems.length; i += 1) {
        stand = calls.length + problems.length;
        const frist = limit === undefined
          ? []
          : [new Promise((weiter) => setTimeout(() => weiter(true), limit))];
        if (await Promise.race([runde().then(() => false), ...frist])) return;
      }
      // Brachte auch die letzte Runde Neues, sendet die Seite in einer Schleife — „zur Ruhe
      // gekommen“ wäre dann gelogen.
      if (stand !== calls.length + problems.length) problems.push(KEINE_RUHE);
    };

    await use({
      stub: (keyOrTable, answer) => {
        const table = typeof keyOrTable === "string" ? { [keyOrTable]: answer } : keyOrTable;
        for (const [key, value] of Object.entries(table)) stubs.set(key, value);
      },
      calls: (key) => (key === undefined ? [...calls] : calls.filter((call) => call.key === key)),
      // Erst danach ist „es ging KEINE (weitere) Anfrage raus“ eine belastbare Aussage, und
      // „die verspätete Antwort hat NICHTS überschrieben“ prüfbar.
      sync: () => ruhe(),
      confirmNext: (accept) => { answers.push(Boolean(accept)); },
      dialogs,
      problems,
    });

    // Einsammeln, was die Seite bis zum Testende noch abgesetzt oder gemeldet hat: Anfragen,
    // CSP-Meldungen und Skriptfehler kommen asynchron an — unrouteAll schnitte sie ab, und
    // ein Test, dessen letzte Zeile eine Antwort freigibt, bliebe grün, was immer danach
    // geschieht. Nur solange die Seite noch auf der Anwendung steht; höchstens 2 s je Runde.
    if (!page.isClosed() && page.url().startsWith(origin + "/")) {
      await ruhe(2000).catch(() => {});
    }
    // Zurückgehaltene Antworten (hold) dürfen das Aufräumen nicht aufhalten.
    await context.unrouteAll({ behavior: "ignoreErrors" });
    if (answers.length) problems.push("Rückfrage erwartet, aber die Seite hat keine gestellt");
    expect(problems, "die Seite hat etwas getan, das der Test nicht vorgesehen hat").toEqual([]);
  }, { auto: true }],
});

/** Antwort, die der Test zurückhält, um den Zwischenzustand zu prüfen:
 *    const put = hold(); api.stub(KEY, put.answer);  …klicken, Zwischenzustand prüfen…
 *    put.release({ status: 409, json: {...} }); */
function hold() {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  return { answer: () => pending, release };
}

/** Der Toast wird über opacity ein- und ausgeblendet — toBeVisible() ist deshalb auch beim
 *  ausgeblendeten Toast wahr. Diese Prüfung meint „der Nutzer liest gerade diesen Text“. */
async function expectToast(page, text, { error = false } = {}) {
  const toast = page.locator("#toast");
  await expect(toast).toHaveText(text);
  await expect(toast).toContainClass("show");
  if (error) await expect(toast).toContainClass("error");
  else await expect(toast).not.toContainClass("error");
  await expect(toast).toHaveCSS("opacity", "1");
}

module.exports = { test, expect, hold, expectToast };
