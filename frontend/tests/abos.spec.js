/* abos.html + abos.js: Selbstbedienung — die eigenen Abos je Verteiler ein- und ausschalten. */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const { me, admin, topic, fehler, NICHT_ANGEMELDET, LOGIN_STUB, GATEWAY, KEINE_VERBINDUNG, XSS } = require("./daten");

const ME = "GET /api/v1/me";
const TOPICS = "GET /api/v1/topics";
const ABONNIEREN = "PUT /api/v1/me/subscriptions/sap";
const ABBESTELLEN = "DELETE /api/v1/me/subscriptions/netz";
// Die Gegenrichtung braucht nur, wer denselben Schalter zweimal umlegt — und stubbt sie dann in seinem Test.
const SAP_ABBESTELLEN = "DELETE /api/v1/me/subscriptions/sap";
const NETZ_ABONNIEREN = "PUT /api/v1/me/subscriptions/netz";
const LOGIN = "GET /auth/login";
// Wie die API sortiert: Pflicht-Verteiler zuerst, danach nach Namen.
const PFLICHT = topic({ id: "notfall", name: "Notfallinfos", description: "Gehen an alle", is_mandatory: true, subscribed: true });
const NETZ = topic({ id: "netz", name: "Netzwerk", description: null, subscribed: true });
const SAP = topic(); // frei wählbar, noch nicht abonniert
// Eine Liste, die nicht auf den Bildschirm passt — für alles, was mit Scrollen zu tun hat.
const VIELE = Array.from({ length: 40 }, (_, i) => topic({ id: "v" + (i + 1), name: "Verteiler " + String(i + 1).padStart(2, "0") }));
const ERSTEN_ABONNIEREN = "PUT /api/v1/me/subscriptions/v1";

test.beforeEach(async ({ api }) => {
  // Nur die beiden richtigen Änderungen haben einen Stub: Ein PUT auf „netz“ oder ein DELETE
  // auf „sap“ wäre die falsche Anfrage — und ließe den Test als „kein Stub“ scheitern.
  api.stub({
    [ME]: { json: me() },
    [TOPICS]: { json: [PFLICHT, NETZ, SAP] },
    [ABONNIEREN]: { status: 204 },
    [ABBESTELLEN]: { status: 204 },
  });
});

/** Seite öffnen und abwarten, was init() als Letztes zeichnet: die Liste bis zur letzten Karte —
 *  oder das, was an ihrer Stelle steht (Leer-Hinweis, Fehlerkarte). */
async function oeffne(page, zuletzt = SAP.name) {
  await page.goto("/abos.html");
  await expect(page.locator("#topic-list")).toContainText(zuletzt);
}

/** Die Karte eines Verteilers, gefunden über seinen Namen. */
const karte = (page, verteiler) => page.locator("#topic-list .topic-card").filter({ hasText: verteiler.name });

/** Der Schalter eines frei wählbaren Verteilers — unter dem Namen, den auch ein Screenreader vorliest. */
const schalter = (page, verteiler) => page.getByRole("checkbox", { name: "Abonnement " + verteiler.name });

/** Was man vom Schalter SIEHT: Die Checkbox selbst ist durchsichtig, Stand und Fokus zeigt die Schiene dahinter. */
const schiene = (page, verteiler) => karte(page, verteiler).locator(".toggle-track");

/** Merkt sich für den NÄCHSTEN Tastendruck, der bei der Seite ankommt, ob sie ihm die Wirkung genommen hat
 *  (preventDefault) — der Browser blättert dann nicht. Erst aufrufen, dann drücken, dann das Ergebnis abholen. */
async function merkeNaechsteTaste(page) {
  await page.evaluate(() => {
    window.naechsteTaste = new Promise((fertig) => {
      window.addEventListener("keydown", (event) => fertig(event.defaultPrevented), { once: true });
    });
  });
  return () => page.evaluate(() => window.naechsteTaste);
}

/** Den Schalter mit der Leertaste umlegen und abwarten, bis seine Sperre ihm den Fokus genommen hat. Der Browser
 *  zieht ihn erst einen Moment NACH dem Sperren ab. Käme die Antwort der API vorher, behielte der Schalter den Fokus
 *  von allein — und „der Fokus ist wieder da“ bewiese nichts über die Seite. Die Anfrage muss also zurückgehalten sein. */
async function schalteMitLeertaste(page, verteiler) {
  await schalter(page, verteiler).focus();
  await page.keyboard.press("Space");
  await expect(schalter(page, verteiler)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
}

test("ein Pflicht-Verteiler trägt die Marke „Pflicht“, steht fest auf „Aktiv“ und hat keinen Schalter", async ({ page }) => {
  await oeffne(page);
  const pflicht = karte(page, PFLICHT);
  const fest = pflicht.getByTitle("Pflicht-Verteiler — nicht abwählbar"); // der Tooltip erklärt, warum hier kein Schalter ist

  await expect(pflicht.getByText("Pflicht", { exact: true })).toBeVisible();
  await expect(fest).toHaveText("Aktiv");
  await expect(fest.locator("svg")).toBeVisible(); // das Schloss davor
  await expect(pflicht.getByRole("checkbox")).toHaveCount(0);
  // … und nur er: Die frei wählbaren Verteiler tragen weder Marke noch Schloss.
  await expect(page.getByText("Pflicht", { exact: true })).toHaveCount(1);
  await expect(page.getByTitle("Pflicht-Verteiler — nicht abwählbar")).toHaveCount(1);
});

test("ein Pflicht-Verteiler bekommt auch dann keinen Schalter, wenn die API ihn nicht als abonniert meldet", async ({ page, api }) => {
  // Pflicht-Verteiler gelten ohne Abo-Zeile für alle (ADR-0009): Allein is_mandatory entscheidet, nicht subscribed.
  api.stub(TOPICS, { json: [topic({ is_mandatory: true, subscribed: false })] });
  await oeffne(page);

  await expect(page.getByTitle("Pflicht-Verteiler — nicht abwählbar")).toHaveText("Aktiv");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("die Karte eines Pflicht-Verteilers ist grau hinterlegt, die der frei wählbaren weiß", async ({ page }) => {
  await oeffne(page);

  // app.css: .topic-card.mandatory liegt auf --surface-muted (#f7f8fa), jede andere Karte auf --surface (#ffffff).
  await expect(karte(page, PFLICHT)).toHaveCSS("background-color", "rgb(247, 248, 250)");
  await expect(karte(page, NETZ)).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(karte(page, SAP)).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("frei wählbare Verteiler haben einen Schalter, der den Abo-Stand zeigt", async ({ page }) => {
  await oeffne(page);

  await expect(schalter(page, NETZ)).toBeChecked();
  await expect(schalter(page, SAP)).not.toBeChecked();
  await expect(schalter(page, SAP)).toBeEnabled();
  await expect(page.getByRole("checkbox")).toHaveCount(2); // der Pflicht-Verteiler hat keinen
  // … und zwar sichtbar: Abonniert ist die Schiene blau (app.css: --accent-toggle #2563eb), sonst grau (#cfd6df).
  await expect(schiene(page, NETZ)).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(schiene(page, SAP)).toHaveCSS("background-color", "rgb(207, 214, 223)");
});

test("jede Karte nennt Name und Beschreibung — ohne Beschreibung bleibt die Zeile leer", async ({ page }) => {
  await oeffne(page);

  await expect(page.locator("#topic-list .topic-title")).toHaveText(["Notfallinfos Pflicht", "Netzwerk", "SAP Produktion"]);
  // „Netzwerk“ hat keine Beschreibung (null): dort steht nichts — auch nicht „null“.
  await expect(page.locator("#topic-list .topic-desc")).toHaveText(["Gehen an alle", "", "Störungen im SAP"]);
});

test("die Karten stehen in der Reihenfolge der API — die Seite sortiert nicht selbst", async ({ page, api }) => {
  // Bewusst ungeordnet: der Pflicht-Verteiler in der Mitte, Namen und IDs weder auf- noch absteigend.
  // So fällt jede eigene Sortierung der Seite auf — auch „Pflicht zuerst, dann nach Namen“, wie die API es heute tut.
  const mail = topic({ id: "mail", name: "Mail" });
  const zeit = topic({ id: "zeit", name: "Zeiterfassung", is_mandatory: true, subscribed: true });
  const ad = topic({ id: "ad", name: "Active Directory" });
  api.stub(TOPICS, { json: [mail, zeit, ad] });
  await oeffne(page, ad.name);

  await expect(page.locator("#topic-list .topic-title")).toHaveText(["Mail", "Zeiterfassung Pflicht", "Active Directory"]);
});

test("bis die Verteiler da sind, steht die Ladeanzeige — danach ist sie verschwunden", async ({ page, api }) => {
  const topics = hold();
  api.stub(TOPICS, topics.answer);
  await page.goto("/abos.html");
  await expect(page.locator("#user-chip")).toHaveText("erika@example.org"); // /me ist beantwortet, /topics steht aus
  await expect(page.locator("#topic-list")).toHaveText("Lade deine Abonnements …");

  topics.release({ json: [SAP] });
  await expect(schalter(page, SAP)).toBeVisible();
  await expect(page.getByText("Lade deine Abonnements …")).toBeHidden();
});

test("die Liste ist eine Live-Region: ein Screenreader sagt an, wenn statt der Ladeanzeige die Verteiler dastehen", async ({ page }) => {
  await oeffne(page);

  await expect(page.locator("#topic-list")).toHaveAttribute("aria-live", "polite");
});

test("gibt es keine Verteiler, steht dort ein Hinweis statt einer leeren Seite", async ({ page, api }) => {
  api.stub(TOPICS, { json: [] });
  await oeffne(page, "Derzeit sind keine Verteiler verfügbar.");

  await expect(page.locator("#topic-list")).toHaveText("Derzeit sind keine Verteiler verfügbar."); // nichts sonst, keine Ladeanzeige
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator("#toast")).toHaveCount(0); // eine leere Liste ist kein Fehler
});

test("in der Navigation ist „Meine Abos“ als aktuelle Seite hervorgehoben", async ({ page }) => {
  await oeffne(page);

  await expect(page.getByRole("link", { name: "Meine Abos" })).toHaveCSS("font-weight", "600");
  await expect(page.getByRole("link", { name: "Meldungen" })).toHaveCSS("font-weight", "400");
});

test("zum Laden fragt die Seite genau zweimal an — erst das Konto, dann die Verteiler, beides ohne Query", async ({ page, api }) => {
  await oeffne(page);
  await api.sync();

  expect(api.calls().map((call) => [call.key, call.query])).toEqual([[ME, {}], [TOPICS, {}]]);
});

test("Einschalten sendet PUT auf den Verteiler — ohne Body, mit CSRF-Header — und meldet „Abonniert: …“", async ({ page, api }) => {
  await oeffne(page);
  await schalter(page, SAP).click();

  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(schalter(page, SAP)).toBeChecked();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN]); // genau EINE Änderung, keine Admin-Route
  const [put] = api.calls(ABONNIEREN);
  expect(put.json).toBeNull();
  expect(put.query).toEqual({});
  expect(put.headers["x-requested-with"]).toBe("fetch"); // ohne ihn lehnt die API jede Änderung ab (403 CSRF)
});

test("Abschalten sendet DELETE auf den Verteiler — ohne Body, mit CSRF-Header — und meldet „Abbestellt: …“", async ({ page, api }) => {
  await oeffne(page);
  await schalter(page, NETZ).click();

  await expectToast(page, "Abbestellt: Netzwerk");
  await expect(schalter(page, NETZ)).not.toBeChecked();
  await expect(schalter(page, NETZ)).toBeEnabled(); // wer es sich anders überlegt, kann gleich wieder abonnieren
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN]);
  const [del] = api.calls(ABBESTELLEN);
  expect(del.json).toBeNull();
  expect(del.query).toEqual({});
  expect(del.headers["x-requested-with"]).toBe("fetch");
});

test("eine Verteiler-ID mit Sonderzeichen wird im Pfad kodiert", async ({ page, api }) => {
  // Unkodiert träfe „/“ eine andere Route, „?“ und „#“ schnitten die ID ab, „%“ wäre kaputtes Escaping.
  const KODIERT = "PUT /api/v1/me/subscriptions/a%2Fb%3Fc%23d%20%26%20100%25%20%C3%A4";
  api.stub({ [TOPICS]: { json: [topic({ id: "a/b?c#d & 100% ä" })] }, [KODIERT]: { status: 204 } });
  await oeffne(page);
  await schalter(page, SAP).click();

  await expectToast(page, "Abonniert: SAP Produktion");
  await api.sync();
  expect(api.calls(KODIERT).map((call) => call.query)).toEqual([{}]); // nichts ist in die Query gerutscht
});

test("Tastatur: Tab erreicht den Schalter, die Leertaste sendet dieselbe Anfrage wie ein Klick", async ({ page, api }) => {
  await oeffne(page);
  await page.getByRole("link", { name: "Abmelden" }).focus(); // letzter Halt der Kopfzeile
  await page.keyboard.press("Tab");
  await expect(schalter(page, NETZ)).toBeFocused();
  await expect(schiene(page, NETZ)).not.toHaveCSS("box-shadow", "none"); // der Fokusring zeigt, wo man steht
  await expect(schiene(page, SAP)).toHaveCSS("box-shadow", "none");

  await page.keyboard.press("Space");
  await expectToast(page, "Abbestellt: Netzwerk");
  await expect(schalter(page, NETZ)).not.toBeChecked();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN]);
});

test("solange die Anfrage läuft, ist der Schalter gesperrt und abgeblendet — ein Doppelklick sendet nur EINE Anfrage", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  const sap = schalter(page, SAP);

  await sap.dblclick(); // der zweite Klick trifft den schon gesperrten Schalter
  await expect(sap).toBeDisabled();
  await expect(schiene(page, SAP)).toHaveCSS("opacity", "0.55"); // man sieht, warum der zweite Klick nichts tut
  await expect(sap).toBeChecked(); // zeigt schon den gewünschten Stand
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN]); // kein DELETE hinterher

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeEnabled();
  await expect(schiene(page, SAP)).toHaveCSS("opacity", "1");
  await expect(sap).toBeChecked();
});

test("auch beim Abschalten ist der Schalter gesperrt, solange die Anfrage läuft — und danach wieder frei", async ({ page, api }) => {
  const del = hold();
  api.stub(ABBESTELLEN, del.answer);
  await oeffne(page);
  const netz = schalter(page, NETZ);

  await netz.dblclick(); // der zweite Klick trifft den schon gesperrten Schalter
  await expect(netz).toBeDisabled();
  await expect(netz).not.toBeChecked(); // zeigt schon den gewünschten Stand
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN]); // kein PUT hinterher

  del.release({ status: 204 });
  await expectToast(page, "Abbestellt: Netzwerk");
  await expect(netz).toBeEnabled();
  await expect(netz).not.toBeChecked();
});

test("die Erfolgsmeldung erscheint erst mit der Antwort der API — nicht schon beim Klick", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await schalter(page, SAP).click();
  await expect(schalter(page, SAP)).toBeDisabled(); // die Anfrage läuft
  await expect(page.locator("#toast")).toHaveCount(0); // noch ist nichts bestätigt

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion");
});

test("nach der Antwort ist der Schalter wieder frei: gleich wieder ausschalten sendet DELETE", async ({ page, api }) => {
  api.stub(SAP_ABBESTELLEN, { status: 204 });
  await oeffne(page);
  const sap = schalter(page, SAP);
  await sap.click();
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeEnabled();

  await sap.click();
  await expectToast(page, "Abbestellt: SAP Produktion");
  await expect(sap).not.toBeChecked();
  await api.sync();
  // Die Richtung folgt dem Schalter von JETZT, nicht dem Stand beim Laden der Seite.
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN, SAP_ABBESTELLEN]);
});

test("Einschalten scheitert (409): der Schalter springt zurück auf AUS, der Text der API steht im Fehler-Toast", async ({ page, api }) => {
  const grund = "„SAP Produktion“ ist ein Pflicht-Verteiler — er gilt automatisch für alle aktiven Empfänger";
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  const sap = schalter(page, SAP);
  await sap.click();
  await expect(sap).toBeChecked(); // vorläufig AN — die Antwort steht noch aus

  put.release(fehler(409, "TOPIC_MANDATORY", grund));
  await expectToast(page, grund, { error: true });
  await expect(sap).not.toBeChecked();
  await expect(sap).toBeEnabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN]); // der Rücksprung sendet nichts
});

test("Abschalten scheitert (500): der Schalter springt zurück auf AN, der Text der API steht im Fehler-Toast", async ({ page, api }) => {
  const del = hold();
  api.stub(ABBESTELLEN, del.answer);
  await oeffne(page);
  const netz = schalter(page, NETZ);
  await netz.click();
  await expect(netz).not.toBeChecked(); // vorläufig AUS — die Antwort steht noch aus

  del.release(fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(netz).toBeChecked();
  await expect(netz).toBeEnabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN]);
});

// Die beiden nächsten Tests legen denselben Schalter zweimal um. Erst dann unterscheidet sich der Stand VOR dem Klick
// vom Stand beim Laden der Seite — und nur dann fällt ein Rücksprung auf den falschen der beiden auf.
test("erst eingeschaltet, dann scheitert das Abschalten: der Schalter springt zurück auf AN — nicht auf den Stand beim Laden", async ({ page, api }) => {
  const del = hold();
  api.stub(SAP_ABBESTELLEN, del.answer);
  await oeffne(page);
  const sap = schalter(page, SAP); // beim Laden AUS
  await sap.click();
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeEnabled();
  await sap.click();
  await expect(sap).not.toBeChecked(); // vorläufig AUS — die Antwort steht noch aus

  del.release(fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(sap).toBeChecked(); // das Abo besteht weiter — so muss es auch dastehen
  await expect(sap).toBeEnabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN, SAP_ABBESTELLEN]);
});

test("erst abgeschaltet, dann scheitert das Einschalten: der Schalter springt zurück auf AUS — nicht auf den Stand beim Laden", async ({ page, api }) => {
  const put = hold();
  api.stub(NETZ_ABONNIEREN, put.answer);
  await oeffne(page);
  const netz = schalter(page, NETZ); // beim Laden AN
  await netz.click();
  await expectToast(page, "Abbestellt: Netzwerk");
  await expect(netz).toBeEnabled();
  await netz.click();
  await expect(netz).toBeChecked(); // vorläufig AN — die Antwort steht noch aus

  put.release(fehler(404, "TOPIC_NOT_FOUND", "Topic 'netz' existiert nicht")); // inzwischen deaktiviert
  await expectToast(page, "Topic 'netz' existiert nicht", { error: true });
  await expect(netz).not.toBeChecked(); // abbestellt ist abbestellt — wer AN läse, wartete vergeblich auf Störungsmails
  await expect(netz).toBeEnabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN, NETZ_ABONNIEREN]);
});

test("nach einem Fehler lässt sich derselbe Schalter erneut bedienen", async ({ page, api }) => {
  const antworten = [fehler(500, "INTERNAL", "Datenbank nicht erreichbar"), { status: 204 }];
  api.stub(ABONNIEREN, () => antworten.shift()); // erst der Fehler, beim zweiten Versuch klappt es
  await oeffne(page);
  const sap = schalter(page, SAP);
  await sap.click();
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(sap).toBeEnabled();

  await sap.click();
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeChecked();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN, ABONNIEREN]); // wieder ein PUT
});

test("Netz weg beim Umschalten: der Schalter springt zurück und bleibt bedienbar, der Toast nennt den Verbindungsfehler", async ({ page, api }) => {
  api.stub(ABONNIEREN, { abort: true });
  await oeffne(page);
  const sap = schalter(page, SAP);
  await sap.click();

  await expectToast(page, KEINE_VERBINDUNG, { error: true });
  await expect(sap).not.toBeChecked();
  await expect(sap).toBeEnabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN]); // ein Versuch — kein stilles Wiederholen
});

test("zwei Schalter gleichzeitig unterwegs: jede Antwort trifft nur ihren eigenen Schalter", async ({ page, api }) => {
  const an = hold();
  const aus = hold();
  api.stub({ [ABONNIEREN]: an.answer, [ABBESTELLEN]: aus.answer });
  await oeffne(page);
  const sap = schalter(page, SAP);
  const netz = schalter(page, NETZ);
  await sap.click();
  await netz.click();

  // Die spätere Anfrage wird zuerst beantwortet — und scheitert: Nur „Netzwerk“ springt zurück.
  aus.release(fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(netz).toBeChecked();
  await expect(netz).toBeEnabled();
  await expect(sap).toBeChecked();
  await expect(sap).toBeDisabled(); // wartet weiter auf seine eigene Antwort

  an.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeEnabled();
  await expect(sap).toBeChecked();
  await expect(netz).toBeChecked();
});

// Tastaturfokus. Solange die Anfrage läuft, ist der Schalter gesperrt (disabled) — und einem gesperrten Feld nimmt der
// Browser den Fokus: Er fällt auf <body>. Mit der Antwort gibt abos.js ihn zurück — nur dem zuletzt bedienten Schalter,
// nur wenn der Fokus noch auf <body> liegt; nach einem Mausklick ohne die Seite zu bewegen, nach der Tastatur mit
// Bildlauf zum Schalter. Die Tests halten die Antwort zurück, bis der Fokus wirklich weg ist.
test("Tastatur: nach dem Umschalten liegt der Fokus wieder auf dem Schalter — eine zweite Leertaste schaltet zurück", async ({ page, api }) => {
  const put = hold();
  api.stub({ [ABONNIEREN]: put.answer, [SAP_ABBESTELLEN]: { status: 204 } });
  await oeffne(page);
  const sap = schalter(page, SAP);
  await schalteMitLeertaste(page, SAP);

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeFocused();
  await expect(schiene(page, SAP)).not.toHaveCSS("box-shadow", "none"); // der Fokusring zeigt wieder, wo man steht
  await page.keyboard.press("Space"); // „doch nicht“
  await expectToast(page, "Abbestellt: SAP Produktion");
  await expect(sap).not.toBeChecked();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN, SAP_ABBESTELLEN]);
});

test("Tastatur: auch nach einem gescheiterten Umschalten liegt der Fokus wieder auf dem Schalter — die Leertaste versucht es erneut", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  const sap = schalter(page, SAP);
  await schalteMitLeertaste(page, SAP);

  put.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(sap).not.toBeChecked(); // zurückgesprungen …
  await expect(sap).toBeFocused(); // … und der Fokus steht bereit: kein Weg zurück mit Tab nötig
  api.stub(ABONNIEREN, { status: 204 }); // das Backend ist wieder da
  await page.keyboard.press("Space");
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeChecked();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN, ABONNIEREN]);
});

test("Tastatur: wer inzwischen zum nächsten Schalter weitergegangen ist, behält dort den Fokus — die Leertaste gilt diesem Verteiler", async ({ page, api }) => {
  const del = hold();
  api.stub(ABBESTELLEN, del.answer);
  await oeffne(page);
  await schalteMitLeertaste(page, NETZ);
  await page.keyboard.press("Tab"); // weiter, während „Netzwerk“ noch gespeichert wird
  await expect(schalter(page, SAP)).toBeFocused();

  del.release({ status: 204 });
  await expectToast(page, "Abbestellt: Netzwerk");
  await expect(schalter(page, NETZ)).toBeEnabled();
  await expect(schalter(page, SAP)).toBeFocused(); // nicht zurück auf „Netzwerk“ gesprungen
  await page.keyboard.press("Space"); // spränge der Fokus zurück, wäre „Netzwerk“ gleich wieder abonniert
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(schalter(page, NETZ)).not.toBeChecked();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN, ABONNIEREN]);
});

test("Tastatur: laufen zwei Umschaltungen zugleich, bekommt nur der zuletzt bediente Schalter den Fokus zurück", async ({ page, api }) => {
  const aus = hold();
  const an = hold();
  api.stub({ [ABBESTELLEN]: aus.answer, [ABONNIEREN]: an.answer, [SAP_ABBESTELLEN]: { status: 204 } });
  await oeffne(page);
  await schalteMitLeertaste(page, NETZ); // „Netzwerk“ abbestellen …
  await schalteMitLeertaste(page, SAP); // … und gleich weiter: „SAP Produktion“ abonnieren

  aus.release({ status: 204 }); // die ältere Antwort kommt zuerst
  await expectToast(page, "Abbestellt: Netzwerk");
  await expect(schalter(page, NETZ)).toBeEnabled();
  await expect(page.locator("body")).toBeFocused(); // nicht auf „Netzwerk“ gesprungen — der Nutzer war längst weiter
  an.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(schalter(page, SAP)).toBeFocused();
  await page.keyboard.press("Space"); // „doch nicht“ trifft den Verteiler, der zuletzt bedient wurde
  await expectToast(page, "Abbestellt: SAP Produktion");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABBESTELLEN, ABONNIEREN, SAP_ABBESTELLEN]);
});

test("ein Schalter, der beim Umschalten den Fokus nicht hatte, zieht ihn auch mit der Antwort nicht an sich", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  const sap = schalter(page, SAP);
  await sap.dispatchEvent("click"); // ein Klick, der umschaltet, ohne dem Schalter den Fokus zu geben
  await expect(sap).toBeDisabled();

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(sap).toBeEnabled();
  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("Space"); // läge der Fokus jetzt auf dem Schalter, wäre das Abo gleich wieder weg
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN]);
  await expect(sap).toBeChecked();
});

test("Maus: wer nach dem Klick weitergescrollt hat, bleibt dort — die Antwort holt die Seite nicht zum Schalter zurück", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: VIELE }, [ERSTEN_ABONNIEREN]: put.answer });
  await oeffne(page, "Verteiler 40");
  const erster = schalter(page, VIELE[0]);
  await erster.click();
  await expect(page.locator("body")).toBeFocused(); // gesperrt — auch der Fokus eines Mausklicks ist weg
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // ans Ende der Liste, ohne Animation
  await expect(erster).not.toBeInViewport();

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: Verteiler 01");
  await expect(erster).toBeFocused(); // der Fokus ist zurück …
  await expect(erster).not.toBeInViewport(); // … die Seite aber steht, wo der Nutzer sie hingeschoben hat
});

test("Tastatur: steht die Seite bei der Antwort woanders, holt der Fokus den Schalter zurück ins Bild", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: VIELE }, [ERSTEN_ABONNIEREN]: put.answer });
  await oeffne(page, "Verteiler 40");
  const erster = schalter(page, VIELE[0]);
  await schalteMitLeertaste(page, VIELE[0]);
  // Der Nutzer hat inzwischen weitergeblättert (Bild-ab-Taste, Mausrad). Hier ohne Animation: Fiele die Antwort
  // mitten in einen laufenden Bildlauf, liefe der über das Zurückholen hinweg.
  await page.evaluate(() => window.scrollTo(0, 630));
  await expect(erster).not.toBeInViewport();

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: Verteiler 01");
  await expect(erster).toBeFocused();
  await expect(erster).toBeInViewport(); // sonst träfe die nächste Leertaste einen Schalter, den man nicht sieht
});

// Die Kopfzeile ist 63 px hoch — für Admins in mittelbreiten Fenstern 85 px, weil ihre Navigation dort umbricht.
const KOPFZEILEN = [
  ["einzeilig", me(), 1280, 35],
  ["zweizeilig (Admin, Fenster 900 px breit)", admin(), 900, 55],
];
for (const [fall, konto, breite, abstand] of KOPFZEILEN) {
  test(`Tastatur: ein Schalter, der hinter der klebenden Kopfzeile liegt, kommt mit dem Fokus darunter hervor — Kopfzeile ${fall}`, async ({ page, api }) => {
    await page.setViewportSize({ width: breite, height: 720 });
    api.stub({ [ME]: { json: konto }, [TOPICS]: { json: VIELE } });
    await oeffne(page, "Verteiler 40");
    const sechster = schalter(page, VIELE[5]);
    // toBeInViewport() wäre auch hinter der Kopfzeile wahr — geprüft wird, was an der Stelle des Schalters zuoberst liegt.
    const zuoberst = () => sechster.evaluate((schalterElement) => {
      const lage = schalterElement.getBoundingClientRect();
      return document.elementFromPoint(lage.left + lage.width / 2, lage.top + lage.height / 2) === schalterElement;
    });
    // So weit geblättert, dass der Schalter knapp unter dem Fensterrand liegt: ganz hinter der Kopfzeile.
    await sechster.evaluate(
      (schalterElement, tiefe) => window.scrollTo(0, window.scrollY + schalterElement.getBoundingClientRect().top - tiefe), abstand);
    expect(await zuoberst()).toBe(false); // verdeckt — für den Browser liegt er trotzdem „im Fenster“

    await sechster.focus(); // wie Umschalt+Tab von weiter unten

    expect(await zuoberst()).toBe(true);
  });
}

test("Tastatur, dann Maus: nach dem Mausklick holt die Antwort die Seite nicht zum Schalter zurück", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: VIELE }, "PUT /api/v1/me/subscriptions/v2": { status: 204 }, [ERSTEN_ABONNIEREN]: put.answer });
  await oeffne(page, "Verteiler 40");
  await schalter(page, VIELE[1]).focus();
  await page.keyboard.press("Space");
  await expectToast(page, "Abonniert: Verteiler 02"); // die Umschaltung per Tastatur ist abgeschlossen

  const erster = schalter(page, VIELE[0]);
  await erster.click(); // jetzt mit der Maus
  await expect(page.locator("body")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(erster).not.toBeInViewport();

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: Verteiler 01");
  await expect(erster).toBeFocused();
  await expect(erster).not.toBeInViewport();
});

test("Tastatur: solange die Anfrage läuft, bewegt eine zweite Leertaste die Seite nicht — und gesendet wird nichts", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: VIELE }, [ERSTEN_ABONNIEREN]: put.answer });
  await oeffne(page, "Verteiler 40");
  const erster = schalter(page, VIELE[0]);
  await schalteMitLeertaste(page, VIELE[0]); // der Fokus liegt jetzt auf <body>

  const verhindert = await merkeNaechsteTaste(page);
  await page.keyboard.press("Space"); // „doch nicht“ — noch bevor die Antwort da ist
  expect(await verhindert()).toBe(true); // sonst blätterte der Browser um eine Bildschirmhöhe weiter, der Schalter wäre aus dem Bild
  await expect(erster).toBeInViewport();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ERSTEN_ABONNIEREN]); // gesendet wurde zu Recht nichts

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: Verteiler 01");
  await expect(erster).toBeFocused();
});

test("Maus: läuft die Anfrage nach einem Mausklick, blättert die Leertaste die Seite wie gewohnt", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: VIELE }, [ERSTEN_ABONNIEREN]: put.answer });
  await oeffne(page, "Verteiler 40");
  await schalter(page, VIELE[0]).click();
  await expect(page.locator("body")).toBeFocused();

  const verhindert = await merkeNaechsteTaste(page);
  await page.keyboard.press("Space");
  expect(await verhindert()).toBe(false);

  put.release({ status: 204 });
  await expectToast(page, "Abonniert: Verteiler 01");
});

test("Tastatur: ist keine Umschaltung mehr unterwegs, blättert die Leertaste auf der Seite wieder", async ({ page }) => {
  await oeffne(page);
  await schalter(page, SAP).focus();
  await page.keyboard.press("Space");
  await expectToast(page, "Abonniert: SAP Produktion"); // die Umschaltung ist abgeschlossen
  await page.getByRole("heading", { level: 1 }).click(); // Klick neben die Schalter: der Fokus liegt auf der Seite
  await expect(page.locator("body")).toBeFocused();

  const verhindert = await merkeNaechsteTaste(page);
  await page.keyboard.press("Space");
  expect(await verhindert()).toBe(false);
});

test("Sitzung läuft beim Umschalten ab (401): Weiterleitung zum Login mit next=/abos.html", async ({ page, api }) => {
  api.stub({ [ABONNIEREN]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await schalter(page, SAP).click();

  await expect(page).toHaveURL("/auth/login?next=%2Fabos.html");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS, ABONNIEREN, LOGIN]); // kein zweiter Versuch
  expect(api.calls(LOGIN)[0].query).toEqual({ next: "/abos.html" });
});

test("Sitzung läuft beim Umschalten ab (401): bis der Login erscheint, steht der Schalter wieder auf dem alten Stand", async ({ page, api }) => {
  // 204 als Antwort des Logins hält den Browser auf der Seite: So bleibt prüfbar, was der Nutzer vor
  // sich hat, bis die Login-Seite erscheint. (Den Login mit hold() zurückzuhalten geht nicht: Solange
  // die Navigation aussteht, bleibt jede Prüfung auf dieser Seite hängen — bis zum Test-Timeout.)
  const put = hold();
  api.stub({ [ABONNIEREN]: put.answer, [LOGIN]: { status: 204 } });
  await oeffne(page);
  const sap = schalter(page, SAP);
  await sap.click();
  await expect(sap).toBeChecked();

  put.release(NICHT_ANGEMELDET);
  await expectToast(page, "Nicht angemeldet — Weiterleitung zum Login", { error: true });
  await expect(sap).not.toBeChecked();
  await expect(sap).toBeEnabled();
});

test("Laden scheitert (/topics 500): Fehlerkarte mit dem Text der API statt ewiger Ladeanzeige", async ({ page, api }) => {
  api.stub(TOPICS, fehler(500, "INTERNAL", "Datenbank nicht erreichbar"));
  await oeffne(page, "Laden fehlgeschlagen");

  await expect(page.getByRole("heading", { name: "Laden fehlgeschlagen" })).toBeVisible();
  await expect(page.locator("#topic-list").getByText("Datenbank nicht erreichbar")).toBeVisible();
  await expect(page.getByText("Lade deine Abonnements …")).toBeHidden();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
});

test("Laden scheitert schon am Konto (/me 500): „Erneut versuchen“ lädt die Seite neu", async ({ page, api }) => {
  const konto = [fehler(500, "INTERNAL", "Datenbank nicht erreichbar"), { json: me() }];
  api.stub(ME, () => konto.shift()); // erst der Fehler, nach dem Neuladen klappt es
  await oeffne(page, "Laden fehlgeschlagen");
  await expect(page.locator("#topic-list").getByText("Datenbank nicht erreichbar")).toBeVisible();

  await page.getByRole("button", { name: "Erneut versuchen (F5)" }).click();

  await expect(schalter(page, SAP)).toBeVisible();
  // Wirklich neu geladen, nicht nur init() wiederholt: Die neue Seite kennt den alten Fehler-Toast nicht.
  await expect(page.locator("#toast")).toHaveCount(0);
  await api.sync();
  expect(api.calls(ME)).toHaveLength(2);
});

test("ohne Sitzung: Weiterleitung zum Login mit next=/abos.html", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/abos.html");

  await expect(page).toHaveURL("/auth/login?next=%2Fabos.html");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]); // sonst keine Anfrage — auch kein /topics
  expect(api.calls(LOGIN)[0].query).toEqual({ next: "/abos.html" });
});

test("Schleifenschutz: kommt nach dem Login-Versuch wieder 401, bleibt die Seite stehen und nennt den Cookie-Hinweis", async ({ page, api }) => {
  const hinweis = "Anmeldung fehlgeschlagen — bitte Cookies zulassen und die Seite neu laden.";
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/abos.html");
  await expect(page).toHaveURL("/auth/login?next=%2Fabos.html");

  await page.goto("/abos.html"); // zurück vom „Login“ — das Cookie fehlt weiterhin
  await expectToast(page, hinweis, { error: true });
  await expect(page.locator("#topic-list").getByText(hinweis)).toBeVisible(); // steht auch in der Fehlerkarte, die bleibt
  await expect(page).toHaveURL("/abos.html");
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1); // kein zweiter Sprung
});

test("XSS: Name und Beschreibung eines Verteilers erscheinen als Text", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ name: XSS, description: "Beschreibung " + XSS })] });
  await oeffne(page, XSS);

  await expect(page.locator("#topic-list .topic-title")).toHaveText(XSS);
  await expect(page.locator("#topic-list .topic-desc")).toHaveText("Beschreibung " + XSS);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: auch der Name des Schalters und die Erfolgsmeldung zeigen den Verteilernamen als Text", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ name: XSS })] });
  await oeffne(page, XSS);
  const einziger = page.getByRole("checkbox");

  await expect(einziger).toHaveAccessibleName("Abonnement " + XSS);
  await einziger.click();
  await expectToast(page, "Abonniert: " + XSS);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: ein Fehlertext der API steht in Fehlerkarte und Toast als Text", async ({ page, api }) => {
  api.stub(TOPICS, fehler(500, "INTERNAL", XSS));
  await oeffne(page, "Laden fehlgeschlagen");

  await expect(page.locator("#topic-list").getByText(XSS, { exact: true })).toBeVisible();
  await expectToast(page, XSS, { error: true });
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});
