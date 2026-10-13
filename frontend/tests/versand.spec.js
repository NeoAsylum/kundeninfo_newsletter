/* versand.html + versand.js: Störungsmeldung verfassen, Vorschau, Versand, Historie. */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const { me, admin, topic, dispatch, fehler, NICHT_ANGEMELDET, KEIN_ADMIN, GATEWAY, ANMELDESEITE, XSS } = require("./daten");

const ME = "GET /api/v1/me";
const TOPICS = "GET /api/v1/topics";
const COUNT = "GET /api/v1/admin/topics/sap/recipient-count";
const COUNT_KAP = "GET /api/v1/admin/topics/kap/recipient-count";
const PREVIEW = "POST /api/v1/admin/dispatches/preview";
const SEND = "POST /api/v1/admin/dispatches";
const HISTORY = "GET /api/v1/admin/dispatches";
const LOGIN = "GET /auth/login";
const LOGOUT = "POST /auth/logout";
const ABGEMELDET = "GET /auth/abgemeldet";

const ENTWURF = { topic_id: "sap", severity: "stoerung", title: "Login gestört", body: "Bitte nicht neu anmelden." };
const FRAGE = 'Störungsmeldung an "SAP Produktion" (ca. 1.234 Empfänger) jetzt versenden?';
const FRAGE_KAP = 'Störungsmeldung an "KAP" (ca. 7 Empfänger) jetzt versenden?';
const FRAGE_OHNE_ZAHL = 'Störungsmeldung an "SAP Produktion" jetzt versenden? (Empfängerzahl unbekannt)';
const ANGELEGT = "Versand angelegt — läuft im Hintergrund";
const UNGEWISS =
  "Keine Bestätigung vom Server — unklar, ob der Versand angelegt wurde. Unverändert erneut senden verschickt nichts doppelt; die Historie unten zeigt den Stand.";
// Steht über der Historie, solange nach einem Versand mit offenem Ausgang nachgefasst wird.
const UNBESTAETIGT =
  "Der letzte Versand blieb ohne Bestätigung — unklar, ob er angelegt wurde. Solange dieser Hinweis steht, ist es gefahrlos, die Meldung " +
  "unverändert erneut zu senden: Sie geht nicht doppelt raus (eine geänderte gilt als neue Meldung). " +
  "Diese Liste zeigt den Stand und aktualisiert sich vorerst von selbst.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEINE_EMPFAENGER = "'SAP Produktion' hat aktuell keine Empfänger";
const ABGELEHNT = fehler(422, "NO_RECIPIENTS", KEINE_EMPFAENGER);
const KAP = topic({ id: "kap", name: "KAP" });
const KAP_ZAHL = { json: { topic_id: "kap", count: 7 } };
const LAEUFT = dispatch({ id: 8, status: "sending", sent_count: 200, recipient_count: 1234, finished_at: null });
const WARTET = dispatch({ id: 9, status: "pending", sent_count: 0, recipient_count: 1234, finished_at: null });
const ZUGESTELLT = { ...LAEUFT, status: "completed", sent_count: 1234 };
const ROT = "rgb(192, 57, 43)"; // --danger
const GRAU = "rgb(102, 112, 133)"; // --text-muted
// Die Vorschau spiegelt die Eingabe, damit der Test sieht, WELCHE Anfrage angezeigt wird.
const ECHO = (call) => ({ json: { subject: "egal", html: "<p>" + call.json.severity + ": " + call.json.title + "</p>" } });

test.beforeEach(async ({ api }) => {
  api.stub({
    [ME]: { json: admin() },
    [TOPICS]: { json: [topic()] },
    [COUNT]: { json: { topic_id: "sap", count: 1234 } },
    [HISTORY]: { json: [] },
    [PREVIEW]: ECHO,
    [SEND]: { status: 201, json: WARTET },
  });
});

/** Seite öffnen und abwarten, was init() als Letztes zeichnet. */
async function oeffne(page, historie = "Noch keine Versände.") {
  await page.goto("/versand.html");
  await expect(page.locator("#history-body")).toHaveText(historie);
}

/* Bedienelemente, wie der Nutzer sie findet: über Beschriftung und Rolle. */
const verteiler = (page) => page.getByLabel("Ziel-Verteiler wählen");
const titel = (page) => page.getByLabel("Titel");
const text = (page) => page.getByLabel("Nachrichteninhalt");
const senden = (page) => page.getByRole("button", { name: "Störungsmeldung versenden" });
const rahmen = (page) => page.frameLocator("#preview-frame").locator("body");
const zeilen = (page) => page.locator("#history-body").getByRole("row");
/** Der Hinweis auf einen Versand ohne Bestätigung. Sein Text steht fest im HTML — geprüft wird, ob er zu sehen ist. */
const hinweis = (page) => page.getByText(UNBESTAETIGT, { exact: true });
/** Was die Versand-Aufrufe trugen: die Meldung — genau ihre vier Felder — und, getrennt davon, den Schlüssel. */
const meldungen = (api) => api.calls(SEND).map(({ json: { idempotency_key, ...meldung } }) => meldung);
const schluessel = (api) => api.calls(SEND).map((call) => call.json.idempotency_key);

/** Maske ausfüllen wie ein Admin; danach steht die Empfängerzahl in der Rückfrage. */
async function fuelleAus(page) {
  await verteiler(page).selectOption("sap");
  await expect(page.locator("#recipient-count")).toHaveText("1.234");
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
}

/** Die Empfängerzahl, wie der Nutzer sie liest: im SICHTBAREN Hinweis unter der Auswahl. */
async function erwarteEmpfaenger(page, zahl) {
  const hinweis = page.locator("#recipient-hint");
  await expect(hinweis).toBeVisible();
  await expect(hinweis).toHaveText("👥 Erreicht ca. " + zahl + " aktive Empfänger");
}

/** Senden und die Rückfrage bestätigen. Gestellt wird dabei genau EINE Frage — mit diesem Wortlaut. */
async function sendeBestaetigt(page, api, frage = FRAGE) {
  const bisher = api.dialogs.length;
  api.confirmNext(true);
  await senden(page).click();
  expect(api.dialogs.slice(bisher)).toEqual([frage]);
}

/** Nach einem abgebrochenen oder gescheiterten Versand: Die Meldung steht noch da — samt Zähler und
 *  Betreffzeile — und kann (erneut) gesendet werden. */
async function erwarteMeldungSteht(page) {
  await expect(titel(page)).toHaveValue(ENTWURF.title);
  await expect(text(page)).toHaveValue(ENTWURF.body);
  await expect(page.locator("#title-count")).toHaveText("13");
  await expect(page.locator("#subject-preview")).toHaveText("[STÖRUNG] SAP Produktion: Login gestört");
  await expect(senden(page)).toBeEnabled();
}

// ---------- Maske: Senden-Knopf, Betreffzeile, Zähler ----------

test("Der Senden-Knopf wird erst frei, wenn Titel, Text und Verteiler da sind — auch wenn der Verteiler zuletzt kommt", async ({ page }) => {
  await oeffne(page);
  await expect(senden(page)).toBeDisabled();
  await titel(page).fill(ENTWURF.title);
  await expect(senden(page)).toBeDisabled(); // Text und Verteiler fehlen
  await text(page).fill(ENTWURF.body);
  await expect(senden(page)).toBeDisabled(); // der Verteiler fehlt
  await verteiler(page).selectOption("sap");
  await expect(senden(page)).toBeEnabled();
});

test("Nur Leerraum in Titel oder Text gibt den Senden-Knopf nicht frei", async ({ page }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await text(page).fill(ENTWURF.body);
  await titel(page).fill("   ");
  await expect(senden(page)).toBeDisabled(); // Titel nur aus Leerzeichen
  await titel(page).fill(ENTWURF.title);
  await expect(senden(page)).toBeEnabled();
  await text(page).fill(" \n\t ");
  await expect(senden(page)).toBeDisabled(); // Text nur aus Leerraum
});

test("Die Betreffzeile zeigt Platzhalter, bis Verteiler und Titel da sind — Leerzeichen allein sind kein Titel", async ({ page }) => {
  await oeffne(page);
  const betreff = page.locator("#subject-preview");
  await expect(betreff).toHaveText("[STÖRUNG] <Verteiler>: <Titel>");
  await titel(page).fill(ENTWURF.title);
  await expect(betreff).toHaveText("[STÖRUNG] <Verteiler>: Login gestört");
  await verteiler(page).selectOption("sap");
  await expect(betreff).toHaveText("[STÖRUNG] SAP Produktion: Login gestört");
  await titel(page).fill("   ");
  await expect(betreff).toHaveText("[STÖRUNG] SAP Produktion: <Titel>");
});

test("Die Betreffzeile folgt dem Schweregrad", async ({ page }) => {
  await oeffne(page);
  await fuelleAus(page);
  const betreff = page.locator("#subject-preview");
  await expect(betreff).toHaveText("[STÖRUNG] SAP Produktion: Login gestört");
  await page.getByRole("radio", { name: "Einschränkung" }).check();
  await expect(betreff).toHaveText("[EINSCHRÄNKUNG] SAP Produktion: Login gestört");
  await page.getByRole("radio", { name: "Entwarnung" }).check();
  await expect(betreff).toHaveText("[ENTWARNUNG] SAP Produktion: Login gestört");
});

test("Die Betreffzeile nennt den gewählten Verteiler — auch nach einem Wechsel", async ({ page, api }) => {
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  const betreff = page.locator("#subject-preview");
  await titel(page).fill(ENTWURF.title);
  await verteiler(page).selectOption("kap"); // nicht der erste der Liste
  await expect(betreff).toHaveText("[STÖRUNG] KAP: Login gestört");
  await verteiler(page).selectOption("sap");
  await expect(betreff).toHaveText("[STÖRUNG] SAP Produktion: Login gestört");
});

test("Ein Pflicht-Verteiler ist in der Auswahl als solcher gekennzeichnet", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ is_mandatory: true }), KAP] });
  await oeffne(page);
  await expect(verteiler(page).locator("option")).toHaveText(
    ["Verteiler auswählen …", "SAP Produktion (Pflicht — alle Mitarbeiter)", "KAP"]);
});

test("Der Platzhalter „Verteiler auswählen …“ lässt sich nicht wieder wählen", async ({ page }) => {
  await oeffne(page);
  await expect(verteiler(page).getByRole("option", { name: "Verteiler auswählen …" })).toBeDisabled();
  await expect(verteiler(page).getByRole("option", { name: "SAP Produktion" })).toBeEnabled();
});

test("Betreffzeile und Rückfrage nennen einen Pflicht-Verteiler nur beim Namen — ohne den Zusatz aus der Auswahl", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ is_mandatory: true })] });
  await oeffne(page);
  await fuelleAus(page);
  await expect(page.locator("#subject-preview")).toHaveText("[STÖRUNG] SAP Produktion: Login gestört");
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual([FRAGE]);
});

test("Der Titelzähler zählt jedes Zeichen des Feldes mit — auch Leerzeichen am Rand", async ({ page }) => {
  await oeffne(page);
  const zaehler = page.locator("#title-count");
  await expect(zaehler).toHaveText("0");
  await titel(page).fill("  ab ");
  await expect(zaehler).toHaveText("5");
  await titel(page).pressSequentially("c");
  await expect(zaehler).toHaveText("6");
});

test("Der Titelzähler ist ab 150 Zeichen rot — bei 149 noch nicht", async ({ page }) => {
  await oeffne(page);
  const zaehler = page.locator("#title-count");
  await titel(page).fill("x".repeat(149));
  await expect(zaehler).toHaveText("149");
  await expect(zaehler).toHaveCSS("color", GRAU);
  await titel(page).pressSequentially("y");
  await expect(zaehler).toHaveText("150");
  await expect(zaehler).toHaveCSS("color", ROT);
  await titel(page).press("Backspace");
  await expect(zaehler).toHaveText("149");
  await expect(zaehler).toHaveCSS("color", GRAU);
});

test("Mehr als 150 Zeichen nimmt das Titelfeld nicht an", async ({ page }) => {
  await oeffne(page);
  await titel(page).fill("x".repeat(150));
  await titel(page).pressSequentially("z"); // das 151. Zeichen
  await expect(titel(page)).toHaveValue("x".repeat(150));
  await expect(page.locator("#title-count")).toHaveText("150");
});

// ---------- Vorschau ----------

test("Vorschau: nach 350 ms Ruhe geht genau EINE Anfrage raus, egal wie viele Tastendrücke — und es bleibt bei der einen", async ({ page, api }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await titel(page).pressSequentially(ENTWURF.title); // 13 input-Ereignisse
  await text(page).pressSequentially("Bitte nicht neu anmelden");

  // 349 ms nach dem letzten Tastendruck ist die Frist nicht um; ein weiterer startet sie neu.
  await page.clock.runFor(349);
  await text(page).pressSequentially(".");
  await page.clock.runFor(349);
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(0);
  await page.clock.runFor(1);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
  await page.clock.runFor(5000); // ohne weitere Eingabe folgt keine zweite
  await api.sync();
  expect(api.calls(PREVIEW).map((call) => call.json)).toEqual([ENTWURF]);
});

test("Die Vorschau-Anfrage trägt den Titel ohne Rand-Leerzeichen und den Text unverändert", async ({ page, api }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await titel(page).fill("  Login gestört ");
  await text(page).fill(" Zeile 1\n\nZeile 2 \n");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
  await api.sync();
  expect(api.calls(PREVIEW).map((call) => call.json)).toEqual([{ ...ENTWURF, body: " Zeile 1\n\nZeile 2 \n" }]);
});

test("Ohne Verteiler geht keine Vorschau-Anfrage raus", async ({ page, api }) => {
  await oeffne(page);
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  await page.clock.runFor(350);
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(0);

  // Gegenprobe: Sobald der Verteiler gewählt ist, kommt die Vorschau.
  await verteiler(page).selectOption("sap");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
});

test("Mit einem Titel nur aus Leerzeichen geht keine Vorschau-Anfrage raus", async ({ page, api }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await text(page).fill(ENTWURF.body);
  await titel(page).fill("   ");
  await page.clock.runFor(350);
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(0);

  // Gegenprobe: Mit einem Titel kommt die Vorschau.
  await titel(page).fill(ENTWURF.title);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
});

test("Mit einem Text nur aus Leerraum geht keine Vorschau-Anfrage raus", async ({ page, api }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(" \n ");
  await page.clock.runFor(350);
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(0);

  // Gegenprobe: Mit Text kommt die Vorschau.
  await text(page).fill(ENTWURF.body);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
});

test("Auch ein anderer Schweregrad oder Verteiler erneuert die Vorschau", async ({ page, api }) => {
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await page.getByRole("radio", { name: "Entwarnung" }).check();
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("entwarnung: Login gestört");
  await verteiler(page).selectOption("kap");
  await page.clock.runFor(350);
  await api.sync();
  expect(api.calls(PREVIEW).map((call) => [call.json.topic_id, call.json.severity])).toEqual(
    [["sap", "stoerung"], ["sap", "entwarnung"], ["kap", "entwarnung"]]);
});

test("Die Vorschau zeigt das HTML des Servers samt seiner Inline-Formatierung", async ({ page, api }) => {
  api.stub(PREVIEW, {
    json: { subject: "egal", html: '<h1 style="color: rgb(192, 57, 43)">Störung</h1><p>Bitte nicht neu anmelden.</p>' },
  });
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page).getByRole("heading", { name: "Störung" })).toHaveCSS("color", ROT);
  await expect(rahmen(page).locator("p")).toHaveText("Bitte nicht neu anmelden.");
});

test("Ein Skript im Vorschau-HTML läuft nicht — auch keines vom eigenen Server, das die CSP durchließe", async ({ page, api }) => {
  // Ein Inline-Skript hielte auch die CSP auf. Diese beiden lässt sie durch (script-src 'self'):
  // Nur der Rahmen selbst — sandbox ohne allow-scripts — verhindert, dass sie laufen.
  api.stub(PREVIEW, {
    json: { subject: "egal", html: '<script src="/app.js"></script><script src="/versand.js"></script><p>Vorschau</p>' },
  });
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page).locator("p")).toHaveText("Vorschau"); // steht HINTER den Skripten
  await api.sync();
  expect(api.calls(ME)).toHaveLength(1); // im Rahmen gestartet, hätte versand.js /me ein zweites Mal gefragt …
  await expect(rahmen(page)).toHaveText("Vorschau"); // … und seine Fehlermeldung in die Vorschau geschrieben
  await expect(page.locator("#preview-frame")).toHaveAttribute("sandbox", "allow-same-origin");
});

test("Sitzung läuft beim Tippen ab (401): die Vorschau navigiert nicht weg, die Eingabe bleibt", async ({ page, api }) => {
  api.stub(PREVIEW, NICHT_ANGEMELDET);
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(1);

  // Die Seite ist noch da und arbeitet weiter: Die nächste Vorschau kommt an. Ein Sprung zum
  // Login wäre eine Anfrage ohne Stub (GET /auth/login) — daran scheiterte der Test am Ende.
  api.stub(PREVIEW, { json: { subject: "egal", html: "<p>wieder da</p>" } });
  await text(page).pressSequentially("!");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("wieder da");
  await expect(page).toHaveURL("/versand.html");
  await expect(titel(page)).toHaveValue(ENTWURF.title);
  await expect(page.locator("#toast")).toHaveCount(0); // Vorschau-Fehler werden nicht gemeldet
});

test("Vorschau scheitert (500): kein Toast, die Eingabe bleibt, die nächste Vorschau kommt wieder an", async ({ page, api }) => {
  api.stub(PREVIEW, fehler(500, "INTERNAL", "Vorlage defekt"));
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(1);

  api.stub(PREVIEW, ECHO);
  await text(page).pressSequentially("!");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
  await expect(text(page)).toHaveValue(ENTWURF.body + "!");
  await expect(page.locator("#toast")).toHaveCount(0);
});

test("Eine überholte Vorschau-Antwort ersetzt nicht die neuere", async ({ page, api }) => {
  const alt = hold();
  api.stub(PREVIEW, alt.answer);
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350); // erste Vorschau unterwegs, ihre Antwort hängt
  await api.sync();
  api.stub(PREVIEW, ECHO); // die zweite wird sofort beantwortet
  await titel(page).fill("neuer Titel");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: neuer Titel");

  alt.release({ json: { subject: "egal", html: "<p>überholt</p>" } });
  await api.sync();
  // srcdoc setzt die Seite sofort, das Neuzeichnen des Rahmens folgt erst — deshalb beides.
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "<p>stoerung: neuer Titel</p>");
  await expect(rahmen(page)).toHaveText("stoerung: neuer Titel");
});

test("Scheitert die Vorschau (401), verschwindet die bisherige — neben dem neuen Betreff steht keine alte Vorschau", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");

  api.stub(PREVIEW, NICHT_ANGEMELDET); // z. B. Sitzung beim Tippen abgelaufen: ab jetzt scheitert jede Vorschau
  await titel(page).fill("Ganz anderer Titel");
  await page.clock.runFor(350);
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "");
  await expect(rahmen(page)).toBeEmpty();
  await expect(page.locator("#subject-preview")).toHaveText("[STÖRUNG] SAP Produktion: Ganz anderer Titel");
  await expect(page.locator("#toast")).toHaveCount(0); // gemeldet wird der Fehler weiterhin nicht
  await expect(senden(page)).toBeEnabled(); // und senden lässt sich die Meldung trotzdem
});

test("Auch nach einem Serverfehler der Vorschau (500) steht die bisherige nicht mehr da — die nächste gelungene erscheint wieder", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");

  api.stub(PREVIEW, fehler(500, "INTERNAL", "Vorlage defekt"));
  await page.getByRole("radio", { name: "Entwarnung" }).check();
  await page.clock.runFor(350);
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "");
  await expect(rahmen(page)).toBeEmpty();

  api.stub(PREVIEW, ECHO);
  await text(page).pressSequentially("!");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("entwarnung: Login gestört");
});

test("Scheitert eine überholte Vorschau-Anfrage erst nachträglich, bleibt die neuere Vorschau stehen", async ({ page, api }) => {
  const alt = hold();
  api.stub(PREVIEW, alt.answer);
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350); // erste Vorschau unterwegs, ihre Antwort hängt
  await api.sync();
  api.stub(PREVIEW, ECHO); // die zweite wird sofort beantwortet
  await titel(page).fill("neuer Titel");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: neuer Titel");

  alt.release(fehler(500, "INTERNAL", "zu spät gescheitert"));
  await api.sync();
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "<p>stoerung: neuer Titel</p>");
  await expect(rahmen(page)).toHaveText("stoerung: neuer Titel");
});

// ---------- Empfängerzahl ----------

test("Der Empfänger-Hinweis erscheint erst mit der Verteilerwahl", async ({ page }) => {
  await oeffne(page);
  await expect(page.locator("#recipient-hint")).toBeHidden();
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "1.234");
});

test("Solange die Empfängerzahl lädt, ist der Hinweis schon zu sehen — mit einem Strich statt einer Zahl", async ({ page, api }) => {
  const zahl = hold();
  api.stub(COUNT, zahl.answer);
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "–");
  zahl.release({ json: { topic_id: "sap", count: 1234 } });
  await erwarteEmpfaenger(page, "1.234");
});

test("Beim Verteilerwechsel verschwindet die alte Empfängerzahl sofort — bis die neue da ist, steht ein Strich", async ({ page, api }) => {
  const zahl = hold();
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: zahl.answer });
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "1.234");
  await verteiler(page).selectOption("kap");
  await erwarteEmpfaenger(page, "–"); // nicht mehr die 1.234 von SAP
  zahl.release({ json: { topic_id: "kap", count: 1234567 } });
  await erwarteEmpfaenger(page, "1.234.567");
});

test("Die Empfängerzahl steht in deutscher Schreibweise da — auch wenn der Browser Zahlen von sich aus englisch schreibt", async ({ page }) => {
  // Playwrights locale erreicht die Zahlformatierung des installierten Browsers nicht (beobachtet mit en-US:
  // navigator.language folgt, Intl bleibt de-DE). Deshalb schreibt toLocaleString() hier jede Zahl, für die
  // die Seite KEINE Sprache nennt, englisch — wie in einem englisch eingestellten Browser. Verließe sich die
  // Seite auf die Vorgabe, stünde 1,234 da.
  await page.addInitScript(() => {
    const original = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (sprache, optionen) {
      return original.call(this, sprache === undefined ? "en-US" : sprache, optionen);
    };
  });
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "1.234");
});

test("Empfängerzahl nicht ermittelbar (500): es steht „?“ da — die Rückfrage sagt, dass die Zahl unbekannt ist", async ({ page, api }) => {
  api.stub(COUNT, fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "?");
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual([FRAGE_OHNE_ZAHL]);
  await expect(page.locator("#toast")).toHaveCount(0);
});

test("Wer sendet, während die Empfängerzahl noch lädt, wird ohne Zahl gefragt — sobald sie da ist, nennt die Rückfrage sie", async ({ page, api }) => {
  const zahl = hold();
  api.stub(COUNT, zahl.answer);
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual([FRAGE_OHNE_ZAHL]);

  zahl.release({ json: { topic_id: "sap", count: 1234 } });
  await erwarteEmpfaenger(page, "1.234");
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual([FRAGE_OHNE_ZAHL, FRAGE]);
});

test("Nach einem Verteilerwechsel nennt die Rückfrage nicht die Zahl des vorherigen Verteilers — solange die neue lädt, gilt sie als unbekannt", async ({ page, api }) => {
  const zahl = hold();
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: zahl.answer });
  await oeffne(page);
  await fuelleAus(page); // für SAP steht die Zahl fest: 1.234
  await verteiler(page).selectOption("kap");
  await erwarteEmpfaenger(page, "–");
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual(['Störungsmeldung an "KAP" jetzt versenden? (Empfängerzahl unbekannt)']);

  zahl.release(KAP_ZAHL);
  await erwarteEmpfaenger(page, "7");
});

test("Scheitert die jüngste Abfrage der Empfängerzahl, nennt die Rückfrage auch keine Zahl, die eine frühere Abfrage noch geliefert hatte", async ({ page, api }) => {
  const erste = hold();
  const zweite = hold();
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT]: erste.answer, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  await verteiler(page).selectOption("sap"); // die erste Abfrage für SAP hängt
  await verteiler(page).selectOption("kap");
  await erwarteEmpfaenger(page, "7");
  await api.sync();
  api.stub(COUNT, zweite.answer);
  await verteiler(page).selectOption("sap"); // zurück zu SAP: auch die zweite hängt
  erste.release({ json: { topic_id: "sap", count: 1234 } });
  await api.sync(); // die frühere Antwort ist angekommen, bevor die jüngste scheitert
  zweite.release(fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await erwarteEmpfaenger(page, "?");

  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual([FRAGE_OHNE_ZAHL]);
});

test("Sitzung läuft bei der Empfängerzahl ab (401): „?“ statt Sprung zum Login, die Eingabe bleibt", async ({ page, api }) => {
  api.stub(COUNT, NICHT_ANGEMELDET);
  await oeffne(page);
  await titel(page).fill(ENTWURF.title);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "?");
  await expect(page).toHaveURL("/versand.html");
  await expect(titel(page)).toHaveValue(ENTWURF.title);
});

test("Eine verspätete Empfängerzahl des vorherigen Verteilers überschreibt die aktuelle nicht — auch nicht in der Rückfrage", async ({ page, api }) => {
  const alt = hold();
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT]: alt.answer, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await verteiler(page).selectOption("kap");
  await erwarteEmpfaenger(page, "7");

  alt.release({ json: { topic_id: "sap", count: 5000 } });
  await api.sync();
  await erwarteEmpfaenger(page, "7");
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual([FRAGE_KAP]);
});

test("Ein verspäteter Fehler des vorherigen Verteilers macht aus der aktuellen Zahl kein „?“", async ({ page, api }) => {
  const alt = hold();
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT]: alt.answer, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await verteiler(page).selectOption("kap");
  await erwarteEmpfaenger(page, "7");

  alt.release(fehler(500, "INTERNAL", "zu spät"));
  await api.sync();
  await erwarteEmpfaenger(page, "7");
});

// Hin und zurück gewechselt: Zwei Abfragen gelten demselben Verteiler — nur die jüngste zählt.
const VERSPAETET = [
  ["Ein verspäteter Fehler einer früheren Abfrage desselben Verteilers macht aus der bekannten Empfängerzahl kein „?“ — auch die Rückfrage nennt sie weiter",
    fehler(500, "INTERNAL", "zu spät gescheitert")],
  ["Eine verspätete Zahl aus einer früheren Abfrage desselben Verteilers ersetzt die der jüngsten nicht — auch nicht in der Rückfrage",
    { json: { topic_id: "sap", count: 5000 } }],
];
for (const [satz, antwort] of VERSPAETET) {
  test(satz, async ({ page, api }) => {
    const erste = hold();
    api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT]: erste.answer, [COUNT_KAP]: KAP_ZAHL });
    await oeffne(page);
    await verteiler(page).selectOption("sap"); // die erste Abfrage für SAP hängt
    await verteiler(page).selectOption("kap");
    await erwarteEmpfaenger(page, "7");
    await api.sync();
    api.stub(COUNT, { json: { topic_id: "sap", count: 1234 } });
    await verteiler(page).selectOption("sap"); // zurück zu SAP: die zweite Abfrage liefert die Zahl
    await erwarteEmpfaenger(page, "1.234");

    erste.release(antwort);
    await api.sync();
    await erwarteEmpfaenger(page, "1.234");
    await titel(page).fill(ENTWURF.title);
    await text(page).fill(ENTWURF.body);
    api.confirmNext(false);
    await senden(page).click();
    expect(api.dialogs).toEqual([FRAGE]);
  });
}

test("Die Verteiler-Kennung wird im Pfad der Empfängerzahl URL-kodiert", async ({ page, api }) => {
  api.stub({
    [TOPICS]: { json: [topic({ id: "a/b c", name: "Sonderfall" })] },
    "GET /api/v1/admin/topics/a%2Fb%20c/recipient-count": { json: { topic_id: "a/b c", count: 3 } },
  });
  await oeffne(page);
  await verteiler(page).selectOption("a/b c");
  await erwarteEmpfaenger(page, "3");
});

test("Die Empfängerzahl wird je Verteilerwahl einmal abgefragt — Tippen und ein anderer Schweregrad fragen nicht erneut", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  await page.getByRole("radio", { name: "Entwarnung" }).check();
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("entwarnung: Login gestört");
  await api.sync();
  expect(api.calls(COUNT)).toHaveLength(1);
  await erwarteEmpfaenger(page, "1.234");
});

// ---------- Senden ----------

test("Senden fragt nach — Abbrechen sendet nichts und lässt die Meldung stehen", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  api.confirmNext(false);
  await senden(page).click();

  await api.sync();
  expect(api.dialogs).toEqual([FRAGE]);
  expect(api.calls(SEND)).toHaveLength(0);
  await erwarteMeldungSteht(page);
  await expect(page.locator("#toast")).toHaveCount(0);
});

test("Bestätigtes Senden legt genau EINEN Versand an: gewählter Verteiler, Schweregrad, Titel ohne Rand-Leerzeichen, Text unverändert", async ({ page, api }) => {
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  await verteiler(page).selectOption("kap"); // nicht der erste der Liste
  await erwarteEmpfaenger(page, "7");
  await page.getByRole("radio", { name: "Einschränkung" }).check();
  await titel(page).fill("  Login gestört ");
  await text(page).fill(" Zeile 1\n\nZeile 2 \n");
  await sendeBestaetigt(page, api, FRAGE_KAP);

  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(meldungen(api)).toEqual(
    [{ topic_id: "kap", severity: "einschraenkung", title: "Login gestört", body: " Zeile 1\n\nZeile 2 \n" }]);
  expect(api.calls(SEND)[0].headers).toMatchObject({ "x-requested-with": "fetch", "content-type": "application/json" });
});

test("Wer sich umentscheidet, sendet an den zuletzt gewählten Verteiler — Rückfrage und Anfrage nennen denselben", async ({ page, api }) => {
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: KAP_ZAHL });
  await oeffne(page);
  await fuelleAus(page); // erst SAP …
  await verteiler(page).selectOption("kap"); // … dann umentschieden
  await erwarteEmpfaenger(page, "7");
  await sendeBestaetigt(page, api, FRAGE_KAP);

  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(meldungen(api)).toEqual([{ ...ENTWURF, topic_id: "kap" }]);
});

test("Solange der Versand-Aufruf läuft, ist der Senden-Knopf gesperrt — auch Enter löst keinen zweiten aus", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();
  await titel(page).press("Enter"); // gesperrter Knopf: der Browser sendet das Formular nicht ab

  post.release({ status: 201, json: WARTET });
  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(api.dialogs).toEqual([FRAGE]); // Enter hat nichts gefragt
  expect(api.calls(SEND)).toHaveLength(1);
});

test("Solange der Versand-Aufruf läuft, gibt auch ein anderer Schweregrad oder Verteiler den Senden-Knopf nicht wieder frei — weder Klick noch Enter senden ein zweites Mal", async ({ page, api }) => {
  const post = hold();
  api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: KAP_ZAHL, [SEND]: post.answer });
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();

  // Schweregrad und Verteiler bleiben bedienbar — und jede Änderung lässt die Maske den Knopf neu berechnen.
  await page.getByRole("radio", { name: "Entwarnung" }).check();
  await verteiler(page).selectOption("kap");
  await erwarteEmpfaenger(page, "7");
  await expect(senden(page)).toBeDisabled();
  await senden(page).click({ force: true }); // ungeduldiger zweiter Klick
  await titel(page).press("Enter");
  await api.sync();
  expect(api.dialogs).toEqual([FRAGE]); // nichts gefragt …
  expect(api.calls(SEND)).toHaveLength(1); // … und nichts gesendet

  post.release({ status: 201, json: WARTET });
  await expectToast(page, ANGELEGT);
});

test("Solange der Versand-Aufruf läuft, nimmt die Maske auch ein Absenden am gesperrten Knopf vorbei nicht an", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();

  // Klick und Enter hält schon der gesperrte Knopf auf. requestSubmit() fragt ihn nicht — so sendet ein
  // Skript oder Hilfsprogramm ein Formular ab.
  await page.evaluate(() => document.getElementById("send-form").requestSubmit());
  await api.sync();
  expect(api.dialogs).toEqual([FRAGE]);
  expect(api.calls(SEND)).toHaveLength(1);

  post.release({ status: 201, json: WARTET });
  await expectToast(page, ANGELEGT);
});

test("Solange der Versand-Aufruf läuft, steht noch keine Erfolgsmeldung da — Meldung, Zähler und Vorschau bleiben, bis die API geantwortet hat", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();
  await api.sync(); // der Aufruf ist unterwegs, seine Antwort hängt
  expect(api.calls(SEND)).toHaveLength(1);
  await expect(page.locator("#toast")).toHaveCount(0);
  await expect(titel(page)).toHaveValue(ENTWURF.title);
  await expect(text(page)).toHaveValue(ENTWURF.body);
  await expect(page.locator("#title-count")).toHaveText("13");
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "<p>stoerung: Login gestört</p>");
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");

  post.release({ status: 201, json: WARTET });
  await expectToast(page, ANGELEGT);
  await expect(titel(page)).toHaveValue("");
});

test("Solange der Versand-Aufruf läuft, nehmen Titel und Text keine Eingabe an — was der Admin noch anhängen will, geht nicht still verloren", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();

  await titel(page).pressSequentially("!");
  await text(page).pressSequentially(" Nachtrag: Neustart hilft.");
  await expect(titel(page)).toHaveValue(ENTWURF.title);
  await expect(text(page)).toHaveValue(ENTWURF.body);
  await expect(page.locator("#title-count")).toHaveText("13");
  for (const feld of [titel(page), text(page)]) {
    await expect(feld).not.toBeEditable();
    await expect(feld).toBeEnabled(); // nur lesbar, nicht gesperrt: Ein gesperrtes Feld verlöre den Tastaturfokus
  }
  await expect(text(page)).toBeFocused();

  post.release({ status: 201, json: WARTET });
  await expectToast(page, ANGELEGT);
  await expect(text(page)).toHaveValue("");
  await api.sync();
  expect(meldungen(api)).toEqual([ENTWURF]); // gesendet und geleert ist genau, was dastand
});

// Wie auch immer der Aufruf endet: Danach lässt sich die Meldung wieder bearbeiten.
const AUSGAENGE = [
  ["der Versand ist angelegt", { status: 201, json: WARTET }, ANGELEGT],
  ["die API lehnt ab", ABGELEHNT, KEINE_EMPFAENGER],
  ["die Bestätigung bleibt aus", GATEWAY, UNGEWISS],
];
for (const [ausgang, antwort, toast] of AUSGAENGE) {
  test(`Ist der Versand-Aufruf beendet (${ausgang}), nehmen Titel und Text wieder Eingaben an`, async ({ page, api }) => {
    const post = hold();
    api.stub(SEND, post.answer);
    await oeffne(page);
    await fuelleAus(page);
    await sendeBestaetigt(page, api);
    await expect(titel(page)).not.toBeEditable(); // während des Aufrufs gesperrt
    await expect(text(page)).not.toBeEditable();

    post.release(antwort);
    await expectToast(page, toast, { error: toast !== ANGELEGT });
    await expect(titel(page)).toBeEditable();
    await expect(text(page)).toBeEditable();
    await titel(page).fill("Zweiter Anlauf");
    await text(page).fill("Neuer Text");
    await expect(page.locator("#title-count")).toHaveText("14");
    await expect(senden(page)).toBeEnabled();
  });
}

test("Nach dem Versand sind Titel, Text und Zähler geleert; die Betreffzeile wartet auf den nächsten Titel", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  await expect(page.locator("#title-count")).toHaveText("13");
  await sendeBestaetigt(page, api);

  await expectToast(page, ANGELEGT);
  await expect(titel(page)).toHaveValue("");
  await expect(text(page)).toHaveValue("");
  await expect(page.locator("#title-count")).toHaveText("0");
  await expect(page.locator("#subject-preview")).toHaveText("[STÖRUNG] SAP Produktion: <Titel>");
  await expect(senden(page)).toBeDisabled();
});

test("Nach dem Versand eines 150-Zeichen-Titels steht der Zähler wieder auf 0 — und ist nicht mehr rot", async ({ page, api }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "1.234");
  await titel(page).fill("x".repeat(150));
  await text(page).fill(ENTWURF.body);
  await expect(page.locator("#title-count")).toHaveCSS("color", ROT);
  await sendeBestaetigt(page, api);

  await expectToast(page, ANGELEGT);
  await expect(page.locator("#title-count")).toHaveText("0");
  await expect(page.locator("#title-count")).toHaveCSS("color", GRAU);
});

test("Nach dem Versand bleibt die Maske nicht gesperrt: die nächste Meldung lässt sich senden", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);

  await titel(page).fill("Zweite Meldung");
  await text(page).fill("Neuer Text");
  await expect(senden(page)).toBeEnabled();
  await sendeBestaetigt(page, api);
  await expect(titel(page)).toHaveValue(""); // auch der zweite Versand ist angelegt
  await api.sync();
  expect(api.calls(SEND).map((call) => call.json.title)).toEqual([ENTWURF.title, "Zweite Meldung"]);
});

test("Nach dem Versand ist die Vorschau geleert", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
  await sendeBestaetigt(page, api);

  await expectToast(page, ANGELEGT);
  await expect(rahmen(page)).toBeEmpty();
});

test("Nach dem Versand füllt eine noch laufende Vorschau-Antwort den geleerten Rahmen nicht wieder", async ({ page, api }) => {
  const alt = hold();
  api.stub(PREVIEW, alt.answer);
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350); // Vorschau unterwegs, ihre Antwort hängt
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);

  alt.release({ json: { subject: "egal", html: "<p>gehört zur gesendeten Meldung</p>" } });
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(1);
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "");
  await expect(rahmen(page)).toBeEmpty();
});

test("Auch eine Vorschau, die erst während des Versand-Aufrufs startet, füllt den geleerten Rahmen nicht wieder", async ({ page, api }) => {
  const post = hold();
  const vorschau = hold();
  api.stub({ [SEND]: post.answer, [PREVIEW]: vorschau.answer });
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api); // gleich nach dem Tippen: die Entprell-Frist läuft noch
  await expect(senden(page)).toBeDisabled();
  await page.clock.runFor(350); // die Vorschau startet, während der Versand-Aufruf hängt
  await api.sync();
  expect(api.calls(PREVIEW)).toHaveLength(1);

  post.release({ status: 201, json: WARTET });
  await expectToast(page, ANGELEGT);
  vorschau.release({ json: { subject: "egal", html: "<p>gehört zur gesendeten Meldung</p>" } });
  await api.sync();
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "");
  await expect(rahmen(page)).toBeEmpty();
});

test("Eine Vorschau-Antwort zur gesendeten Meldung ersetzt auch nicht die Vorschau der nächsten Meldung", async ({ page, api }) => {
  const alt = hold();
  api.stub(PREVIEW, alt.answer);
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350); // Vorschau der ersten Meldung unterwegs, ihre Antwort hängt
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);

  api.stub(PREVIEW, ECHO); // die Vorschau der nächsten Meldung wird sofort beantwortet
  await titel(page).fill("Zweite Meldung");
  await text(page).fill("Neuer Text");
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Zweite Meldung");

  alt.release({ json: { subject: "egal", html: "<p>gehört zur gesendeten Meldung</p>" } });
  await api.sync();
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "<p>stoerung: Zweite Meldung</p>");
  await expect(rahmen(page)).toHaveText("stoerung: Zweite Meldung");
});

test("Erst nach dem angelegten Versand wird die Historie neu geladen — der neue Versand steht drin und wird weiterverfolgt", async ({ page, api }) => {
  // Wie die API: Der neue Versand steht erst in der Liste, wenn er angelegt ist.
  let liste = [];
  api.stub({
    [SEND]: () => { liste = [WARTET]; return { status: 201, json: WARTET }; },
    [HISTORY]: () => ({ json: liste }),
  });
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);

  await expect(zeilen(page)).toHaveText([/Wartet\s*0\/1234/]);
  liste = [{ ...WARTET, status: "sending", sent_count: 50 }];
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*50\/1234/]);
});

test("Nach dem Versand läuft genau EINE Statusabfrage weiter — der alte 4-s-Takt ist abgelöst", async ({ page, api }) => {
  let abruf = 0;
  api.stub(HISTORY, () => ({ json: [{ ...LAEUFT, sent_count: ++abruf }] }));
  await oeffne(page, /Versand läuft …\s*1\/1234/); // der Takt des offenen Versands läuft
  await fuelleAus(page);
  await page.clock.runFor(1000);
  await sendeBestaetigt(page, api);
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*2\/1234/]); // neu geladen: ab jetzt zählen die 4 s

  await page.clock.runFor(3999); // der alte Takt wäre nach 3000 ms fällig gewesen
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  await page.clock.runFor(1);
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*3\/1234/]);
  await page.clock.runFor(4000); // und danach genau ein Abruf je Takt
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(4);
});

test("Scheitert das Neuladen der Historie nach dem Versand, läuft nur der 10-s-Takt — nicht zusätzlich der alte", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/); // der 4-s-Takt des offenen Versands läuft
  await fuelleAus(page);
  api.stub(HISTORY, fehler(500, "INTERNAL", "kurz nicht erreichbar"));
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync(); // der gescheiterte Abruf ist verarbeitet

  await page.clock.runFor(9999); // der alte Takt wäre nach 4000 ms fällig gewesen
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  await page.clock.runFor(1);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(3);
});

test("Nach einem Abfragefehler löst das Neuladen nach dem Versand auch den 10-s-Takt ab — er fragt nicht zusätzlich nach", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  await fuelleAus(page);
  api.stub(HISTORY, fehler(500, "INTERNAL", "kurz nicht erreichbar"));
  await page.clock.runFor(4000); // die Statusabfrage scheitert: der 10-s-Takt läuft
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  api.stub(HISTORY, { json: [WARTET, LAEUFT] });
  await sendeBestaetigt(page, api);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Versand läuft …/]); // neu geladen: der 4-s-Takt läuft

  api.stub(HISTORY, { json: [{ ...WARTET, status: "completed", sent_count: 1234 }, ZUGESTELLT] });
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText([/Zugestellt/, /Zugestellt/]);
  await page.clock.runFor(60000); // alles zugestellt: auch der abgelöste 10-s-Takt meldet sich nicht mehr
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(4); // Start, gescheiterte Abfrage, nach dem Versand, eine Statusabfrage
});

test("Eine überholte Antwort der Statusabfrage verdrängt die neuere nicht — der neue Versand bleibt stehen und wird weiterverfolgt", async ({ page, api }) => {
  const alt = hold();
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  await fuelleAus(page);
  api.stub(HISTORY, alt.answer);
  await page.clock.runFor(4000); // Statusabfrage unterwegs, ihre Antwort hängt
  await api.sync();
  api.stub(HISTORY, { json: [WARTET, ZUGESTELLT] }); // der Abruf nach dem Versand wird sofort beantwortet
  await sendeBestaetigt(page, api);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);

  alt.release({ json: [ZUGESTELLT] }); // Stand von VOR dem Versand
  await api.sync();
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);
  await page.clock.runFor(4000); // der wartende Versand wird weiter abgefragt …
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(4);
  await page.clock.runFor(4000); // … mit genau einer Abfrage je Takt
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(5);
});

test("Ein überholtes 403 der Statusabfrage ersetzt die neuere Historie nicht durch „Keine Berechtigung.“ — der neue Versand wird weiterverfolgt", async ({ page, api }) => {
  const alt = hold();
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  await fuelleAus(page);
  api.stub(HISTORY, alt.answer);
  await page.clock.runFor(4000); // Statusabfrage unterwegs, ihre Antwort hängt
  await api.sync();
  api.stub(HISTORY, { json: [WARTET, LAEUFT] }); // der Abruf nach dem Versand wird sofort beantwortet
  await sendeBestaetigt(page, api);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Versand läuft …/]);

  alt.release(KEIN_ADMIN);
  await api.sync();
  await expect(zeilen(page)).toHaveText([/Wartet/, /Versand läuft …/]);
  api.stub(HISTORY, { json: [{ ...WARTET, status: "sending", sent_count: 50 }, LAEUFT] });
  await page.clock.runFor(4000); // der 4-s-Takt der neueren Antwort gilt weiter
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*50\/1234/, /Versand läuft …\s*200\/1234/]);
});

test("Scheitert eine überholte Statusabfrage erst nachträglich, stößt sie keine weitere Abfrage an, wenn die neuere schon alles als beendet gezeigt hat", async ({ page, api }) => {
  const alt = hold();
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  await fuelleAus(page);
  api.stub(HISTORY, alt.answer);
  await page.clock.runFor(4000); // Statusabfrage unterwegs, ihre Antwort hängt
  await api.sync();
  api.stub(HISTORY, { json: [{ ...WARTET, status: "completed", sent_count: 1234 }, ZUGESTELLT] });
  await sendeBestaetigt(page, api);
  await expect(zeilen(page)).toHaveText([/Zugestellt/, /Zugestellt/]); // nichts mehr offen: kein Takt

  alt.release(fehler(500, "INTERNAL", "zu spät gescheitert"));
  await api.sync();
  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(3); // Start, überholte Abfrage, Neuladen
});

test("Solange die Historie nach dem Versand neu lädt, fragt der bisherige Takt nicht dazwischen — danach läuft genau eine Abfrage je 4 s", async ({ page, api }) => {
  const neu = hold();
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/); // der 4-s-Takt des offenen Versands läuft
  await fuelleAus(page);
  api.stub(HISTORY, neu.answer);
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await page.clock.runFor(4000); // der bisherige Takt wäre jetzt fällig
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2); // Start und Neuladen

  neu.release({ json: [WARTET, LAEUFT] });
  await expect(zeilen(page)).toHaveText([/Wartet/, /Versand läuft …/]);
  await page.clock.runFor(3999);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  await page.clock.runFor(1);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(3);
});

test("Senden scheitert (422): der Fehlertext der API steht im Toast, die Meldung bleibt, der Knopf ist wieder frei", async ({ page, api }) => {
  api.stub(SEND, fehler(422, "NO_RECIPIENTS", "'SAP Produktion' hat aktuell keine Empfänger"));
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);

  await expectToast(page, "'SAP Produktion' hat aktuell keine Empfänger", { error: true });
  await erwarteMeldungSteht(page);
});

test("Senden scheitert (409): die Meldung bleibt und lässt sich danach unverändert erneut senden", async ({ page, api }) => {
  api.stub(SEND, fehler(409, "CONFLICT", "Der Verteiler wird gerade geändert."));
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, "Der Verteiler wird gerade geändert.", { error: true });
  await erwarteMeldungSteht(page);

  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(meldungen(api)).toEqual([ENTWURF, ENTWURF]);
});

// Ohne Antwort der API ist offen, ob der Versand angelegt wurde. Die Seite sagt das — und dass die unveränderte
// Meldung gefahrlos erneut gesendet werden kann (siehe „Senden: der Schlüssel der Meldung“).
const OHNE_ANTWORT = [
  ["Netz weg", { abort: true }],
  ["500 ohne lesbaren Fehlertext", { status: 500, html: "Internal Server Error" }],
  ["502 vom Proxy", GATEWAY],
  ["200 ohne JSON", ANMELDESEITE],
  // Bestätigt ist ein Versand nur mit einem Versand-Objekt in der Antwort:
  ["204 statt eines Versands", { status: 204 }],
  ["200 mit JSON null", { json: null }],
  ["200 mit fremdem JSON", { json: {} }],
];
for (const [fall, antwort] of OHNE_ANTWORT) {
  test(`Bleibt die Antwort auf den Versand aus (${fall}), nennt der Toast den offenen Ausgang — die neu geladene Historie zeigt den angelegten Versand`, async ({ page, api }) => {
    api.stub(SEND, antwort);
    await oeffne(page);
    await fuelleAus(page);
    api.stub(HISTORY, { json: [WARTET] }); // der Server HAT den Versand angelegt
    await sendeBestaetigt(page, api);

    await expectToast(page, UNGEWISS, { error: true });
    await expect(hinweis(page)).toBeVisible();
    await expect(zeilen(page)).toHaveText([/Wartet/]);
    await erwarteMeldungSteht(page);
  });
}

test("Scheitert nach einem Versand mit offenem Ausgang auch das Neuladen der Historie, steht dort nicht mehr der alte Stand — der Abruf wird nach 10 s nachgeholt", async ({ page, api }) => {
  api.stub(HISTORY, { json: [ZUGESTELLT] });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  api.stub({ [SEND]: { abort: true }, [HISTORY]: { abort: true } });
  await sendeBestaetigt(page, api);

  await expectToast(page, UNGEWISS, { error: true });
  // Die alte Tabelle läse sich wie „nicht angelegt“.
  await expect(hinweis(page)).toBeVisible();
  await expect(zeilen(page)).toHaveText(["Lade Versandhistorie …"]);
  await api.sync();
  api.stub(HISTORY, { json: [WARTET, ZUGESTELLT] });
  await page.clock.runFor(10000);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);
  await expect(hinweis(page)).toBeVisible();
});

test("Legt der Server den Versand erst nach dem Neuladen an (504), zeigt ihn die Historie beim Nachfassen 4 s später", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: { status: 504, html: "<h1>504 Gateway Time-out</h1>" } });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await expect(zeilen(page)).toHaveText([/Zugestellt/]); // neu geladen — der Versand ist noch nicht da
  await expect(hinweis(page)).toBeVisible(); // … und das steht dabei
  await api.sync();

  api.stub(HISTORY, { json: [WARTET, ZUGESTELLT] }); // erst jetzt hat der Server ihn angelegt
  await page.clock.runFor(3999);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  await page.clock.runFor(1);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);
});

test("Das Nachfassen endet nach zwei Minuten: Der Hinweis verschwindet, und die Historie fragt nicht weiter", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: { abort: true } });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await expect(zeilen(page)).toHaveText([/Zugestellt/]);
  await api.sync();

  for (let sekunden = 4; sekunden < 120; sekunden += 4) { // 29 Abfragen im 4-s-Takt
    await page.clock.runFor(4000);
    await api.sync();
  }
  expect(api.calls(HISTORY)).toHaveLength(2 + 29);
  await expect(hinweis(page)).toBeVisible(); // nach 116 s steht der Hinweis noch
  await page.clock.runFor(4000); // 120 s: mit der letzten Abfrage verschwindet er
  await expect(hinweis(page)).toBeHidden();
  await expect(zeilen(page)).toHaveText([/Zugestellt/]);
  await api.sync();
  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2 + 30);
});

test("Bleibt auch die unveränderte Wiederholung ohne Bestätigung, beginnen die zwei Minuten mit ihr neu: Der Hinweis steht noch 116 s danach und verschwindet nach 120 s", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();
  for (let sekunden = 4; sekunden <= 100; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }

  await sendeBestaetigt(page, api); // 100 s nach dem ersten Versand, wieder 502
  await expectToast(page, UNGEWISS, { error: true }); // der Toast des ersten ist längst ausgeblendet
  await api.sync();
  for (let sekunden = 104; sekunden <= 216; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeVisible(); // 216 s nach dem ersten Versand, 116 s nach dem zweiten
  await page.clock.runFor(4000);
  await expect(hinweis(page)).toBeHidden();
});

test("Ist eine Abfrage der Historie über die Frist hinaus unterwegs und dann lesbar, steht der Hinweis noch bei ihrer Liste — erst die nächste Abfrage beendet das Nachfassen", async ({ page, api }) => {
  const neuladen = hold();
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  api.stub(HISTORY, neuladen.answer); // die Historie nach dem Versand lässt auf sich warten
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await expect(zeilen(page)).toHaveText(["Lade Versandhistorie …"]);
  await page.clock.runFor(121000); // die zwei Minuten sind um — begonnen hat die Abfrage vorher
  await api.sync();
  api.stub(HISTORY, { json: [ZUGESTELLT] });
  neuladen.release({ json: [ZUGESTELLT] }); // der Versand ist (noch) nicht dabei
  await expect(zeilen(page)).toHaveText([/Zugestellt/]);
  await expect(hinweis(page)).toBeVisible(); // ohne den Hinweis läse sich das wie „nicht angelegt“
  await api.sync();

  await page.clock.runFor(3999);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2); // Start und Neuladen
  await page.clock.runFor(1); // die nächste Abfrage beginnt nach der Frist
  await expect(hinweis(page)).toBeHidden();
  await api.sync();
  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(3);
});

test("Gelingt der nächste Versand, verschwindet der Hinweis auf den unbestätigten sofort — auch wenn die Historie danach nicht lädt", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();

  api.stub({ [SEND]: { status: 201, json: WARTET }, [HISTORY]: { abort: true } });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await expect(hinweis(page)).toBeHidden(); // neben „Versand angelegt“ wäre der Satz falsch

  api.stub(HISTORY, { json: [WARTET, ZUGESTELLT] });
  await page.clock.runFor(10000);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);
  await expect(hinweis(page)).toBeHidden();
});

test("Ist die Historie zwei Minuten lang nicht lesbar, steht der Hinweis noch bei der ersten lesbaren Antwort — und die Historie fragt weiter nach", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  api.stub(HISTORY, GATEWAY); // auch die Historie ist nicht erreichbar
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await expect(zeilen(page)).toHaveText(["Lade Versandhistorie …"]);
  await api.sync();
  for (let sekunden = 10; sekunden <= 120; sekunden += 10) { // zwölf vergebliche Abrufe im 10-s-Takt
    await page.clock.runFor(10000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeVisible();

  api.stub(HISTORY, { json: [ZUGESTELLT] }); // wieder lesbar — der Versand ist (noch) nicht dabei
  await page.clock.runFor(10000);
  await expect(zeilen(page)).toHaveText([/Zugestellt/]);
  await expect(hinweis(page)).toBeVisible(); // ohne den Hinweis läse sich das wie „nicht angelegt“
  await api.sync();
  api.stub(HISTORY, { json: [WARTET, ZUGESTELLT] }); // der Server legt ihn erst jetzt an
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);
});

test("Nach einem Aussetzer der Historie endet das Nachfassen zwei Minuten nach dem gescheiterten Abruf — nicht schon zwei Minuten nach dem Versand und nicht erst nach 15 Minuten", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();

  api.stub(HISTORY, GATEWAY); // ein Aussetzer 4 s nach dem Versand …
  await page.clock.runFor(4000);
  await api.sync();
  api.stub(HISTORY, { json: [ZUGESTELLT] }); // … 10 s später ist die Historie wieder lesbar
  await page.clock.runFor(10000);
  await api.sync();
  for (let sekunden = 18; sekunden <= 122; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeVisible(); // 122 s nach dem Versand, 118 s nach dem Aussetzer
  await page.clock.runFor(4000); // 126 s: Diese Abfrage beginnt mehr als zwei Minuten nach dem Aussetzer
  await expect(hinweis(page)).toBeHidden();
});

test("Ist die Frist zum Nachfassen um, bringt ein späterer Aussetzer der Historie den Hinweis nicht zurück", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [LAEUFT] }, [SEND]: GATEWAY }); // ein älterer Versand läuft noch: Die Historie fragt ohnehin weiter
  await oeffne(page, /Versand läuft/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();
  for (let sekunden = 4; sekunden <= 120; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeHidden(); // die zwei Minuten sind um

  api.stub(HISTORY, GATEWAY); // ein Aussetzer …
  await page.clock.runFor(4000);
  await api.sync();
  api.stub(HISTORY, { json: [LAEUFT] }); // … und 10 s später ist die Historie wieder da
  await page.clock.runFor(10000);
  await api.sync();
  await expect(zeilen(page)).toHaveText([/Versand läuft/]);
  await expect(hinweis(page)).toBeHidden();
});

test("Wird das Adminrecht während des Nachfassens entzogen, verschwindet der Hinweis mit der Liste — und die Abfragen enden", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();

  api.stub(HISTORY, KEIN_ADMIN);
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText(["Keine Berechtigung."]);
  await expect(hinweis(page)).toBeHidden();
  await api.sync();
  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(3);
});

test("Der Hinweis auf den unbestätigten Versand passt auch im schmalen Fenster ganz ins Bild", async ({ page, api }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();

  // Die Tabelle darunter ist breiter als das Fenster; der Hinweis darf nicht mit ihr über den Rand laufen.
  const lage = await hinweis(page).boundingBox();
  expect(lage.x).toBeGreaterThanOrEqual(0);
  expect(lage.x + lage.width).toBeLessThanOrEqual(390);
});

test("Lehnt die API den Versand ab (422), ist der Ausgang klar: Die Historie bleibt stehen und wird nicht neu geladen", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: fehler(422, "NO_RECIPIENTS", "'SAP Produktion' hat aktuell keine Empfänger") });
  await oeffne(page, /Zugestellt/);
  await expect(hinweis(page)).toBeHidden(); // ohne offenen Versand steht kein Hinweis da
  await fuelleAus(page);
  await sendeBestaetigt(page, api);

  await expectToast(page, "'SAP Produktion' hat aktuell keine Empfänger", { error: true });
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(1);
  await expect(zeilen(page)).toHaveText([/Zugestellt/]);
  await expect(hinweis(page)).toBeHidden();
});

// ---------- Senden: der Schlüssel der Meldung ----------
// Jeder Versand-Aufruf trägt einen Schlüssel (idempotency_key). Einen Schlüssel, den die API kennt, beantwortet sie
// mit dem schon angelegten Versand, statt einen zweiten anzulegen. Deshalb geht die unveränderte Meldung nach einem
// Versand mit offenem Ausgang mit DEMSELBEN Schlüssel erneut raus — und jede andere mit einem neuen.

test("Der Schlüssel ist eine UUID der Version 4 aus crypto.getRandomValues — crypto.randomUUID braucht die Seite nicht", async ({ page, api }) => {
  // crypto.randomUUID gibt es nur im sicheren Kontext; über http ohne TLS fehlt es. Der Zufall ist gestellt, damit
  // die festen Bits der Version 4 zu sehen sind: erst lauter Einsen, dann lauter Nullen.
  await page.addInitScript(() => {
    delete Crypto.prototype.randomUUID;
    window.zufallsbyte = 0xff;
    Crypto.prototype.getRandomValues = (feld) => feld.fill(window.zufallsbyte);
  });
  api.stub(SEND, ABGELEHNT); // die Meldung bleibt stehen; der zweite Versuch bekommt einen neuen Schlüssel
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, KEINE_EMPFAENGER, { error: true });

  await page.evaluate(() => { window.zufallsbyte = 0x00; });
  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(schluessel(api)).toEqual(["ffffffff-ffff-4fff-bfff-ffffffffffff", "00000000-0000-4000-8000-000000000000"]);
});

for (const [fall, antwort] of OHNE_ANTWORT) {
  test(`Nach einem Versand ohne Bestätigung (${fall}) trägt die unverändert erneut gesendete Meldung denselben Schlüssel`, async ({ page, api }) => {
    api.stub(SEND, antwort);
    await oeffne(page);
    await fuelleAus(page);
    await sendeBestaetigt(page, api);
    await expectToast(page, UNGEWISS, { error: true });

    api.stub(SEND, { status: 201, json: WARTET });
    await sendeBestaetigt(page, api);
    await expectToast(page, ANGELEGT);
    await api.sync();
    const [erster, zweiter] = schluessel(api);
    expect(erster).toMatch(UUID_V4);
    expect(zweiter).toBe(erster);
    expect(meldungen(api)).toEqual([ENTWURF, ENTWURF]);
  });
}

const AENDERUNGEN = [
  ["den Titel", (page) => titel(page).fill("Login weiter gestört"), FRAGE],
  ["den Text", (page) => text(page).fill(ENTWURF.body + " Neustart hilft."), FRAGE],
  ["den Schweregrad", (page) => page.getByRole("radio", { name: "Entwarnung" }).check(), FRAGE],
  ["den Verteiler", async (page) => { await verteiler(page).selectOption("kap"); await erwarteEmpfaenger(page, "7"); }, FRAGE_KAP],
];
for (const [was, aendere, frage] of AENDERUNGEN) {
  test(`Wer nach einem Versand ohne Bestätigung ${was} ändert, sendet eine neue Meldung: Sie trägt einen neuen Schlüssel`, async ({ page, api }) => {
    api.stub({ [TOPICS]: { json: [topic(), KAP] }, [COUNT_KAP]: KAP_ZAHL, [SEND]: GATEWAY });
    await oeffne(page);
    await fuelleAus(page);
    await sendeBestaetigt(page, api);
    await expectToast(page, UNGEWISS, { error: true });

    await aendere(page);
    api.stub(SEND, { status: 201, json: WARTET });
    await sendeBestaetigt(page, api, frage);
    await expectToast(page, ANGELEGT);
    await api.sync();
    const [erster, zweiter] = schluessel(api);
    expect(zweiter).toMatch(UUID_V4);
    expect(zweiter).not.toBe(erster);
  });
}

test("Verglichen wird, was gesendet wird: geändert und wieder zurückgestellt, trägt die Meldung denselben Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });

  await page.getByRole("radio", { name: "Entwarnung" }).check();
  await text(page).fill("Ganz anderer Text");
  await page.getByRole("radio", { name: "Störung", exact: true }).check();
  await text(page).fill(ENTWURF.body);
  await titel(page).fill("  " + ENTWURF.title + " "); // Leerzeichen am Rand des Titels werden nicht gesendet
  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(erster).toMatch(UUID_V4);
  expect(zweiter).toBe(erster);
  expect(meldungen(api)).toEqual([ENTWURF, ENTWURF]);
});

test("Wer während des Versand-Aufrufs den Schweregrad wechselt, hat danach eine andere Meldung in der Maske als die gesendete: Sie trägt einen neuen Schlüssel", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();
  await page.getByRole("radio", { name: "Entwarnung" }).check();
  post.release(GATEWAY);
  await expectToast(page, UNGEWISS, { error: true });

  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(zweiter).not.toBe(erster);
  expect(meldungen(api)).toEqual([ENTWURF, { ...ENTWURF, severity: "entwarnung" }]);
});

test("Antwortet die API auf die Wiederholung mit dem schon angelegten Versand (200), ist er bestätigt: „Versand angelegt“, die Maske ist geleert, der Hinweis verschwunden", async ({ page, api }) => {
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();

  // Der erste Aufruf HAT den Versand angelegt: Die API legt keinen zweiten an, sie antwortet mit dem vorhandenen.
  api.stub({ [SEND]: { status: 200, json: WARTET }, [HISTORY]: { json: [WARTET, ZUGESTELLT] } });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await expect(titel(page)).toHaveValue("");
  await expect(text(page)).toHaveValue("");
  await expect(hinweis(page)).toBeHidden();
  await expect(zeilen(page)).toHaveText([/Wartet/, /Zugestellt/]);
  await api.sync();
  const [erster, zweiter] = schluessel(api); // die 200 galt einer Wiederholung: beide Aufrufe trugen denselben Schlüssel
  expect(erster).toMatch(UUID_V4);
  expect(zweiter).toBe(erster);
});

test("Ist die Wiederholung bestätigt, ist die Meldung erledigt: Derselbe Text, später noch einmal gesendet, trägt einen neuen Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  api.stub(SEND, { status: 200, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);

  await fuelleAus(page); // dieselbe Störung, derselbe Text — aber eine neue Meldung
  await sendeBestaetigt(page, api);
  await expect(titel(page)).toHaveValue(""); // auch sie ist angelegt
  await api.sync();
  const [erster, zweiter, dritter] = schluessel(api);
  expect(zweiter).toBe(erster);
  expect(dritter).toMatch(UUID_V4);
  expect(dritter).not.toBe(erster);
  expect(meldungen(api)).toEqual([ENTWURF, ENTWURF, ENTWURF]);
});

test("Wird nach einem Versand ohne Bestätigung eine GEÄNDERTE Meldung bestätigt, endet der offene Ausgang: Der Hinweis verschwindet, und die erste Meldung trägt danach einen neuen Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await expect(hinweis(page)).toBeVisible();

  await titel(page).fill("Anderer Titel"); // eine andere Meldung — sie wird angelegt
  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await expect(hinweis(page)).toBeHidden(); // der letzte Versand IST bestätigt

  await fuelleAus(page); // wieder die erste Meldung
  await sendeBestaetigt(page, api);
  await expect(titel(page)).toHaveValue(""); // auch sie ist angelegt
  await api.sync();
  const [erster, , dritter] = schluessel(api);
  expect(dritter).toMatch(UUID_V4);
  expect(dritter).not.toBe(erster);
  expect(meldungen(api)).toEqual([ENTWURF, { ...ENTWURF, title: "Anderer Titel" }, ENTWURF]);
});

// Eine Ablehnung gilt dem Aufruf, den sie beantwortet. Über den offenen Ausgang des früheren sagt sie nichts Verlässliches —
// manche entsteht, bevor die API den Versand ansieht (ein 429 oder 403 des Proxys). Der Schlüssel bleibt, solange der Hinweis steht.
const SCHLUESSEL_VERGEBEN =
  "Unter dem Schlüssel dieser Anfrage besteht bereits Versand 9 mit anderem Inhalt — die jetzt übermittelte Meldung wurde nicht angelegt";
const ABLEHNUNGEN = [
  ["422", ABGELEHNT, ABGELEHNT.json.detail],
  ["429", { status: 429, html: "<h1>429 Too Many Requests</h1>" }, "Fehler (HTTP 429)"],
  ["409: Die API meldet den Schlüssel als anders belegt", fehler(409, "IDEMPOTENCY_KEY_REUSED", SCHLUESSEL_VERGEBEN), SCHLUESSEL_VERGEBEN],
  ["403 ohne Fehlertext der API, etwa von einem Proxy", { status: 403, html: "<h1>403 Forbidden</h1>" }, "Fehler (HTTP 403)"],
];
for (const [fall, ablehnung, toast] of ABLEHNUNGEN) {
  test(`Wird die Wiederholung abgelehnt (${fall}), bleibt der Ausgang offen: Hinweis und Schlüssel bleiben`, async ({ page, api }) => {
    api.stub(SEND, GATEWAY);
    await oeffne(page);
    await fuelleAus(page);
    await sendeBestaetigt(page, api);
    await expectToast(page, UNGEWISS, { error: true });

    api.stub(SEND, ablehnung);
    await sendeBestaetigt(page, api);
    await expectToast(page, toast, { error: true });
    await erwarteMeldungSteht(page);
    await expect(hinweis(page)).toBeVisible();

    api.stub(SEND, { status: 200, json: WARTET });
    await sendeBestaetigt(page, api);
    await expectToast(page, ANGELEGT);
    await api.sync();
    const [erster, zweiter, dritter] = schluessel(api);
    expect(erster).toMatch(UUID_V4);
    expect([zweiter, dritter]).toEqual([erster, erster]);
  });
}

test("Wird nach einem offenen Ausgang eine GEÄNDERTE Meldung abgelehnt, behält die ursprüngliche ihren Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });

  await titel(page).fill("Anderer Titel"); // eine andere Meldung — sie wird abgelehnt
  api.stub(SEND, ABGELEHNT);
  await sendeBestaetigt(page, api);
  await expectToast(page, ABGELEHNT.json.detail, { error: true });
  await expect(hinweis(page)).toBeVisible();

  await titel(page).fill(ENTWURF.title); // zurück zur Meldung mit dem offenen Ausgang
  api.stub(SEND, { status: 200, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter, dritter] = schluessel(api);
  expect(zweiter).toMatch(UUID_V4);
  expect(zweiter).not.toBe(erster);
  expect(dritter).toBe(erster);
});

test("Bleibt nach dem ersten auch der Versand einer GEÄNDERTEN Meldung ohne Bestätigung, gilt der offene Ausgang ihr: Sie behält ihren Schlüssel, die erste bekommt einen neuen", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await page.clock.runFor(5000); // Toast ausblenden: Der nächste Versand muss einen NEUEN zeigen

  await titel(page).fill("Anderer Titel"); // eine andere Meldung — auch sie bleibt ohne Bestätigung
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await page.clock.runFor(5000);
  await sendeBestaetigt(page, api); // unverändert erneut
  await expectToast(page, UNGEWISS, { error: true });
  await expect(hinweis(page)).toBeVisible();

  await titel(page).fill(ENTWURF.title); // zurück zur ersten Meldung: Der Hinweis gilt dem letzten Versand, nicht ihr
  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erste, andere, wiederholung, ersteErneut] = schluessel(api);
  expect(andere).not.toBe(erste);
  expect(wiederholung).toBe(andere);
  expect(ersteErneut).toMatch(UUID_V4);
  expect([erste, andere]).not.toContain(ersteErneut);
});

test("Läuft vor der Wiederholung die Sitzung ab (401), bleibt der Ausgang offen: Nach dem Anmelden trägt die unveränderte Meldung weiter denselben Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });

  // Das 401 kommt aus der Anmeldeprüfung — ob der erste Aufruf den Versand angelegt hat, ist weiter offen.
  api.stub(SEND, NICHT_ANGEMELDET);
  await sendeBestaetigt(page, api);
  await expectToast(
    page,
    "Sitzung abgelaufen — die Meldung bleibt stehen. Bitte in einem zweiten Tab neu anmelden und erneut senden.",
    { error: true });

  api.stub(SEND, { status: 200, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter, dritter] = schluessel(api);
  expect(erster).toMatch(UUID_V4);
  expect([zweiter, dritter]).toEqual([erster, erster]);
});

test("Wird das Adminrecht entzogen (403 auf Versand und Historie), endet der offene Ausgang: Der Hinweis verschwindet, und die Meldung trägt danach einen neuen Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();

  // Versand und Historie hängen am selben Recht: Fehlt es, meldet es auch die nächste Abfrage der Historie.
  api.stub({ [SEND]: KEIN_ADMIN, [HISTORY]: KEIN_ADMIN });
  await sendeBestaetigt(page, api);
  await expectToast(page, "Keine Berechtigung für diese Funktion", { error: true });
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText(["Keine Berechtigung."]);
  await expect(hinweis(page)).toBeHidden();

  api.stub(SEND, { status: 201, json: WARTET }); // das Recht ist zurück
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter, dritter] = schluessel(api);
  expect(zweiter).toBe(erster); // solange der Hinweis stand: derselbe
  expect(dritter).toMatch(UUID_V4);
  expect(dritter).not.toBe(erster);
});

test("Der Hinweis und der Schlüssel enden zusammen: Steht der Hinweis nach 121 s noch (die Historie antwortet erst bei 122 s), trägt die Meldung denselben Schlüssel", async ({ page, api }) => {
  const neuladen = hold(); // die Historie nach dem Versand antwortet 2 s später: Alle weiteren Abfragen fallen auf 6, 10, …, 118, 122 s
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  api.stub(HISTORY, neuladen.answer);
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await page.clock.runFor(2000);
  api.stub(HISTORY, { json: [] });
  neuladen.release({ json: [] });
  await expect(page.locator("#history-body")).toHaveText("Noch keine Versände.");
  await api.sync();
  for (let sekunden = 6; sekunden <= 118; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }
  await page.clock.runFor(3000); // 121 s nach dem Versand — die nächste Abfrage käme bei 122 s
  await expect(hinweis(page)).toBeVisible();

  api.stub(SEND, { status: 200, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(erster).toMatch(UUID_V4);
  expect(zweiter).toBe(erster);
});

test("War der Rechner über die Frist hinaus zugeklappt, endet der offene Ausgang mit der ersten Abfrage danach — auch wenn sie scheitert: Der Text von damals wäre eine neue Meldung", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();

  api.stub(HISTORY, NICHT_ANGEMELDET); // Stunden später ist die Sitzung abgelaufen
  await page.clock.fastForward("16:00:00"); // der fällige Abruf läuft beim Aufklappen genau einmal
  await expect(hinweis(page)).toBeHidden();
  await api.sync();

  api.stub({ [SEND]: { status: 201, json: WARTET }, [HISTORY]: { json: [WARTET] } }); // im zweiten Tab neu angemeldet
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(zweiter).toMatch(UUID_V4);
  expect(zweiter).not.toBe(erster); // sonst antwortete die API mit dem Versand von damals — und keine Mail ginge raus
});

test("Ist eine Abfrage der Historie über die Frist hinaus unterwegs und scheitert dann, beginnen die zwei Minuten neu: Der Hinweis bleibt, und die unveränderte Meldung trägt denselben Schlüssel", async ({ page, api }) => {
  const neuladen = hold();
  api.stub({ [HISTORY]: { json: [ZUGESTELLT] }, [SEND]: GATEWAY });
  await oeffne(page, /Zugestellt/);
  await fuelleAus(page);
  api.stub(HISTORY, neuladen.answer); // die Historie nach dem Versand hängt
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await page.clock.runFor(121000); // die zwei Minuten sind um — begonnen hat die Abfrage vorher
  await api.sync();
  api.stub(HISTORY, { json: [ZUGESTELLT] });
  neuladen.release({ status: 504, html: "<h1>504 Gateway Time-out</h1>" });
  await api.sync();
  await expect(hinweis(page)).toBeVisible();
  await expect(zeilen(page)).toHaveText(["Lade Versandhistorie …"]);

  await page.clock.runFor(10000); // der nachgeholte Abruf ist lesbar — nach der ersten Frist, aber in der neuen
  await expect(zeilen(page)).toHaveText([/Zugestellt/]);
  await expect(hinweis(page)).toBeVisible();

  api.stub(SEND, { status: 200, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(erster).toMatch(UUID_V4);
  expect(zweiter).toBe(erster);
});

test("Bleibt die Historie unlesbar, während der Rechner läuft (Sitzung abgelaufen), endet der offene Ausgang 15 Minuten nach dem Versand: Kurz davor trägt die unveränderte Meldung noch denselben Schlüssel, danach einen neuen", async ({ page, api }) => {
  test.setTimeout(60000); // rund 90 Abfragen im 10-s-Takt dauern ein Vielfaches der übrigen Tests
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  api.stub(HISTORY, NICHT_ANGEMELDET); // die Sitzung ist abgelaufen: Jede Abfrage der Historie scheitert, nach 10 s folgt die nächste
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await api.sync();
  for (let sekunden = 10; sekunden <= 890; sekunden += 10) { // die Uhr läuft im Takt der Abfragen, ohne Sprung
    await page.clock.runFor(10000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeVisible(); // 14 min 50 s nach dem Versand

  api.stub(SEND, NICHT_ANGEMELDET);
  await sendeBestaetigt(page, api);
  await expectToast(
    page,
    "Sitzung abgelaufen — die Meldung bleibt stehen. Bitte in einem zweiten Tab neu anmelden und erneut senden.",
    { error: true });
  await page.clock.runFor(10000); // 15 Minuten: Die Abfrage, die jetzt beginnt, beendet den offenen Ausgang
  await expect(hinweis(page)).toBeHidden();
  await api.sync();

  api.stub({ [SEND]: { status: 201, json: WARTET }, [HISTORY]: { json: [WARTET] } }); // im zweiten Tab neu angemeldet
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter, dritter] = schluessel(api);
  expect(erster).toMatch(UUID_V4);
  expect(zweiter).toBe(erster);
  expect(dritter).toMatch(UUID_V4);
  expect(dritter).not.toBe(erster);
});

test("Auch die 15 Minuten beginnen neu, wenn die unveränderte Wiederholung wieder ohne Bestätigung bleibt: 15 Minuten nach dem ersten Versand steht der Hinweis noch, 15 Minuten nach dem zweiten ist er weg", async ({ page, api }) => {
  test.setTimeout(60000); // auch hier rund 90 Abfragen im 10-s-Takt
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  api.stub(HISTORY, GATEWAY); // auch die Historie ist nicht erreichbar — und bleibt es
  await sendeBestaetigt(page, api);
  await expectToast(page, UNGEWISS, { error: true });
  await api.sync();
  await page.clock.runFor(10000);
  await api.sync();

  await sendeBestaetigt(page, api); // 10 s nach dem ersten Versand: unverändert, wieder 502
  await expectToast(page, UNGEWISS, { error: true }); // der Toast des ersten ist seit 5 s ausgeblendet
  await api.sync();
  for (let sekunden = 20; sekunden <= 900; sekunden += 10) {
    await page.clock.runFor(10000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeVisible(); // 15 Minuten nach dem ersten Versand
  await page.clock.runFor(10000); // 15 Minuten nach dem zweiten
  await expect(hinweis(page)).toBeHidden();
});

test("Ist das Nachfassen vorbei und der Hinweis verschwunden, gilt dieselbe Meldung als neue: Sie trägt einen neuen Schlüssel", async ({ page, api }) => {
  // Sonst antwortete die API noch Tage später mit dem alten Versand — „Versand angelegt“, und keine Mail ginge raus.
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(hinweis(page)).toBeVisible();
  await api.sync();
  for (let sekunden = 4; sekunden <= 120; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeHidden();

  api.stub(SEND, { status: 201, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(zweiter).toMatch(UUID_V4);
  expect(zweiter).not.toBe(erster);
});

test("Kurz vor dem Ende des Nachfassens (116 s) trägt die unveränderte Meldung noch denselben Schlüssel", async ({ page, api }) => {
  api.stub(SEND, GATEWAY);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await api.sync();
  for (let sekunden = 4; sekunden <= 116; sekunden += 4) {
    await page.clock.runFor(4000);
    await api.sync();
  }
  await expect(hinweis(page)).toBeVisible();

  api.stub(SEND, { status: 200, json: WARTET });
  await sendeBestaetigt(page, api);
  await expectToast(page, ANGELEGT);
  await api.sync();
  const [erster, zweiter] = schluessel(api);
  expect(erster).toMatch(UUID_V4);
  expect(zweiter).toBe(erster);
});

test("Scheitert der Versand eines 150-Zeichen-Titels, bleibt der Zähler bei 150 und rot", async ({ page, api }) => {
  api.stub(SEND, fehler(409, "CONFLICT", "Der Verteiler wird gerade geändert."));
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, "1.234");
  await titel(page).fill("x".repeat(150));
  await text(page).fill(ENTWURF.body);
  await sendeBestaetigt(page, api);

  await expectToast(page, "Der Verteiler wird gerade geändert.", { error: true });
  await expect(page.locator("#title-count")).toHaveText("150");
  await expect(page.locator("#title-count")).toHaveCSS("color", ROT);
});

test("Scheitert der Versand, bleibt auch die Vorschau der Meldung stehen", async ({ page, api }) => {
  api.stub(SEND, fehler(409, "CONFLICT", "Der Verteiler wird gerade geändert."));
  await oeffne(page);
  await fuelleAus(page);
  await page.clock.runFor(350);
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
  await sendeBestaetigt(page, api);

  await expectToast(page, "Der Verteiler wird gerade geändert.", { error: true });
  await expect(page.locator("#preview-frame")).toHaveAttribute("srcdoc", "<p>stoerung: Login gestört</p>");
  await expect(rahmen(page)).toHaveText("stoerung: Login gestört");
});

test("Sitzung läuft beim Senden ab (401): kein Sprung zum Login, die Meldung bleibt stehen", async ({ page, api }) => {
  api.stub(SEND, NICHT_ANGEMELDET);
  await oeffne(page);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);

  await expectToast(
    page,
    "Sitzung abgelaufen — die Meldung bleibt stehen. Bitte in einem zweiten Tab neu anmelden und erneut senden.",
    { error: true });
  await expect(page).toHaveURL("/versand.html");
  await erwarteMeldungSteht(page);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(1); // abgelehnt ist abgelehnt: kein Neuladen der Historie
});

test("Nach einem per Tastatur ausgelösten, gescheiterten Versand steht der Fokus wieder auf dem Senden-Knopf — die Leertaste fragt erneut", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await text(page).press("Tab");
  await expect(senden(page)).toBeFocused();
  api.confirmNext(true);
  await page.keyboard.press("Space");
  await expect(senden(page)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused(); // das Sperren hat den Fokus weggeworfen

  post.release(fehler(409, "CONFLICT", "Der Verteiler wird gerade geändert."));
  await expectToast(page, "Der Verteiler wird gerade geändert.", { error: true });
  await expect(senden(page)).toBeFocused();

  api.stub(SEND, { status: 201, json: WARTET });
  api.confirmNext(true);
  await page.keyboard.press("Space");
  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(api.dialogs).toEqual([FRAGE, FRAGE]);
  expect(api.calls(SEND)).toHaveLength(2);
});

test("Wer während des Versand-Aufrufs ins Titelfeld gegangen ist, behält dort den Fokus, wenn der Versand scheitert", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await text(page).press("Tab");
  api.confirmNext(true);
  await page.keyboard.press("Space");
  await expect(page.locator("body")).toBeFocused();
  await titel(page).focus();

  post.release(fehler(409, "CONFLICT", "Der Verteiler wird gerade geändert."));
  await expectToast(page, "Der Verteiler wird gerade geändert.", { error: true });
  await expect(titel(page)).toBeFocused();
});

test("Auch nach einem Versand mit offenem Ausgang (502) steht der Tastaturfokus wieder auf dem Senden-Knopf", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  await text(page).press("Tab");
  api.confirmNext(true);
  await page.keyboard.press("Space");
  await expect(senden(page)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();

  post.release(GATEWAY);
  await expectToast(page, UNGEWISS, { error: true });
  await expect(senden(page)).toBeFocused();
});

test("Per Enter im Titelfeld gesendet, danach neben die Felder geklickt: Scheitert der Versand, zieht der Senden-Knopf den Fokus nicht an sich", async ({ page, api }) => {
  const post = hold();
  api.stub(SEND, post.answer);
  await oeffne(page);
  await fuelleAus(page);
  api.confirmNext(true);
  await titel(page).press("Enter");
  await expect(senden(page)).toBeDisabled();
  await page.getByRole("heading", { name: "Neue Störungsmeldung verfassen" }).click(); // nichts Fokussierbares
  await expect(page.locator("body")).toBeFocused();

  post.release(fehler(422, "NO_RECIPIENTS", "'SAP Produktion' hat aktuell keine Empfänger"));
  await expectToast(page, "'SAP Produktion' hat aktuell keine Empfänger", { error: true });
  await expect(senden(page)).toBeEnabled();
  await expect(page.locator("body")).toBeFocused(); // zurück bekommt den Fokus nur, wer ihn hatte
});

// Schmales Fenster (einspaltig) und eine lange Historie: Der Senden-Knopf und das Seitenende passen nicht zugleich ins Bild.
const LANGE_HISTORIE = Array.from({ length: 20 }, (_, nr) => dispatch({ id: 100 - nr, subject: "[STÖRUNG] SAP Produktion: Meldung " + nr }));

test("Tastatur: wer während des Versand-Aufrufs ans Seitenende geblättert hat, sieht nach dem Fehlschlag wieder den Senden-Knopf", async ({ page, api }) => {
  await page.setViewportSize({ width: 683, height: 728 });
  const post = hold();
  api.stub({ [HISTORY]: { json: LANGE_HISTORIE }, [SEND]: post.answer });
  await oeffne(page, /Meldung 19/);
  await fuelleAus(page);
  await text(page).press("Tab");
  api.confirmNext(true);
  await page.keyboard.press("Space");
  await expect(senden(page)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(senden(page)).not.toBeInViewport();

  post.release(fehler(422, "NO_RECIPIENTS", "'SAP Produktion' hat aktuell keine Empfänger"));
  await expectToast(page, "'SAP Produktion' hat aktuell keine Empfänger", { error: true });
  await expect(senden(page)).toBeFocused();
  await expect(senden(page)).toBeInViewport(); // sonst träfe die nächste Leertaste einen Knopf, den man nicht sieht
});

test("Maus: wer nach dem Klick zur Historie gescrollt hat, bleibt dort — der Fehlschlag holt die Seite nicht zum Senden-Knopf zurück", async ({ page, api }) => {
  await page.setViewportSize({ width: 683, height: 728 });
  const post = hold();
  api.stub({ [HISTORY]: { json: LANGE_HISTORIE }, [SEND]: post.answer });
  await oeffne(page, /Meldung 19/);
  await fuelleAus(page);
  await sendeBestaetigt(page, api);
  await expect(senden(page)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const vorher = await page.evaluate(() => window.scrollY);
  await expect(senden(page)).not.toBeInViewport();

  post.release(fehler(422, "NO_RECIPIENTS", "'SAP Produktion' hat aktuell keine Empfänger"));
  await expectToast(page, "'SAP Produktion' hat aktuell keine Empfänger", { error: true });
  await expect(senden(page)).toBeFocused(); // der Fokus ist zurück …
  expect(await page.evaluate(() => window.scrollY)).toBe(vorher); // … die Seite steht, wo der Nutzer sie hingeschoben hat
});

test("Enter im Titelfeld stellt dieselbe Rückfrage wie der Knopf und sendet erst danach", async ({ page, api }) => {
  await oeffne(page);
  await fuelleAus(page);
  api.confirmNext(true);
  await titel(page).press("Enter");

  await expectToast(page, ANGELEGT);
  await api.sync();
  expect(api.dialogs).toEqual([FRAGE]);
  expect(meldungen(api)).toEqual([ENTWURF]);
});

test("Enter im Titelfeld bei unvollständiger Maske fragt nichts und sendet nichts", async ({ page, api }) => {
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await titel(page).fill(ENTWURF.title); // der Text fehlt
  await titel(page).press("Enter");

  await api.sync();
  expect(api.dialogs).toEqual([]);
  expect(api.calls(SEND)).toHaveLength(0);
  await expect(titel(page)).toHaveValue(ENTWURF.title);
});

// ---------- Historie ----------

test("Historie ohne Versände sagt das — abgefragt werden die letzten 20", async ({ page, api }) => {
  await oeffne(page, "Noch keine Versände.");
  await api.sync();
  expect(api.calls(HISTORY).map((call) => call.query)).toEqual([{ limit: "20" }]);
});

test("Historie zeigt je Versand Ortszeit, Betreff, Verteiler, Status, Gesendet/Gesamt und Fehler", async ({ page, api }) => {
  api.stub(HISTORY, {
    json: [
      dispatch({
        id: 2, subject: "[ENTWARNUNG] KAP: Wieder erreichbar", topic_name: "KAP", severity: "entwarnung",
        status: "completed_with_errors", recipient_count: 5000, sent_count: 4997, failed_count: 3,
        created_at: "2026-07-15T07:30:00", // Sommerzeit: UTC+2
      }),
      dispatch(), // Winterzeit: UTC+1
    ],
  });
  await oeffne(page, /Login gestört/);
  await expect(page.getByRole("row", { name: /Wieder erreichbar/ }).getByRole("cell")).toHaveText(
    ["15.07.2026, 09:30", "[ENTWARNUNG] KAP: Wieder erreichbar", "KAP", "Mit Fehlern", "4997/5000", "3"]);
  await expect(page.getByRole("row", { name: /Login gestört/ }).getByRole("cell")).toHaveText(
    ["15.01.2026, 08:00", "[STÖRUNG] SAP Produktion: Login gestört", "SAP Produktion", "Zugestellt", "10/10", "0"]);
});

test("Historie nennt jeden Status beim Namen; ein unbekannter erscheint als Text", async ({ page, api }) => {
  const stati = ["pending", "sending", "completed", "completed_with_errors", "failed", "archiviert"];
  api.stub(HISTORY, { json: stati.map((status, id) => dispatch({ id, status })) });
  await oeffne(page, /archiviert/);
  await expect(page.locator("#history-body .status-badge")).toHaveText(
    ["Wartet", "Versand läuft …", "Zugestellt", "Mit Fehlern", "Fehlgeschlagen", "archiviert"]);
});

test("Historie zeigt den Schweregrad als farbigen Punkt und einen gescheiterten Versand in Rot", async ({ page, api }) => {
  api.stub(HISTORY, {
    json: [
      dispatch({ id: 1, severity: "stoerung", subject: "Eins", status: "failed" }),
      dispatch({ id: 2, severity: "einschraenkung", subject: "Zwei" }),
      dispatch({ id: 3, severity: "entwarnung", subject: "Drei" }),
    ],
  });
  await oeffne(page, /Drei/);
  const punkt = (betreff) => page.getByRole("row", { name: betreff }).locator(".dot");
  await expect(punkt("Eins")).toHaveCSS("background-color", ROT);
  await expect(punkt("Zwei")).toHaveCSS("background-color", "rgb(241, 196, 15)");
  await expect(punkt("Drei")).toHaveCSS("background-color", "rgb(39, 174, 96)");
  await expect(page.getByRole("row", { name: "Eins" }).getByText("Fehlgeschlagen")).toHaveCSS("color", ROT);
});

test("Historie fragt alle 4 s nach, solange ein Versand läuft — und hört dann auf", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …\s*200\/1234/);

  await page.clock.runFor(3999);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(1);
  api.stub(HISTORY, { json: [ZUGESTELLT] });
  await page.clock.runFor(1);
  await expect(zeilen(page)).toHaveText([/Zugestellt\s*1234\/1234/]);

  await page.clock.runFor(60000); // abgeschlossen: kein weiterer Abruf
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
});

test("Gescheiterte Versände und solche mit Fehlern gelten als beendet — ihretwegen fragt die Historie nicht nach", async ({ page, api }) => {
  api.stub(HISTORY, {
    json: [dispatch({ id: 1, status: "failed" }), dispatch({ id: 2, status: "completed_with_errors" }), dispatch({ id: 3 })],
  });
  await oeffne(page, /Fehlgeschlagen/);
  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(1);
});

test("Jede Statusabfrage ersetzt die Zeilen der Historie — nichts wird angehängt", async ({ page, api }) => {
  api.stub(HISTORY, { json: [WARTET, LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  await expect(zeilen(page)).toHaveText([/Wartet\s*0\/1234/, /Versand läuft …\s*200\/1234/]);
  api.stub(HISTORY, { json: [{ ...WARTET, status: "sending", sent_count: 50 }, ZUGESTELLT] });
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*50\/1234/, /Zugestellt\s*1234\/1234/]);
});

test("Auch ein wartender Versand hält die Statusabfrage am Laufen — egal an welcher Stelle der Liste", async ({ page, api }) => {
  api.stub(HISTORY, { json: [dispatch(), WARTET] });
  await oeffne(page, /Wartet\s*0\/1234/);
  api.stub(HISTORY, { json: [dispatch(), { ...WARTET, status: "sending", sent_count: 50 }] });
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText([/Zugestellt\s*10\/10/, /Versand läuft …\s*50\/1234/]);
});

test("Nach einem Fehler der Statusabfrage geht es nach 10 s weiter statt nie", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  api.stub(HISTORY, fehler(500, "INTERNAL", "kurz nicht erreichbar"));
  await page.clock.runFor(4000);
  await api.sync(); // die Abfrage ist gescheitert, die bisherige Liste bleibt stehen
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*200\/1234/]);

  api.stub(HISTORY, { json: [ZUGESTELLT] });
  await page.clock.runFor(9999);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  await page.clock.runFor(1);
  await expect(zeilen(page)).toHaveText([/Zugestellt\s*1234\/1234/]);
});

test("Scheitert schon der erste Abruf der Historie, wird er nach 10 s nachgeholt", async ({ page, api }) => {
  api.stub(HISTORY, fehler(500, "INTERNAL", "kurz nicht erreichbar"));
  await page.goto("/versand.html");
  await expect(page.locator("#subject-preview")).toHaveText("[STÖRUNG] <Verteiler>: <Titel>"); // init() ist durch
  await api.sync();
  await expect(page.locator("#history-body")).toHaveText("Lade Versandhistorie …");

  api.stub(HISTORY, { json: [dispatch()] });
  await page.clock.runFor(9999);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(1);
  await page.clock.runFor(1);
  await expect(zeilen(page)).toHaveText([/Zugestellt\s*10\/10/]);
});

test("Sitzung läuft während der Statusabfrage ab (401): kein Sprung zum Login, die getippte Meldung bleibt", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  await fuelleAus(page);
  api.stub(HISTORY, NICHT_ANGEMELDET);
  await page.clock.runFor(4000);

  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
  await expect(page).toHaveURL("/versand.html");
  await erwarteMeldungSteht(page);
  await expect(page.locator("#toast")).toHaveCount(0);
});

test("Nach einem 403 der Historie (Adminrecht entzogen) steht „Keine Berechtigung.“ da — die Seite fragt nicht weiter nach", async ({ page, api }) => {
  api.stub(HISTORY, KEIN_ADMIN);
  await oeffne(page, "Keine Berechtigung.");

  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(1);
  await expect(page.locator("#history-body")).toHaveText("Keine Berechtigung.");
  await expect(page.locator("#toast")).toHaveCount(0);
});

test("Wird das Adminrecht entzogen, während ein Versand verfolgt wird (403), endet die Statusabfrage — statt der Zeilen steht „Keine Berechtigung.“ da", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/); // der 4-s-Takt läuft
  api.stub(HISTORY, KEIN_ADMIN);
  await page.clock.runFor(4000);
  await expect(page.locator("#history-body")).toHaveText("Keine Berechtigung.");

  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
});

test("Kommt das 403 beim Neuladen nach einem Versand, fragt auch der bisherige Takt nicht mehr nach", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/); // der 4-s-Takt läuft
  await fuelleAus(page);
  api.stub(HISTORY, KEIN_ADMIN); // Recht zwischen Versand und Neuladen entzogen
  await sendeBestaetigt(page, api);
  await expect(page.locator("#history-body")).toHaveText("Keine Berechtigung.");

  await page.clock.runFor(60000);
  await api.sync();
  expect(api.calls(HISTORY)).toHaveLength(2);
});

test("Ein 403 ohne den Fehlercode der API (etwa von einem vorgeschalteten Proxy) beendet die Statusabfrage nicht", async ({ page, api }) => {
  api.stub(HISTORY, { json: [LAEUFT] });
  await oeffne(page, /Versand läuft …/);
  api.stub(HISTORY, { status: 403, html: "<h1>403 Forbidden</h1>" });
  await page.clock.runFor(4000);
  await api.sync(); // abgelehnt — die bisherige Liste bleibt stehen
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*200\/1234/]);

  api.stub(HISTORY, { json: [ZUGESTELLT] });
  await page.clock.runFor(10000);
  await expect(zeilen(page)).toHaveText([/Zugestellt\s*1234\/1234/]);
});

test("XSS: Betreff und Verteiler der Historie bleiben Text", async ({ page, api }) => {
  api.stub(HISTORY, { json: [dispatch({ subject: XSS, topic_name: XSS })] });
  await oeffne(page, /Zugestellt/);
  const historie = page.locator("#history-body");
  await expect(historie.getByRole("cell")).toHaveText(["15.01.2026, 08:00", XSS, XSS, "Zugestellt", "10/10", "0"]);
  await expect(historie.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: Anführungszeichen in Status und Schweregrad verlassen das class-Attribut nicht; Zähler und Zeit bleiben Text", async ({ page, api }) => {
  const ausbruch = 'x" data-kaputt="1">' + XSS; // beendet ein ungeschütztes Attribut UND bringt ein Element mit
  api.stub(HISTORY, {
    json: [dispatch({
      status: ausbruch, severity: ausbruch, created_at: XSS, sent_count: XSS, recipient_count: XSS, failed_count: XSS,
    })],
  });
  await oeffne(page, /data-kaputt/);
  const historie = page.locator("#history-body");
  await expect(historie.getByRole("cell")).toHaveText(
    ["Invalid Date", "[STÖRUNG] SAP Produktion: Login gestört", "SAP Produktion", ausbruch, XSS + "/" + XSS, XSS]);
  await expect(historie.locator("img, [onerror], [data-kaputt]")).toHaveCount(0);
});

// ---------- Mit und ohne Adminrecht, ohne Verteiler, Ladefehler ----------

test("Mit Adminrecht steht „Versand“ in der Navigation — als aktuelle Seite hervorgehoben", async ({ page }) => {
  await oeffne(page);
  const versand = page.getByRole("link", { name: "Versand", exact: true });
  await expect(versand).toBeVisible();
  await expect(versand).toHaveCSS("background-color", "rgb(232, 239, 250)");
  await expect(page.getByRole("link", { name: "Meine Abos" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("Ohne Adminrecht: Hinweis statt Maske, keine Admin-Anfrage", async ({ page, api }) => {
  api.stub(ME, { json: me() });
  await oeffne(page, "Keine Berechtigung.");

  await expect(page.getByRole("heading", { name: "Für die Versand-Maske fehlt dir die Berechtigung" })).toBeVisible();
  await expect(page.locator(".send-grid")).toContainText(
    "Du bist als erika@example.org (Standard-Mitarbeiter) angemeldet. Um Störungsmeldungen zu versenden, " +
    "wird das im Portal vergebene Adminrecht benötigt.");
  await expect(page.locator("#send-form, #preview-frame")).toHaveCount(0);
  await expect(page.locator("#nav-versand")).toBeHidden();
  await expect(hinweis(page)).toBeHidden(); // der Hinweis auf einen unbestätigten Versand steht im HTML — und bleibt hier versteckt
  await expect(page.getByRole("link", { name: "Mit anderem Konto anmelden" }))
    .toHaveAttribute("href", "/auth/login?prompt=login&next=/versand.html");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);
});

test("Ohne Adminrecht: „Abmelden“ in der Hinweiskarte meldet per POST ab und führt zur Abmeldeseite", async ({ page, api, baseURL }) => {
  // Hier genügt ein Ziel bei der Anwendung selbst; den Sprung zu einem fremden Host prüft app.spec.js.
  api.stub({
    [ME]: { json: me() },
    [LOGOUT]: { json: { logout_url: baseURL + "/auth/abgemeldet?client_id=portal" } },
    [ABGEMELDET]: { html: "<!DOCTYPE html><title>Abgemeldet (Stub)</title>" },
  });
  await oeffne(page, "Keine Berechtigung.");
  await page.locator(".send-grid").getByRole("link", { name: "Abmelden" }).click();

  await expect(page).toHaveURL("/auth/abgemeldet?client_id=portal");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGOUT, ABGEMELDET]);
  expect(api.calls(LOGOUT)[0].headers["x-requested-with"]).toBe("fetch");
  expect(api.calls(ABGEMELDET)[0].query).toEqual({ client_id: "portal" });
});

test("XSS: die E-Mail-Adresse in der Hinweiskarte bleibt Text", async ({ page, api }) => {
  api.stub(ME, { json: me({ email: XSS }) });
  await oeffne(page, "Keine Berechtigung.");
  await expect(page.locator(".send-grid")).toContainText("Du bist als " + XSS + " (Standard-Mitarbeiter) angemeldet.");
  await expect(page.locator("body").locator("img, [onerror]")).toHaveCount(0);
});

test("Keine aktiven Verteiler: Auswahl gesperrt, der Knopf sagt warum, Fehlermeldung", async ({ page, api }) => {
  api.stub(TOPICS, { json: [] });
  await page.goto("/versand.html");

  await expectToast(page, "Es sind derzeit keine aktiven Verteiler vorhanden.", { error: true });
  await expect(verteiler(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Keine aktiven Verteiler vorhanden" })).toBeDisabled();
});

test("Ohne aktive Verteiler lässt sich auch mit Titel und Text nichts senden", async ({ page, api }) => {
  api.stub(TOPICS, { json: [] });
  await page.goto("/versand.html");
  await expectToast(page, "Es sind derzeit keine aktiven Verteiler vorhanden.", { error: true });

  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  await titel(page).press("Enter");
  await expect(page.getByRole("button", { name: "Keine aktiven Verteiler vorhanden" })).toBeDisabled();
  await page.getByRole("button", { name: "Keine aktiven Verteiler vorhanden" }).click({ force: true });
  await api.sync();
  expect(api.calls(SEND)).toHaveLength(0);
});

test("Auch ohne aktive Verteiler zeigt die Historie die früheren Versände — ein laufender wird weiterverfolgt", async ({ page, api }) => {
  api.stub({ [TOPICS]: { json: [] }, [HISTORY]: { json: [LAEUFT, dispatch()] } });
  await oeffne(page, /Versand läuft …/);
  await expectToast(page, "Es sind derzeit keine aktiven Verteiler vorhanden.", { error: true });
  await expect(zeilen(page)).toHaveText([/Versand läuft …\s*200\/1234/, /Zugestellt\s*10\/10/]);

  api.stub(HISTORY, { json: [ZUGESTELLT, dispatch()] });
  await page.clock.runFor(4000);
  await expect(zeilen(page)).toHaveText([/Zugestellt\s*1234\/1234/, /Zugestellt\s*10\/10/]);
});

test("Laden scheitert (/topics 500): Meldung in der Historie und als Fehler-Toast — die Maske bleibt gesperrt, auch nach dem Tippen", async ({ page, api }) => {
  api.stub(TOPICS, fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await oeffne(page, "Laden fehlgeschlagen: Datenbank nicht erreichbar");

  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await titel(page).fill(ENTWURF.title);
  await text(page).fill(ENTWURF.body);
  await titel(page).press("Enter");
  await expect(senden(page)).toBeDisabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS]); // auch danach keine weitere Anfrage
});

test("Ohne Sitzung: Weiterleitung zum Login mit next=/versand.html", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: { html: "<!DOCTYPE html><title>Login (Stub)</title>" } });
  await page.goto("/versand.html");

  await expect(page).toHaveURL("/auth/login?next=%2Fversand.html");
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/versand.html" }]);
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]); // sonst keine Anfrage
});

test("XSS: der Verteilername bleibt in der Auswahl Text", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ name: XSS })] });
  await oeffne(page);
  await expect(verteiler(page).locator("option")).toHaveText(["Verteiler auswählen …", XSS]);
  await expect(page.locator("body").locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: der Verteilername bleibt in der Betreffzeile Text", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ name: XSS })] });
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await titel(page).fill(ENTWURF.title);
  await expect(page.locator("#subject-preview")).toHaveText("[STÖRUNG] " + XSS + ": Login gestört");
  await expect(page.locator("#subject-preview").locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: der Verteilername steht wörtlich in der Rückfrage", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ name: XSS })] });
  await oeffne(page);
  await fuelleAus(page);
  api.confirmNext(false);
  await senden(page).click();
  expect(api.dialogs).toEqual(['Störungsmeldung an "' + XSS + '" (ca. 1.234 Empfänger) jetzt versenden?']);
});

test("XSS: eine Empfängerzahl, die keine Zahl ist, bleibt Text", async ({ page, api }) => {
  api.stub(COUNT, { json: { topic_id: "sap", count: XSS } });
  await oeffne(page);
  await verteiler(page).selectOption("sap");
  await erwarteEmpfaenger(page, XSS);
  await expect(page.locator("#recipient-hint").locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: der Fehlertext der API bleibt in Historie und Toast Text", async ({ page, api }) => {
  api.stub(TOPICS, fehler(500, "INTERNAL", XSS));
  await oeffne(page, "Laden fehlgeschlagen: " + XSS);
  await expectToast(page, XSS, { error: true });
  await expect(page.locator("body").locator("img, [onerror]")).toHaveCount(0);
});
