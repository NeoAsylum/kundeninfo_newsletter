/* Frontend-Verhaltenstests (ADR-0029): echter Browser, aber weder Webserver noch API noch
   Port — harness.js liefert frontend/public per Route-Interception aus. */

"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  fullyParallel: true,
  // Ein vergessenes test.only darf weder in der CI noch in `npm test` (make check) grün sein —
  // sonst liefe dort ein einziger Test. Beim Aufruf einer Datei per npx bleibt es erlaubt.
  forbidOnly: Boolean(process.env.CI) || process.env.npm_lifecycle_event === "test",
  retries: 0, // Wackler sollen auffallen, nicht wegwiederholt werden
  timeout: 30000, // je Test; großzügig, weil ein ausgelasteter Rechner alles streckt
  reporter: [["list"]],
  use: {
    // Entwicklerrechner: der vorinstallierte Browser (kein Download) — Edge unter Windows,
    // sonst Chrome. CI setzt FRONTEND_BROWSER=chromium-headless-shell: das zur gepinnten
    // Playwright-Version gehörende Chromium (`make install-frontend-browser`).
    channel: process.env.FRONTEND_BROWSER || (process.platform === "win32" ? "msedge" : "chrome"),
    // Der Browser selbst bekommt kein Netz (kein Proxy, jede Namensauflösung scheitert sofort):
    // Edge/Chrome funken sonst nebenher an ihren Hersteller, und Edge braucht dann ~6 s zum Beenden.
    // --lang: Edge übernimmt `locale` (unten) nur, wenn es selbst nicht-deutsch gestartet wird.
    launchOptions: { args: ["--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND", "--lang=en-US"] },
    // Erfundener Host (.test ist reserviert): ein vergessener Stub erreicht nie einen Server.
    baseURL: "https://portal.test",
    // Der Testbrowser ist bewusst NICHT deutsch: Deutsche Zahlen- und Datumsformate müssen von
    // der Seite kommen (toLocaleString("de-DE")), nicht aus der Browsersprache — sonst könnte
    // ein vergessenes "de-DE" keinem Test auffallen.
    locale: "en-US",
    timezoneId: "Europe/Berlin", // App.formatDateTime rechnet in die Zeitzone des Browsers um
    trace: "retain-on-failure", // test-results/<test>/trace.zip → npx playwright show-trace <zip>
  },
});
