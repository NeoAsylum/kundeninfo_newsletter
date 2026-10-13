/* Selbsttest des Harness und der Hausregeln. Ohne ihn könnte die CSP unbemerkt fehlen
   (Tippfehler im Pfad, geänderte Syntax in security-headers.inc) oder ein Schutznetz des
   Harness still ausfallen — und alle anderen Tests blieben grün. */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test, expect, hold } = require("./harness");
const { admin, topic } = require("./daten");

test("Seiten tragen die Sicherheits-Header aus der NGINX-Konfiguration", async ({ page }) => {
  const typen = {};
  page.on("response", (response) => { typen[new URL(response.url()).pathname] = response.headers()["content-type"]; });
  const antwort = await page.goto("/datenschutz.html");
  const header = antwort.headers();
  expect(header["content-security-policy"]).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  expect(header["strict-transport-security"]).toBe("max-age=31536000");
  expect(header["x-content-type-options"]).toBe("nosniff");
  expect(header["x-frame-options"]).toBe("SAMEORIGIN");
  expect(header["referrer-policy"]).toBe("no-referrer");
  // … und kein weiterer: Jede Zeile der Datei ist oben einzeln geprüft.
  const quelle = fs.readFileSync(path.join(__dirname, "..", "..", "deploy", "nginx", "includes", "security-headers.inc"), "utf8");
  expect(quelle.match(/^\s*add_header\b/gm)).toHaveLength(5);
  await expect(page.locator(".topbar")).toHaveCSS("position", "sticky"); // app.css ist angekommen
  expect(typen).toEqual({ "/datenschutz.html": "text/html", "/assets/app.css": "text/css" });
});

test("der Browser setzt die CSP durch: Inline-Skript und Inline-Handler laufen nicht", async ({ page, api }) => {
  api.stub("GET /auth/inline.html", {
    html: '<!DOCTYPE html><meta charset="utf-8"><title>x</title>' +
      "<script>window.gekapert = 'inline-skript'</script>" +
      '<button id="knopf" onclick="window.gekapert = \'inline-handler\'">Klick</button>',
  });
  await page.goto("/auth/inline.html");
  await page.locator("#knopf").click();

  expect(await page.evaluate(() => window.gekapert)).toBeUndefined();
  await expect.poll(() => api.problems).toEqual([
    expect.stringMatching(/^CSP: .*inline script/),
    expect.stringMatching(/^CSP: .*inline event handler/),
  ]);
  api.problems.length = 0; // hier erwartet — sonst ließe das Harness den Test scheitern
});

test("auch im Vorschau-iframe (srcdoc, sandbox) fällt ein CSP-Verstoß auf", async ({ page, api }) => {
  api.stub({
    "GET /api/v1/me": { json: admin() },
    "GET /api/v1/topics": { json: [topic()] },
    "GET /api/v1/admin/topics/sap/recipient-count": { json: { topic_id: "sap", count: 5 } },
    "GET /api/v1/admin/dispatches": { json: [] },
    "POST /api/v1/admin/dispatches/preview": {
      json: { subject: "x", html: '<p>Vorschau</p><img src="https://tracker.example/pixel.gif">' },
    },
  });
  await page.goto("/versand.html");
  await page.locator("#topic").selectOption("sap");
  await page.locator("#title").fill("Titel");
  await page.locator("#body").fill("Text");
  await page.clock.runFor(350); // Entprellung der Vorschau

  await expect(page.frameLocator("#preview-frame").locator("p")).toHaveText("Vorschau");
  // Der Zählpixel wird nicht geladen (sonst stünde hier „kein Stub für GET https://tracker…“):
  await expect.poll(() => api.problems).toEqual([
    expect.stringMatching(/^CSP: .*tracker\.example\/pixel\.gif.*img-src 'self' data:/),
  ]);
  api.problems.length = 0;
});

/* Die sechs folgenden Tests MÜSSEN scheitern (test.fail): Sie belegen, dass ein notiertes
   Problem den Test am Ende wirklich rot macht. Fiele die Schlussprüfung der Fixture weg,
   bestünden sie unerwartet — und genau das meldet der Lauf dann als Fehler. Alle übrigen
   Tests dieser Datei leeren api.problems selbst und könnten das nicht bemerken. */

test("Schlussprüfung: eine Anfrage ohne Stub macht den Test rot", async ({ page }) => {
  test.fail();
  await page.goto("/datenschutz.html");
  await page.evaluate(() => fetch("/api/v1/gibt-es-nicht").catch(() => {}));
});

test("Schlussprüfung: eine fehlende Datei macht den Test rot", async ({ page }) => {
  test.fail(); // ohne eigene Prüfung: Scheitern darf dieser Test nur an der Schlussprüfung
  await page.goto("/datenschutz.html");
  await page.evaluate(() => fetch("/gibt-es-nicht.js"));
});

test("Schlussprüfung: eine hinterlegte, aber nie gestellte Rückfrage macht den Test rot", async ({ page, api }) => {
  test.fail();
  await page.goto("/datenschutz.html");
  api.confirmNext(true);
});

test("Schlussprüfung: was die Seite NACH der letzten Zeile des Tests tut, zählt mit", async ({ page, api }) => {
  test.fail();
  const antwort = hold();
  api.stub("GET /api/v1/a", antwort.answer);
  await page.goto("/datenschutz.html");
  await page.evaluate(() => { fetch("/api/v1/a").then(() => fetch("/api/v1/folgt-ohne-stub")); });
  await api.sync();
  antwort.release({ json: {} }); // die Folgeanfrage entsteht erst jetzt — nach dem Testende
});

test("Schlussprüfung: eine Seite, die am Testende ohne Ende weitersendet, macht den Test rot", async ({ page, api }) => {
  test.fail(); // ohne api.sync(): Auffallen muss die Schleife dem Schlusswarten der Fixture
  api.stub("GET /api/v1/immer", { json: {} });
  await page.goto("/datenschutz.html");
  await page.evaluate(() => {
    // Ein Abbruch beim Aufräumen beendet die Schleife still — rot machen darf den Test nur das Schlusswarten.
    const weiter = () => fetch("/api/v1/immer").then(weiter, () => {});
    weiter();
  });
});

test("Schlussprüfung: die Schleife fällt auch auf, wenn das Schlusswarten dafür länger als 2 s braucht", async ({ page, api }) => {
  test.fail(); // die 2 s gelten je Runde, nicht für das ganze Warten — sonst endete es hier vor dem Befund
  api.stub("GET /api/v1/immer", { json: {} });
  await page.goto("/datenschutz.html");
  await page.evaluate(() => {
    const weiter = () => fetch("/api/v1/immer").then(weiter, () => {});
    weiter();
  });
  // Ab hier dauert jede Markerrunde des Harness (sie läuft über page.evaluate) mindestens 120 ms, 20 Runden also 2,4 s.
  const evaluate = page.evaluate.bind(page);
  page.evaluate = async (...argumente) => {
    await new Promise((weiter) => setTimeout(weiter, 120));
    return evaluate(...argumente);
  };
});

test("ein am Testende hängendes Navigationsziel hält das Aufräumen nur 2 s auf, nicht bis zum Zeitlimit", async ({ page, api }) => {
  const ziel = hold(); // entgegen der Regel im Kopf von harness.js zurückgehalten: Die Schlussrunde der Fixture hängt daran
  api.stub("GET /auth/login", ziel.answer);
  await page.goto("/datenschutz.html");
  await page.evaluate(() => { window.location.href = "/auth/login?next=/abos.html"; });
  await expect.poll(() => api.calls("GET /auth/login").length).toBe(1);
});

test("eine Datei gibt es nur in genau ihrer Schreibweise — wie auf dem Linux-Server", async ({ page, api }) => {
  await page.goto("/datenschutz.html");
  // Unter Windows fände das Dateisystem app.js auch als /App.js; NGINX im Container nicht.
  expect(await page.evaluate(() => fetch("/App.js").then((antwort) => antwort.status))).toBe(404);
  expect(api.problems).toEqual(["Datei fehlt: /App.js"]);
  api.problems.length = 0;
});

test("api.sync() erfasst auch Folgeanfragen, die erst auf eine Antwort hin entstehen", async ({ page, api }) => {
  // Acht in Folge: Eine einzelne Markerrunde erfasste davon nur die ersten.
  const kette = ["a", "b", "c", "d", "e", "f", "g", "h"].map((name) => "/api/v1/" + name);
  api.stub(Object.fromEntries(kette.map((pfad) => ["GET " + pfad, { json: {} }])));
  await page.goto("/datenschutz.html");
  await page.evaluate((pfade) => {
    pfade.reduce((bisher, pfad) => bisher.then(() => fetch(pfad)), Promise.resolve());
  }, kette);
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual(kette.map((pfad) => "GET " + pfad));
});

test("api.sync() meldet eine Seite, die nicht zur Ruhe kommt", async ({ page, api }) => {
  api.stub("GET /api/v1/immer", { json: {} });
  await page.goto("/datenschutz.html");
  await page.evaluate(() => {
    const weiter = () => { if (!window.genug) fetch("/api/v1/immer").then(weiter); };
    weiter();
  });
  await api.sync();
  expect(api.problems).toEqual(["die Seite kommt nicht zur Ruhe: Sie sendet auch nach 20 Runden noch Anfragen"]);
  await page.evaluate(() => { window.genug = true; });
  api.problems.length = 0;
});

test("eine Anfrage ohne Stub lässt den Test scheitern (kein stilles Durchreichen ins Netz)", async ({ page, api }) => {
  await page.goto("/datenschutz.html");
  const fehler = await page.evaluate(() => fetch("/api/v1/gibt-es-nicht").catch((error) => error.name));
  expect(fehler).toBe("TypeError"); // fetch scheitert: das Harness bricht die Anfrage ab
  // Auch eine Navigation zu einem fremden Host braucht einen Stub — sonst ist sie ein Problem.
  await page.evaluate(() => { window.location.href = "https://fremd.example/ziel?a=1"; });
  await expect.poll(() => api.problems).toEqual([
    "kein Stub für GET /api/v1/gibt-es-nicht",
    "kein Stub für GET https://fremd.example/ziel",
  ]);
  expect(api.calls("GET https://fremd.example/ziel")[0].query).toEqual({ a: "1" });
  api.problems.length = 0;
});

test("Fehler im Seitencode lassen den Test scheitern, statt in der Konsole zu verschwinden", async ({ page, api }) => {
  await page.goto("/datenschutz.html");
  await page.evaluate(() => {
    document.body.addEventListener("click", () => { throw new Error("im Handler"); });
    Promise.reject(new Error("abgelehnt")); // unbehandelte Ablehnung, z. B. ein init() ohne catch
    setTimeout(() => { throw new Error("im Timer"); }, 10);
  });
  await page.locator("h1").click();
  await expect.poll(() => [...api.problems].sort()).toEqual(["Skriptfehler: abgelehnt", "Skriptfehler: im Handler"]);
  // Ein Fehler in einem Timer trifft den Test direkt an der Stelle, an der er die Uhr stellt.
  await expect(page.clock.runFor(10)).rejects.toThrow("im Timer");
  api.problems.length = 0;
});

test("eine Rückfrage ohne hinterlegte Antwort ist ein Problem — und wird abgelehnt", async ({ page, api }) => {
  await page.goto("/datenschutz.html");
  expect(await page.evaluate(() => window.confirm("Wirklich?"))).toBe(false);
  expect(api.problems).toEqual(["unerwartete Rückfrage: Wirklich?"]);
  api.problems.length = 0;

  api.confirmNext(true);
  expect(await page.evaluate(() => window.confirm("Jetzt aber?"))).toBe(true);
  expect(api.dialogs).toEqual(["Wirklich?", "Jetzt aber?"]);
});

test("die Uhr der Seite steht, bis der Test sie stellt", async ({ page }) => {
  await page.goto("/datenschutz.html");
  const vorher = await page.evaluate(() => { window.gefeuert = 0; setTimeout(() => { window.gefeuert += 1; }, 100); return Date.now(); });
  expect(await page.evaluate(() => Date.now())).toBe(vorher);
  await page.clock.runFor(99);
  expect(await page.evaluate(() => window.gefeuert)).toBe(0);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => [window.gefeuert, Date.now()])).toEqual([1, vorher + 100]);
});

test("Hausregeln: jede Testdatei nutzt das Harness und keine Abkürzungen", () => {
  const verboten = [
    [/(require\(|\bfrom|\bimport\()\s*["'`](@playwright|playwright)\/test["'`]/, "test/expect kommen aus ./harness — sonst gibt es weder Stubs noch CSP noch gestellte Uhr"],
    [/\b(test|describe)(\.\w+)*\.(fail|fixme|skip|only)\b|\btestInfo\.(fail|fixme|skip)\b|\.info\(\)\.(fail|fixme|skip)\b/, "kein test.fail/fixme/skip/only (auch nicht an describe): ein bekannter Fehler wird behoben oder als IST-Verhalten positiv festgehalten"],
    [/waitForTimeout|networkidle|waitForLoadState|(?<!\b(test|testInfo)\.|\.info\(\)\.)\bsetTimeout\b/, "nicht auf Zeit oder Netzruhe warten — auf das warten, was der Nutzer sieht"],
    [/\.on(ce)?\(["']dialog["']/, "Rückfragen über api.confirmNext() beantworten"],
    [/toHaveClass\(["']toast/, "Toast über expectToast() prüfen"],
  ];
  // Die Muster selbst: gängige Schreibweisen treffen, Erlaubtes durchlassen.
  const trifft = (zeile) => verboten.some(([muster]) => muster.test(zeile));
  const abkuerzungen = [
    'require("@playwright/test")', "require('playwright/test')", 'import { test, expect } from "@playwright/test";',
    "test.only(", "test.fail();", 'test.skip(true, "später");', 'test.fixme("später", async () => {});',
    "test.describe.skip(", "test.describe.serial.only(", "testInfo.fail();", "testInfo.skip();", "testInfo.fixme()",
    "test.info().fail();", "test.info().skip()", "test.info().fixme();",
    "await page.waitForTimeout(50)", '{ waitUntil: "networkidle" }', "await page.waitForLoadState();",
    "await new Promise((weiter) => setTimeout(weiter, 50))", "promisify(setTimeout)",
    'page.on("dialog", (dialog) => dialog.accept());', 'page.once("dialog", (dialog) => dialog.accept())',
    'toHaveClass("toast show")',
  ];
  const erlaubt = [
    "test.setTimeout(60000);", "testInfo.setTimeout(testInfo.timeout + 30000);", "test.info().setTimeout(60000);",
    'test.describe("Gruppe", () => {', "await page.clock.runFor(350);", "api.confirmNext(true);",
  ];
  expect(abkuerzungen.filter((zeile) => !trifft(zeile))).toEqual([]);
  expect(erlaubt.filter(trifft)).toEqual([]);

  const dateien = fs.readdirSync(__dirname).filter((name) => name.endsWith(".spec.js"));
  expect(dateien.length).toBeGreaterThan(1);
  const verstoesse = [];
  for (const name of dateien) {
    const quelltext = fs.readFileSync(path.join(__dirname, name), "utf8");
    if (!/require\(["']\.\/harness["']\)/.test(quelltext)) verstoesse.push(name + ": bindet ./harness nicht ein");
    if (name === "harness.spec.js") continue; // nennt die verbotenen Muster selbst
    for (const [muster, grund] of verboten) if (muster.test(quelltext)) verstoesse.push(name + ": " + grund);
  }
  expect(verstoesse).toEqual([]);
});
