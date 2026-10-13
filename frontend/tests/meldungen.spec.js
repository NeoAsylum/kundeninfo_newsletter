/* meldungen.html + meldungen.js: Meldungs-Historie zum Nachschlagen — für alle, nur lesend. */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const {
  me, admin, topic, meldung, liste, fehler, NICHT_ANGEMELDET, LOGIN_STUB, GATEWAY, ANMELDESEITE, KEINE_API_ANTWORT,
  KEINE_VERBINDUNG, XSS,
} = require("./daten");

const ME = "GET /api/v1/me";
const TOPICS = "GET /api/v1/topics";
const LIST = "GET /api/v1/dispatches";
const LOGIN = "GET /auth/login";
const DB_FEHLER = fehler(500, "INTERNAL", "Datenbank nicht erreichbar");
const NETZ = { topic_id: "netz", topic_name: "Netzwerk" };

/** Meldungen „Meldung <von>“ … „Meldung <bis>“, die neueste zuerst — so sortiert die API. */
const meldungen = (von, bis, felder = {}) =>
  Array.from({ length: von - bis + 1 }, (_, i) => meldung({ id: von - i, subject: "Meldung " + (von - i), ...felder }));
/** … und so stehen ihre Betreffs dann untereinander. */
const betreffe = (von, bis) => meldungen(von, bis).map((eintrag) => eintrag.subject);

// Das Archiv hinter der API: die 20 neuesten Meldungen aus „SAP Produktion“, die 25 älteren
// aus „Netzwerk“, keine aus „Telefonie“.
const ARCHIV = [...meldungen(45, 26), ...meldungen(25, 1, NETZ)];

/** Antwortet wie die API: nach topic_id filtern, mit offset und limit blättern. */
function seite(call, archiv = ARCHIV) {
  const treffer = archiv.filter((eintrag) => !call.query.topic_id || eintrag.topic_id === call.query.topic_id);
  const offset = Number(call.query.offset);
  const limit = Number(call.query.limit);
  return { json: liste(treffer.slice(offset, offset + limit), treffer.length, limit, offset) };
}

/** Eine Anfrage an die Liste, wie sie in call.query ankommt: immer limit=20, der Blätterstand als
 *  offset, topic_id nur mit gewähltem Filter. */
const anfrage = (offset, topicId) => ({ limit: "20", offset: String(offset), ...(topicId ? { topic_id: topicId } : {}) });
/** Alles, was die Seite der Reihe nach an die Liste geschickt hat — vollständig erst nach `await api.sync()`. */
const anfragen = (api) => api.calls(LIST).map((call) => call.query);

test.beforeEach(async ({ api }) => {
  api.stub({
    [ME]: { json: me() }, // ohne Adminrecht — die Seite ist für alle da
    [TOPICS]: { json: [topic(), topic({ id: "netz", name: "Netzwerk" }), topic({ id: "tel", name: "Telefonie" })] },
    [LIST]: seite,
  });
});

/** Seite öffnen und abwarten, was init() als Letztes zeichnet: die erste Seite samt Zähler. */
async function oeffne(page, stand = "20 von 45") {
  await page.goto("/meldungen.html");
  await expect(zaehler(page)).toHaveText(stand);
}

const filter = (page) => page.getByLabel("Nach Verteiler filtern");
const zaehler = (page) => page.locator("#result-count");
const mehrLaden = (page) => page.getByRole("button", { name: "Mehr laden" });
/** Der Bereich unter dem Filter: die Karten — oder der Lade-, Leer- bzw. Fehlerhinweis. */
const anzeige = (page) => page.locator("#meldung-list");
const karten = (page) => page.getByRole("article");
/** Die Betreffs aller Karten von oben nach unten. */
const ueberschriften = (page) => page.getByRole("heading", { level: 2 });
/** Der farbige Punkt vor dem Schweregrad: reine Zier ohne Rolle und Text — nur über seine Klasse zu greifen. */
const punkt = (karte) => karte.locator(".dot");

/** Statt der Karten steht genau EIN Hinweis da (Laden, leer oder Fehler) — und er ist als Hinweis
 *  gesetzt: mittig (app.css), nicht wie Fließtext am linken Rand. Geprüft je Quelle des Hinweises
 *  einmal; wo es um anderes geht, genügt der Text. */
async function expectHinweis(page, text) {
  await expect(anzeige(page)).toHaveText(text);
  await expect(anzeige(page).getByRole("paragraph")).toHaveCSS("text-align", "center");
}

/** „Es gab keinen Toast“: app.js legt das Element (role="status") erst mit dem ersten Toast an.
 *  expectToast() aus dem Harness kennt nur den positiven Fall. */
const expectKeinToast = (page) => expect(page.getByRole("status")).toHaveCount(0);

// ---------- Die Karte ----------

test("eine Meldung zeigt Betreff, Schweregrad, Verteiler, Ortszeit und Text", async ({ page, api }) => {
  api.stub(LIST, { json: liste([meldung()], 1, 20) });
  await oeffne(page, "1 von 1");

  // So liest sich die Karte von oben nach unten. created_at kommt als UTC ohne „Z“ (07:00) —
  // angezeigt wird die Berliner Zeit.
  await expect(karten(page)).toHaveText(
    "[STÖRUNG] SAP Produktion: Login gestört Störung SAP Produktion 15.01.2026, 08:00 Bitte nicht neu anmelden.",
    { useInnerText: true });
  const betreff = karten(page).getByRole("heading", { level: 2 });
  await expect(betreff).toHaveText("[STÖRUNG] SAP Produktion: Login gestört");
  await expect(betreff).toHaveCSS("font-size", "16px"); // als Kartenkopf gesetzt, nicht in der Browser-Vorgabe für <h2>
  await expect(karten(page).getByRole("paragraph")).toHaveText("Bitte nicht neu anmelden.");
});

test("Zeilenumbrüche und Absätze des Meldungstexts bleiben erhalten", async ({ page, api }) => {
  const body = "SAP ist gestört.\nBitte nicht neu anmelden.\n\nEntwarnung folgt.";
  api.stub(LIST, { json: liste([meldung({ body })], 1, 20) });
  await oeffne(page, "1 von 1");

  // innerText ist, was der Nutzer sieht: Ohne `white-space: pre-wrap` stünde alles in EINER Zeile.
  await expect(karten(page).getByRole("paragraph"))
    .toHaveText(/^SAP ist gestört\.\nBitte nicht neu anmelden\.\n\nEntwarnung folgt\.$/, { useInnerText: true });
});

test("jeder Schweregrad trägt sein Etikett und seine Farbe", async ({ page, api }) => {
  const grade = ["stoerung", "einschraenkung", "entwarnung"];
  api.stub(LIST, { json: liste(grade.map((severity, i) => meldung({ id: 3 - i, severity })), 3, 20) });
  await oeffne(page, "3 von 3");

  const etiketten = ["Störung", "Einschränkung", "Entwarnung"];
  const farben = ["rgb(192, 57, 43)", "rgb(241, 196, 15)", "rgb(39, 174, 96)"]; // --danger, --warn, --ok (app.css)
  for (const [i, farbe] of farben.entries()) {
    const karte = karten(page).nth(i);
    await expect(karte.getByText(etiketten[i], { exact: true })).toBeVisible();
    await expect(karte).toHaveCSS("border-left-color", farbe); // Randstreifen der Karte
    await expect(punkt(karte)).toBeVisible(); // der Punkt vor dem Etikett …
    await expect(punkt(karte)).toHaveCSS("background-color", farbe); // … in derselben Farbe
  }
});

test("ein unbekannter Schweregrad steht als Text da und bildet keinen Klassennamen", async ({ page, api }) => {
  api.stub(LIST, { json: liste([meldung({ severity: "kritisch" })], 1, 20) });
  await oeffne(page, "1 von 1");

  await expect(karten(page).getByText("kritisch", { exact: true })).toBeVisible();
  await expect(karten(page)).toHaveClass("meldung"); // genau diese eine Klasse, kein „meldung-kritisch“
  await expect(punkt(karten(page))).toHaveClass("dot");
});

test("auch ein Schweregrad, der wie eine geerbte Eigenschaft heißt („constructor“), steht als Text da und bildet keinen Klassennamen", async ({ page, api }) => {
  // Ein bloßer Nachschlag in der Etikettentabelle fände auch, was jedes Objekt erbt — als Etikett
  // stünde dann „function Object() { [native code] }“ da.
  const geerbt = ["constructor", "__proto__", "toString"];
  api.stub(LIST, { json: liste(geerbt.map((severity, i) => meldung({ id: 3 - i, severity })), 3, 20) });
  await oeffne(page, "3 von 3");

  for (const [i, severity] of geerbt.entries()) {
    const karte = karten(page).nth(i);
    await expect(karte.getByText(severity, { exact: true })).toBeVisible();
    await expect(karte).toHaveClass("meldung");
    await expect(punkt(karte)).toHaveClass("dot");
  }
});

test("ein Schweregrad, der gar kein Text ist (null, eine Zahl), bringt die Liste nicht zu Fall — die Karten stehen ohne Farbe da", async ({ page, api }) => {
  const ohneText = [...meldungen(2, 2, { severity: null }), ...meldungen(1, 1, { severity: 3 })];
  api.stub(LIST, { json: liste(ohneText, 2, 20) });
  await oeffne(page, "2 von 2");

  await expect(ueberschriften(page)).toHaveText(betreffe(2, 1));
  await expect(karten(page)).toHaveClass(["meldung", "meldung"]);
  await expect(punkt(karten(page))).toHaveClass(["dot", "dot"]);
});

test("XSS: Betreff, Schweregrad, Verteiler, Text und Gesamtzahl aus der API bleiben Text", async ({ page, api }) => {
  const boese = meldung({ subject: "Betreff " + XSS, severity: XSS, topic_name: "Verteiler " + XSS, body: "Text " + XSS });
  api.stub(LIST, { json: liste([boese], XSS, 20) });
  await oeffne(page, "1 von " + XSS);

  await expect(karten(page).getByRole("heading", { level: 2 })).toHaveText("Betreff " + XSS);
  await expect(karten(page).getByText(XSS, { exact: true })).toBeVisible(); // der Schweregrad
  await expect(karten(page).getByText("Verteiler " + XSS, { exact: true })).toBeVisible();
  await expect(karten(page).getByRole("paragraph")).toHaveText("Text " + XSS);
  await expect(karten(page)).toHaveClass("meldung"); // der Schweregrad wurde kein Klassenname
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: Verteilername im Filter und E-Mail in der Kopfzeile bleiben Text", async ({ page, api }) => {
  api.stub({ [ME]: { json: me({ email: XSS }) }, [TOPICS]: { json: [topic({ name: XSS })] } });
  await oeffne(page);

  await expect(filter(page).getByRole("option")).toHaveText(["Alle Verteiler", XSS]);
  await expect(page.locator("#user-chip")).toHaveText(XSS);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: der Fehlertext der API bleibt Text — in der Liste und im Toast", async ({ page, api }) => {
  api.stub(LIST, fehler(500, "INTERNAL", XSS));
  await page.goto("/meldungen.html");

  await expect(anzeige(page)).toHaveText("Laden fehlgeschlagen: " + XSS);
  await expectToast(page, XSS, { error: true });
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

// ---------- Start ----------

test("solange /me noch aussteht, steht der Ladehinweis da — kein leerer Bereich, kein „Mehr laden“", async ({ page, api }) => {
  const ich = hold();
  api.stub(ME, ich.answer);
  await page.goto("/meldungen.html");

  // Der Hinweis steht schon im HTML: Eine träge API lässt den Bereich nicht leer.
  await expectHinweis(page, "Lade Meldungen …");
  await expect(mehrLaden(page)).toBeHidden();
  ich.release({ json: me() });
  await expect(zaehler(page)).toHaveText("20 von 45");
});

test("die Seite holt einmal die neuesten 20 Meldungen ohne Filter — und fragt nicht von selbst nach", async ({ page, api }) => {
  await oeffne(page);
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await expect(anzeige(page)).not.toContainText("Lade Meldungen"); // der Ladehinweis ist weg

  await page.clock.runFor(10 * 60 * 1000); // kein Polling: Nachschlagewerk, keine Live-Ansicht
  await api.sync();
  expect(anfragen(api)).toEqual([{ limit: "20", offset: "0" }]);
});

test("der Filter steht auf „Alle Verteiler“ und bietet die Verteiler der API in ihrer Reihenfolge an", async ({ page }) => {
  await oeffne(page);

  await expect(filter(page)).toHaveValue("");
  await expect(filter(page).getByRole("option")).toHaveText(["Alle Verteiler", "SAP Produktion", "Netzwerk", "Telefonie"]);
});

test("der Zähler ist eine Live-Region: Screenreader bekommen den neuen Stand angesagt", async ({ page }) => {
  await oeffne(page);

  await expect(zaehler(page)).toHaveAttribute("aria-live", "polite");
});

// ---------- Blättern ----------

test("„Mehr laden“ holt die nächsten 20 (offset=20) und hängt sie unten an", async ({ page, api }) => {
  await oeffne(page);
  await expect(mehrLaden(page)).toBeVisible();
  await expect(mehrLaden(page)).toBeEnabled();

  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("40 von 45");
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 6));
  await expect(mehrLaden(page)).toBeVisible(); // fünf fehlen noch
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20)]);
});

test("„Mehr laden“ verschwindet, sobald die letzte Seite da ist", async ({ page, api }) => {
  await oeffne(page);
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("40 von 45");
  await mehrLaden(page).click();

  await expect(zaehler(page)).toHaveText("45 von 45");
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 1));
  await expect(mehrLaden(page)).toBeHidden();
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(40)]);
});

test("Grenze: bei „20 von 20“ gibt es kein „Mehr laden“, bei „20 von 21“ ist es da", async ({ page, api }) => {
  const archiv = [...meldungen(41, 21), ...meldungen(20, 1, NETZ)]; // 21 × SAP Produktion, 20 × Netzwerk
  api.stub(LIST, (call) => seite(call, archiv));
  await oeffne(page, "20 von 41");

  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 20");
  await expect(mehrLaden(page)).toBeHidden();
  await filter(page).selectOption("sap");
  await expect(zaehler(page)).toHaveText("20 von 21");
  await expect(mehrLaden(page)).toBeVisible();
});

test("„Mehr laden“ ist gesperrt, solange die Anfrage läuft — auch ein Doppelklick fordert die Seite nur einmal an", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await zweite.answer(); // Seite 2 lässt auf sich warten
    return seite(call);
  });
  await oeffne(page);

  await mehrLaden(page).dblclick();
  await expect(mehrLaden(page)).toBeDisabled();
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20)]);
  zweite.release();

  await expect(zaehler(page)).toHaveText("40 von 45");
  await expect(mehrLaden(page)).toBeEnabled();
});

test("kommt zwischen zwei Seiten eine Meldung hinzu, lädt „Mehr laden“ von vorn — keine Karte doppelt, die neueste ist da", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  api.stub(LIST, (call) => seite(call, archiv));
  await oeffne(page);

  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet: alles rutscht eine Stelle
  await mehrLaden(page).click();

  await expect(zaehler(page)).toHaveText("20 von 46");
  // Angehängt stünde „Meldung 26“ zweimal da, und „Meldung 46“ fehlte.
  await expect(ueberschriften(page)).toHaveText(betreffe(46, 27));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]);
});

test("fällt zwischen zwei Seiten eine Meldung weg, lädt „Mehr laden“ ebenfalls von vorn — keine fehlt, die entfallene steht nicht mehr da", async ({ page, api }) => {
  // Die Seite verlässt sich nicht darauf, dass die Gesamtzahl nur wächst.
  const archiv = [...ARCHIV];
  api.stub(LIST, (call) => seite(call, archiv));
  await oeffne(page);

  archiv.splice(5, 1); // „Meldung 40“ gibt es nicht mehr: alles dahinter rückt eine Stelle auf
  await mehrLaden(page).click();

  await expect(zaehler(page)).toHaveText("20 von 44");
  // Angehängt bliebe „Meldung 40“ stehen, und „Meldung 25“ erschiene nie.
  await expect(ueberschriften(page)).toHaveText([...betreffe(45, 41), ...betreffe(39, 25)]);
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]);
});

test("das Neuladen von vorn behält den Filter — und danach blättert „Mehr laden“ normal weiter", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  api.stub(LIST, (call) => seite(call, archiv));
  await oeffne(page);
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");

  archiv.unshift(meldung({ id: 46, subject: "Meldung 46", ...NETZ })); // inzwischen an „Netzwerk“ versendet
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("20 von 26");
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("26 von 26");
  await expect(ueberschriften(page)).toHaveText(["Meldung 46", ...betreffe(25, 1)]);
  await api.sync();
  expect(anfragen(api)).toEqual([
    anfrage(0), anfrage(0, "netz"), anfrage(20, "netz"), anfrage(0, "netz"), anfrage(20, "netz"),
  ]);
});

test("während „Mehr laden“ von vorn lädt, bleiben die geladenen Meldungen stehen — kein Ladehinweis, und der Knopf ist gesperrt", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  const vonVorn = hold();
  api.stub(LIST, async (call) => {
    if (archiv.length > ARCHIV.length && call.query.offset === "0") await vonVorn.answer(); // die neue erste Seite lässt auf sich warten
    return seite(call, archiv);
  });
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click();
  await expect.poll(() => anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]); // das Neuladen ist unterwegs

  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26)); // scheitert es, ist nichts verloren
  await expect(anzeige(page)).not.toContainText("Lade Meldungen");
  await expect(zaehler(page)).toHaveText("20 von 45");
  await expect(mehrLaden(page)).toBeDisabled();
  await mehrLaden(page).click({ force: true }); // ungeduldig noch einmal: der Klick kommt nicht an
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]);
  vonVorn.release();
  await expect(zaehler(page)).toHaveText("20 von 46");
  await expect(ueberschriften(page)).toHaveText(betreffe(46, 27));
});

test("liefert „Mehr laden“ eine leere Seite, bleiben die geladenen Meldungen stehen", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, (call) => (call.query.offset === "20" ? zweite.answer() : seite(call)));
  await oeffne(page);
  await mehrLaden(page).click();
  await expect(mehrLaden(page)).toBeDisabled();

  zweite.release({ json: liste([], 45, 20, 20) }); // widersprüchlich: nichts mehr da, die Gesamtzahl bleibt 45
  await expect(mehrLaden(page)).toBeEnabled(); // die Antwort ist verarbeitet
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26)); // nicht „Noch keine Meldungen versendet.“
  await expect(zaehler(page)).toHaveText("20 von 45");
});

// ---------- Filter ----------

test("Filterwechsel: genau eine Anfrage — mit topic_id und wieder offset 0; die Liste wird ersetzt statt verlängert", async ({ page, api }) => {
  await oeffne(page);
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("40 von 45"); // der Blätterstand steht bei 40

  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 6));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0, "netz")]);
});

test("„Mehr laden“ blättert im gewählten Filter weiter: offset=20 mit derselben topic_id", async ({ page, api }) => {
  await oeffne(page);
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");

  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("25 von 25");
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 1));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(0, "netz"), anfrage(20, "netz")]);
});

test("zurück auf „Alle Verteiler“ fragt wieder ohne Filter", async ({ page, api }) => {
  await oeffne(page);
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");

  await filter(page).selectOption({ label: "Alle Verteiler" });
  await expect(zaehler(page)).toHaveText("20 von 45");
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(0, "netz"), anfrage(0)]); // zuletzt ohne topic_id
});

test("die Verteiler-ID geht URL-kodiert in die Anfrage", async ({ page, api }) => {
  const id = "netz & co/ä?#=1"; // unkodiert zerfiele das in mehrere Parameter und einen Anker
  api.stub(TOPICS, { json: [topic({ id, name: "Netz & Co" })] });
  api.stub(LIST, (call) => seite(call, [...ARCHIV, ...meldungen(3, 1, { topic_id: id, topic_name: "Netz & Co" })]));
  await oeffne(page, "20 von 48");

  await filter(page).selectOption({ label: "Netz & Co" });
  await expect(zaehler(page)).toHaveText("3 von 3");
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(0, id)]);
});

// ---------- Leer ----------

test("leeres Archiv: „Noch keine Meldungen versendet.“", async ({ page, api }) => {
  api.stub(LIST, { json: liste([], 0, 20) });
  await oeffne(page, "0 von 0");

  await expectHinweis(page, "Noch keine Meldungen versendet.");
  await expect(mehrLaden(page)).toBeHidden();
});

test("Verteiler ohne Meldung: eigener Hinweis — Zähler und „Mehr laden“ der alten Liste sind weg", async ({ page }) => {
  await oeffne(page);
  await expect(mehrLaden(page)).toBeVisible();

  await filter(page).selectOption("tel");
  await expect(anzeige(page)).toHaveText("Für diesen Verteiler wurde noch keine Meldung versendet.");
  await expect(zaehler(page)).toHaveText("0 von 0");
  await expect(mehrLaden(page)).toBeHidden();
});

// ---------- Laden und überholte Antworten ----------

test("während der neue Filter lädt, steht der Ladehinweis da statt der alten Karten — „Mehr laden“ ist gesperrt", async ({ page, api }) => {
  const netz = hold();
  api.stub(LIST, async (call) => {
    if (call.query.topic_id === "netz") await netz.answer(); // „Netzwerk“ lässt auf sich warten
    return seite(call);
  });
  await oeffne(page);
  await filter(page).selectOption("netz");

  // Blieben die SAP-Karten stehen, läse der Nutzer sie unter dem Filter „Netzwerk“.
  await expectHinweis(page, "Lade Meldungen …");
  await expect(mehrLaden(page)).toBeDisabled();
  netz.release();
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expect(mehrLaden(page)).toBeEnabled();
});

test("Race: die verspätete Antwort des alten Filters ersetzt die neue Liste nicht", async ({ page, api }) => {
  const netz = hold();
  api.stub(LIST, async (call) => {
    if (call.query.topic_id === "netz") await netz.answer();
    return seite(call);
  });
  await oeffne(page);
  await filter(page).selectOption("netz");
  await filter(page).selectOption("sap");
  await expect(zaehler(page)).toHaveText("20 von 20");

  netz.release(); // jetzt erst kommt „Netzwerk“ an (20 von 25)
  await api.sync();
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await expect(zaehler(page)).toHaveText("20 von 20");
  await expect(filter(page)).toHaveValue("sap");
});

test("Race: zurück zum selben Filter — die verspätete erste Antwort dieses Filters zählt nicht noch einmal", async ({ page, api }) => {
  // Netzwerk → SAP → Netzwerk: Die überholte Anfrage gilt DEMSELBEN Filter wie die aktuelle.
  const erste = hold();
  let netzAnfragen = 0;
  api.stub(LIST, async (call) => {
    if (call.query.topic_id === "netz" && ++netzAnfragen === 1) await erste.answer(); // nur die erste hängt
    return seite(call);
  });
  await oeffne(page);
  await filter(page).selectOption("netz");
  await filter(page).selectOption("sap");
  await expect(zaehler(page)).toHaveText("20 von 20");
  await filter(page).selectOption("netz"); // die zweite „Netzwerk“-Anfrage wird sofort beantwortet
  await expect(zaehler(page)).toHaveText("20 von 25");

  erste.release();
  await api.sync();
  await expect(zaehler(page)).toHaveText("20 von 25"); // nicht „40 von 25“
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 6));
  await expect(mehrLaden(page)).toBeVisible(); // fünf fehlen noch
});

test("Race: ein noch laufendes „Mehr laden“ hängt nach dem Filterwechsel nichts an die neue Liste", async ({ page, api }) => {
  // Je 30 Meldungen: Bei gleicher Gesamtzahl greift der Schutz „Gesamtzahl geändert“ nicht mit.
  const archiv = [...meldungen(60, 31), ...meldungen(30, 1, NETZ)];
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await zweite.answer();
    return seite(call, archiv);
  });
  await oeffne(page, "20 von 60");
  await filter(page).selectOption("sap");
  await expect(zaehler(page)).toHaveText("20 von 30");
  await mehrLaden(page).click(); // Seite 2 von „SAP Produktion“ bleibt aus
  await filter(page).selectOption("netz");
  await expect(ueberschriften(page)).toHaveText(betreffe(30, 11));

  zweite.release();
  await api.sync();
  await expect(ueberschriften(page)).toHaveText(betreffe(30, 11)); // keine SAP-Karten unter „Netzwerk“
  await expect(zaehler(page)).toHaveText("20 von 30");
  await expect(mehrLaden(page)).toBeEnabled();
});

test("Race: ein überholtes „Mehr laden“ mit anderer Gesamtzahl lädt den neuen Filter nicht von vorn — dort Nachgeladenes bleibt stehen", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20" && !call.query.topic_id) await zweite.answer(); // Seite 2 von „Alle Verteiler“ hängt
    return seite(call);
  });
  await oeffne(page); // 20 von 45
  await mehrLaden(page).click();
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("25 von 25"); // „Netzwerk“ ist vollständig geladen

  zweite.release(); // 45 statt 25: für die überholte Antwort kein Grund, „Netzwerk“ neu zu laden
  await api.sync(); // die Seite hat die Antwort verarbeitet …
  await api.sync(); // … und was sie daraufhin abgesetzt hätte, ist protokolliert
  await expect(zaehler(page)).toHaveText("25 von 25");
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 1));
  await expect(mehrLaden(page)).toBeHidden();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0, "netz"), anfrage(20, "netz")]);
});

test("Race: wechselt der Filter, während „Mehr laden“ von vorn lädt, gewinnt der Filter — die verspätete erste Seite ersetzt seine Liste nicht", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  const vonVorn = hold();
  api.stub(LIST, async (call) => {
    if (archiv.length > ARCHIV.length && call.query.offset === "0" && !call.query.topic_id) await vonVorn.answer();
    return seite(call, archiv);
  });
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click();
  await expect.poll(() => anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]); // das Neuladen ist unterwegs
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");
  await mehrLaden(page).scrollIntoViewIfNeeded(); // der Leser ist in der neuen Liste schon wieder am Ende

  vonVorn.release(); // „Alle Verteiler“ von vorn (20 von 46) kommt zu spät
  await api.sync();
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 6));
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expect(mehrLaden(page)).toBeEnabled();
  await expect(mehrLaden(page)).toBeInViewport(); // und das Fenster springt nicht mehr an den Seitenanfang
});

test("Race: auch nach der verworfenen Antwort des Neuladens von vorn blättert „Mehr laden“ im neuen Filter normal weiter — keine Karte doppelt, kein zweites Neuladen", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  const vonVorn = hold();
  api.stub(LIST, async (call) => {
    if (archiv.length > ARCHIV.length && call.query.offset === "0" && !call.query.topic_id) await vonVorn.answer();
    return seite(call, archiv);
  });
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click();
  await expect.poll(() => anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]); // das Neuladen ist unterwegs
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");
  vonVorn.release(); // „Alle Verteiler“ von vorn (20 von 46) kommt zu spät und wird verworfen
  await api.sync();

  // Blätterstand (20) und Gesamtzahl (25) gehören „Netzwerk“ — die verworfene Antwort hat sie nicht angefasst.
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("25 von 25");
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 1));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0), anfrage(0, "netz"), anfrage(20, "netz")]);
});

test("Race: nach der verworfenen Antwort blättert „Mehr laden“ normal weiter — kein Neuladen von vorn", async ({ page, api }) => {
  const netz = hold();
  api.stub(LIST, async (call) => {
    if (call.query.topic_id === "netz") await netz.answer();
    return seite(call);
  });
  await oeffne(page);
  await filter(page).selectOption("netz");
  await filter(page).selectOption({ label: "Alle Verteiler" });
  await expect(zaehler(page)).toHaveText("20 von 45");
  netz.release(); // „Netzwerk“ (Gesamtzahl 25) kommt zu spät und wird verworfen
  await api.sync();
  await expect(zaehler(page)).toHaveText("20 von 45");

  await mehrLaden(page).click(); // die gemerkte Gesamtzahl ist weiter 45: anhängen, nicht von vorn
  await expect(zaehler(page)).toHaveText("40 von 45");
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 6));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(0, "netz"), anfrage(0), anfrage(20)]);
});

test("Race: scheitert die überholte Anfrage verspätet, bleibt die neue Liste stehen — ohne Fehler-Toast", async ({ page, api }) => {
  const netz = hold();
  api.stub(LIST, (call) => (call.query.topic_id === "netz" ? netz.answer() : seite(call)));
  await oeffne(page);
  await filter(page).selectOption("netz");
  await filter(page).selectOption("sap");
  await expect(zaehler(page)).toHaveText("20 von 20");

  netz.release(DB_FEHLER);
  await api.sync();
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await expect(zaehler(page)).toHaveText("20 von 20");
  await expectKeinToast(page);
});

test("Race: scheitert ein überholtes „Mehr laden“ verspätet, bleibt es still — die neue Liste steht, kein Fehler-Toast", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, (call) => (call.query.offset === "20" ? zweite.answer() : seite(call)));
  await oeffne(page);
  await mehrLaden(page).click(); // Seite 2 von „Alle Verteiler“ bleibt aus
  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");

  zweite.release(GATEWAY);
  await api.sync();
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 6));
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expectKeinToast(page);
});

test("Race: die überholte Antwort gibt „Mehr laden“ nicht frei, solange die neue Anfrage läuft", async ({ page, api }) => {
  const netz = hold();
  const sap = hold();
  api.stub(LIST, async (call) => {
    if (call.query.topic_id === "netz") await netz.answer();
    if (call.query.topic_id === "sap") await sap.answer();
    return seite(call);
  });
  await oeffne(page); // 20 von 45: „Mehr laden“ ist da
  await filter(page).selectOption("netz");
  await filter(page).selectOption("sap");

  netz.release();
  await api.sync();
  await expect(mehrLaden(page)).toBeDisabled();
  await expect(anzeige(page)).toHaveText("Lade Meldungen …");
  sap.release();
  await expect(zaehler(page)).toHaveText("20 von 20");
});

test("Race: auch ein überholtes „Mehr laden“ gibt den Knopf nicht frei, solange der neue Filter lädt", async ({ page, api }) => {
  const zweite = hold();
  const netz = hold();
  api.stub(LIST, async (call) => {
    if (call.query.topic_id === "netz") await netz.answer();
    else if (call.query.offset === "20") await zweite.answer(); // Seite 2 von „Alle Verteiler“
    return seite(call);
  });
  await oeffne(page);
  await mehrLaden(page).click();
  await filter(page).selectOption("netz");

  zweite.release();
  await api.sync();
  await expect(mehrLaden(page)).toBeDisabled();
  await expect(anzeige(page)).toHaveText("Lade Meldungen …"); // und nichts hängt am Ladehinweis
  netz.release();
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expect(mehrLaden(page)).toBeEnabled();
});

// ---------- Fehler ----------

test("erste Seite scheitert: Fehlermeldung statt Ladehinweis und Fehler-Toast — Zähler und „Mehr laden“ tauchen nicht auf", async ({ page, api }) => {
  api.stub(LIST, DB_FEHLER);
  await page.goto("/meldungen.html");

  await expectHinweis(page, "Laden fehlgeschlagen: Datenbank nicht erreichbar");
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  // Beides gab es hier noch nicht. Dass der Fehler den Stand einer ALTEN Liste abräumt, prüft der nächste Test.
  await expect(zaehler(page)).toHaveText("");
  await expect(mehrLaden(page)).toBeHidden();
});

test("Filterwechsel scheitert: der Fehler ersetzt die alte Liste — ihr Zähler und ihr „Mehr laden“ verschwinden", async ({ page, api }) => {
  // Auch ein 4xx ist ein Fehler: hier das 429 des Proxys (NGINX: limit_conn_status 429) — HTML statt JSON.
  const gedrosselt = { status: 429, html: "<h1>429 Too Many Requests</h1>" };
  api.stub(LIST, (call) => (call.query.topic_id ? gedrosselt : seite(call)));
  await oeffne(page); // 20 von 45 …
  await expect(mehrLaden(page)).toBeVisible(); // … und „Mehr laden“ ist da
  await filter(page).selectOption("netz");

  await expect(anzeige(page)).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 429)");
  await expectToast(page, "Fehler (HTTP 429)", { error: true });
  // Sonst stünde „20 von 45“ neben der Fehlermeldung, und „Mehr laden“ hinge Karten an sie an.
  await expect(zaehler(page)).toHaveText("");
  await expect(mehrLaden(page)).toBeHidden();
});

test("nach einem Ladefehler lädt der nächste Filterwechsel wieder ganz normal", async ({ page, api }) => {
  api.stub(LIST, (call) => (call.query.topic_id ? seite(call) : DB_FEHLER)); // nur „Alle Verteiler“ scheitert
  await page.goto("/meldungen.html");
  await expect(anzeige(page)).toHaveText("Laden fehlgeschlagen: Datenbank nicht erreichbar");

  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expect(ueberschriften(page)).toHaveText(betreffe(25, 6));
  await expect(anzeige(page)).not.toContainText("Laden fehlgeschlagen");
  await expect(mehrLaden(page)).toBeVisible();
  await expect(mehrLaden(page)).toBeEnabled();
});

test("Nachladen scheitert: die geladenen Meldungen bleiben, nur ein Fehler-Toast — der nächste Versuch holt dieselbe Seite", async ({ page, api }) => {
  let versuche = 0; // der erste Griff nach Seite 2 endet am Proxy, der zweite kommt durch
  api.stub(LIST, (call) => (call.query.offset === "20" && ++versuche === 1 ? GATEWAY : seite(call)));
  await oeffne(page);
  await mehrLaden(page).click();

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await expect(zaehler(page)).toHaveText("20 von 45");
  await expect(mehrLaden(page)).toBeEnabled();

  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("40 von 45");
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 6));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(20)]);
});

test("scheitert das Neuladen von vorn, bleiben die geladenen Meldungen stehen — nur ein Fehler-Toast, Zähler und „Mehr laden“ wie zuvor", async ({ page, api }) => {
  // „Mehr laden“ bemerkt die geänderte Gesamtzahl und holt Seite 1 neu — DIESE Anfrage scheitert.
  const archiv = [...ARCHIV];
  const vonVorn = (call) => archiv.length > ARCHIV.length && call.query.offset === "0";
  api.stub(LIST, (call) => (vonVorn(call) ? GATEWAY : seite(call, archiv)));
  await oeffne(page);

  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click(); // Seite 2 nennt 46 statt 45 → von vorn → 502

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await expect(anzeige(page)).not.toContainText("Laden fehlgeschlagen");
  await expect(zaehler(page)).toHaveText("20 von 45");
  await expect(mehrLaden(page)).toBeVisible();
  await expect(mehrLaden(page)).toBeEnabled();
  await expect(mehrLaden(page)).toBeInViewport(); // auch das Fenster steht noch, wo geklickt wurde: Der nächste Versuch liegt unter der Maus
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]);
});

test("nach dem gescheiterten Neuladen von vorn bemerkt der nächste Klick die Verschiebung erneut — keine Karte doppelt, die neueste ist da", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  let versuche = 0; // der erste Griff nach der neuen ersten Seite scheitert am Netz, der zweite kommt durch
  const vonVorn = (call) => archiv.length > ARCHIV.length && call.query.offset === "0";
  api.stub(LIST, (call) => (vonVorn(call) && ++versuche === 1 ? { abort: true } : seite(call, archiv)));
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click();
  await expectToast(page, KEINE_VERBINDUNG, { error: true });
  await expect(zaehler(page)).toHaveText("20 von 45"); // der Blätterstand beschreibt weiter, was dasteht

  await mehrLaden(page).click(); // fragt wieder nach Seite 2 (offset 20), sieht wieder 46 statt 45 → von vorn
  await expect(zaehler(page)).toHaveText("20 von 46");
  // Hätte der gescheiterte Versuch die 46 schon übernommen, hinge jetzt „Meldung 26“ ein zweites Mal an.
  await expect(ueberschriften(page)).toHaveText(betreffe(46, 27));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0), anfrage(20), anfrage(0)]);
});

test("auch eine Antwort ohne JSON ist ein gescheitertes Neuladen von vorn: Die geladenen Meldungen bleiben stehen, und der nächste Klick lädt von vorn", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  let versuche = 0; // beim ersten Griff nach der neuen ersten Seite antwortet nicht die API, beim zweiten wieder
  const vonVorn = (call) => archiv.length > ARCHIV.length && call.query.offset === "0";
  api.stub(LIST, (call) => (vonVorn(call) && ++versuche === 1 ? ANMELDESEITE : seite(call, archiv)));
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click();

  await expectToast(page, KEINE_API_ANTWORT, { error: true });
  await expect(ueberschriften(page)).toHaveText(betreffe(45, 26));
  await expect(zaehler(page)).toHaveText("20 von 45");
  await expect(mehrLaden(page)).toBeVisible();
  await expect(mehrLaden(page)).toBeEnabled();

  await mehrLaden(page).click(); // Blätterstand und Gesamtzahl sind unberührt: wieder Seite 2, wieder 46 statt 45 → von vorn
  await expect(zaehler(page)).toHaveText("20 von 46");
  await expect(ueberschriften(page)).toHaveText(betreffe(46, 27));
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0), anfrage(20), anfrage(0)]);
});

test("antwortet statt der API jemand mit 200 und HTML, liest der Nutzer eine deutsche Fehlermeldung — keine Skriptmeldung des Browsers", async ({ page, api }) => {
  api.stub(LIST, ANMELDESEITE);
  await page.goto("/meldungen.html");

  await expect(anzeige(page)).toHaveText("Laden fehlgeschlagen: " + KEINE_API_ANTWORT);
  await expectToast(page, KEINE_API_ANTWORT, { error: true });
});

test("Start scheitert (/topics antwortet 500): Fehlermeldung, Fehler-Toast und keine Meldungs-Anfrage", async ({ page, api }) => {
  api.stub(TOPICS, DB_FEHLER);
  await page.goto("/meldungen.html");

  await expectHinweis(page, "Laden fehlgeschlagen: Datenbank nicht erreichbar");
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(mehrLaden(page)).toBeHidden();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS]);
});

// ---------- Sitzung ----------

test("ohne Sitzung: Weiterleitung zum Login mit next=/meldungen.html", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/meldungen.html");

  await expect(page).toHaveURL("/auth/login?next=%2Fmeldungen.html");
  await api.sync();
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/meldungen.html" }]);
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]); // sonst keine Anfrage
});

test("läuft die Sitzung beim Blättern ab, geht es zum Login und von dort zurück zu den Meldungen", async ({ page, api }) => {
  api.stub({ [LIST]: (call) => (call.query.offset === "20" ? NICHT_ANGEMELDET : seite(call)), [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await mehrLaden(page).click(); // bis hierher ist die Sitzung abgelaufen

  await expect(page).toHaveURL("/auth/login?next=%2Fmeldungen.html");
  await api.sync();
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/meldungen.html" }]);
});

// ---------- Rollen ----------

test("ohne Adminrecht ist die ganze Seite nutzbar — ohne Admin-Links und ohne eine einzige Admin-Anfrage", async ({ page, api }) => {
  await oeffne(page);
  const links = page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link");
  await expect(links).toHaveText(["Meine Abos", "Meldungen"]);
  await expect(links.nth(0)).toHaveCSS("font-weight", "400");
  await expect(links.nth(1)).toHaveCSS("font-weight", "600"); // die aktuelle Seite ist hervorgehoben

  await filter(page).selectOption("netz");
  await expect(zaehler(page)).toHaveText("20 von 25");
  await mehrLaden(page).click();
  await expect(zaehler(page)).toHaveText("25 von 25");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, LIST, LIST, LIST]);
});

test("ein Admin bekommt dieselbe Seite — nur die Navigation führt zusätzlich in die Admin-Bereiche", async ({ page, api }) => {
  api.stub(ME, { json: admin() });
  await oeffne(page);

  const ziele = {
    "Meine Abos": "/abos.html", Meldungen: "/meldungen.html", Versand: "/versand.html",
    Empfänger: "/empfaenger.html", Verteiler: "/verteiler.html", Rollen: "/rollen.html",
  };
  const links = page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link");
  await expect(links).toHaveText(Object.keys(ziele));
  for (const [name, href] of Object.entries(ziele)) {
    await expect(links.filter({ hasText: name })).toHaveAttribute("href", href);
  }
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, LIST]);
});

// ---------- Tastatur und Fokus ----------

test("Tastatur: nach „Mehr laden“ liegt der Fokus wieder auf dem Knopf — das nächste Enter holt die nächste Seite", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await zweite.answer();
    return seite(call);
  });
  await oeffne(page);
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter");
  await expect(mehrLaden(page)).toBeDisabled();
  await expect(mehrLaden(page)).not.toBeFocused(); // einem gesperrten Knopf nimmt der Browser den Fokus
  zweite.release();
  await expect(zaehler(page)).toHaveText("40 von 45");

  await expect(mehrLaden(page)).toBeFocused(); // sonst müsste man ihn mit Tab neu suchen
  await page.keyboard.press("Enter");
  await expect(zaehler(page)).toHaveText("45 von 45");
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(40)]);
});

test("Tastatur: auch nach einem gescheiterten Nachladen liegt der Fokus wieder auf dem Knopf — Enter versucht es erneut", async ({ page, api }) => {
  const zweite = hold();
  let versuche = 0; // nur der erste Griff nach Seite 2 hängt — und endet am Proxy
  api.stub(LIST, (call) => (call.query.offset === "20" && ++versuche === 1 ? zweite.answer() : seite(call)));
  await oeffne(page);
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter");
  await expect(mehrLaden(page)).not.toBeFocused(); // gesperrt: Der Fokus liegt jetzt auf der Seite
  zweite.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });

  await expect(mehrLaden(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(zaehler(page)).toHaveText("40 von 45");
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(20)]);
});

test("Tastatur: auch nach dem Neuladen von vorn liegt der Fokus wieder auf dem Knopf — das nächste Enter holt die zweite Seite", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  const vonVorn = hold();
  api.stub(LIST, async (call) => {
    if (archiv.length > ARCHIV.length && call.query.offset === "0") await vonVorn.answer(); // die neue erste Seite lässt auf sich warten
    return seite(call, archiv);
  });
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter"); // Seite 2 nennt 46 statt 45 → von vorn
  await expect(page.locator("body")).toBeFocused(); // gesperrt: Der Fokus liegt jetzt auf der Seite
  vonVorn.release();
  await expect(zaehler(page)).toHaveText("20 von 46");

  await expect(mehrLaden(page)).toBeFocused(); // die Liste ist ersetzt, der Knopf derselbe
  await page.keyboard.press("Enter");
  await expect(zaehler(page)).toHaveText("40 von 46");
  await api.sync();
  expect(anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0), anfrage(20)]);
});

test("wer während des Ladens zum Filter weitergeht, behält dort den Fokus — der Knopf holt ihn nicht zurück", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await zweite.answer();
    return seite(call);
  });
  await oeffne(page);
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter");
  await expect(mehrLaden(page)).toBeDisabled();
  await filter(page).focus(); // weiter zum Filter, während Seite 2 noch lädt
  zweite.release();
  await expect(zaehler(page)).toHaveText("40 von 45");

  await expect(filter(page)).toBeFocused(); // sonst träfe die nächste Pfeiltaste nicht mehr den Filter
});

test("Tastatur: mit der letzten Seite verschwindet „Mehr laden“ — der Fokus fällt auf die Seite, nicht auf einen versteckten Knopf", async ({ page, api }) => {
  const letzte = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await letzte.answer();
    return seite(call, meldungen(25, 1));
  });
  await oeffne(page, "20 von 25");
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toBeFocused(); // gesperrt: Der Fokus liegt jetzt auf der Seite
  letzte.release();

  await expect(zaehler(page)).toHaveText("25 von 25");
  await expect(mehrLaden(page)).toBeHidden();
  await expect(page.locator("body")).toBeFocused(); // und bleibt dort: Es gibt keinen Knopf mehr, der ihn zurückbekäme
});

test("nach „Mehr laden“ bleibt die Seite stehen, wo gelesen wird: Die erste neue Meldung ist im Blick, der Knopf wandert samt Fokus nach unten", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await zweite.answer();
    return seite(call);
  });
  await oeffne(page);
  await mehrLaden(page).click(); // Playwright rollt den Knopf dafür ins Fenster — wie ein Leser am Ende der Liste
  await expect(page.locator("body")).toBeFocused(); // der Klick gab dem Knopf den Fokus, die Sperre nimmt ihn wieder
  zweite.release();
  await expect(zaehler(page)).toHaveText("40 von 45");

  await expect(mehrLaden(page)).toBeFocused();
  // Der Fokus kommt ohne Bildlauf zurück: Sonst spränge das Fenster an den 20 neuen Karten vorbei zum Knopf.
  await expect(page.getByRole("heading", { name: "Meldung 25", exact: true })).toBeInViewport();
  await expect(mehrLaden(page)).not.toBeInViewport();
});

test("nach dem Neuladen von vorn steht das Fenster wieder am Seitenanfang: Die neue Meldung und der Zähler sind im Blick", async ({ page, api }) => {
  const archiv = [...ARCHIV];
  const vonVorn = hold();
  api.stub(LIST, async (call) => {
    if (archiv.length > ARCHIV.length && call.query.offset === "0") await vonVorn.answer(); // die neue erste Seite lässt auf sich warten
    return seite(call, archiv);
  });
  await oeffne(page);
  archiv.unshift(meldung({ id: 46, subject: "Meldung 46" })); // inzwischen versendet
  await mehrLaden(page).click(); // Playwright rollt den Knopf dafür ins Fenster — wie ein Leser am Ende der Liste
  await expect.poll(() => anfragen(api)).toEqual([anfrage(0), anfrage(20), anfrage(0)]); // das Neuladen ist unterwegs
  await expect(page.locator("body")).toBeFocused(); // die Sperre hat dem Knopf den Fokus genommen
  await expect(mehrLaden(page)).toBeInViewport(); // bis die Antwort da ist, bewegt sich nichts
  vonVorn.release();
  await expect(zaehler(page)).toHaveText("20 von 46");

  // Die Liste hat neu begonnen. Bliebe das Fenster unten stehen, läse man dort schon gelesene Karten:
  // ohne die neue Meldung und ohne den Zähler sähe der Klick aus, als wäre nichts geschehen.
  await expect(page.getByRole("heading", { name: "Meldung 46", exact: true })).toBeInViewport();
  await expect(zaehler(page)).toBeInViewport();
  await expect(mehrLaden(page)).toBeFocused(); // der Fokus kam zurück, ohne das Fenster wieder nach unten zu ziehen
});

test("wer „Mehr laden“ nicht benutzt hat, bekommt dessen Fokus nicht aufgedrängt: Nach dem Öffnen liegt er auf der Seite", async ({ page }) => {
  await oeffne(page);

  await expect(mehrLaden(page)).toBeVisible();
  await expect(page.locator("body")).toBeFocused(); // Tab beginnt oben, die Leertaste blättert
});

test("Race: die verspätete Antwort eines überholten „Mehr laden“ holt den Fokus nicht mehr auf den Knopf", async ({ page, api }) => {
  const zweite = hold();
  api.stub(LIST, async (call) => {
    if (call.query.offset === "20") await zweite.answer(); // Seite 2 von „Alle Verteiler“ bleibt aus
    return seite(call);
  });
  await oeffne(page);
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toBeFocused(); // gesperrt: Der Fokus liegt jetzt auf der Seite
  await filter(page).selectOption("netz"); // der Filterwechsel überholt das Nachladen
  await expect(zaehler(page)).toHaveText("20 von 25");
  await expect(mehrLaden(page)).toBeEnabled(); // der Knopf der neuen Liste nähme den Fokus an

  zweite.release();
  await api.sync();
  await expect(page.locator("body")).toBeFocused();
});
