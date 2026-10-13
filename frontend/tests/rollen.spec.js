/* rollen.html + rollen.js: das im Portal geführte Adminrecht vergeben und entziehen (ADR-0022). */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const {
  me, admin, user, liste, fehler, NICHT_ANGEMELDET, KEIN_ADMIN, LOGIN_STUB, GATEWAY, ANMELDESEITE, KEINE_API_ANTWORT, XSS,
} = require("./daten");

const ME = "GET /api/v1/me";
const USERS = "GET /api/v1/admin/users";
const LOGIN = "GET /auth/login";
const VERGEBEN = "PUT /api/v1/admin/users/12/admin"; // Max
const ENTZIEHEN = "DELETE /api/v1/admin/users/31/admin"; // Ida
const VERGEBEN_IDA = "PUT /api/v1/admin/users/31/admin";
const ENTZIEHEN_WEG = "DELETE /api/v1/admin/users/40/admin"; // das deaktivierte Konto
const VERGEBEN_WEG = "PUT /api/v1/admin/users/40/admin";
const VERGEBEN_NUTZER_1 = "PUT /api/v1/admin/users/101/admin"; // der erste der geblätterten Empfänger
const VERGEBEN_NUTZER_2 = "PUT /api/v1/admin/users/102/admin"; // … und der zweite

// Die Zeilen des Normalfalls — die API sortiert nach E-Mail.
const ICH = user({ id: 5, email: "admin@example.org", is_admin: true }); // die Zeile des angemeldeten Admins
const IDA = user({ id: 31, email: "ida@example.org", is_admin: true });
const MAX = user({ id: 12, email: "max@example.org" });
const WEG = user({ id: 40, email: "weg@example.org", is_active: false }); // deaktiviert (Offboarding)
const WEG_MIT_RECHT = { ...WEG, is_admin: true }; // … und noch Admin: nur der Entzug ist offen
const ERSTE_SEITE = { query: "", limit: "50", offset: "0" };
// „Mehr laden“ nach 50 Zeilen: die letzte geladene noch einmal (offset 49), dazu die nächsten 50.
const ZWEITE_SEITE = { query: "", limit: "51", offset: "49" };
const ABSAGE = "Diese Seite ist Administratoren vorbehalten.";
const SELBST = "Du kannst dir die Adminrechte nicht selbst entziehen";
const NUR_ENTZUG =
  "Konto ist deaktiviert. Das Adminrecht lässt sich hier entziehen; eine erneute Vergabe erst nach Reaktivierung.";
const KEINE_VERGABE = "Deaktivierte Empfänger können kein Adminrecht erhalten — erst reaktivieren.";
/** 409 der API auf die Vergabe an ein deaktiviertes Konto. */
const inaktiv = (email) => fehler(409, "USER_INACTIVE", email + " ist deaktiviert — bitte zuerst reaktivieren");
const DB_FEHLER = fehler(500, "INTERNAL", "Datenbank nicht erreichbar");

test.beforeEach(async ({ api }) => {
  api.stub({
    [ME]: { json: admin() },
    [USERS]: { json: liste([ICH, IDA, MAX]) },
    [VERGEBEN]: { json: { ...MAX, is_admin: true } },
    [ENTZIEHEN]: { json: { ...IDA, is_admin: false } },
  });
});

/** Seite öffnen und abwarten, was init() als Letztes zeichnet: den Zähler neben dem Filterfeld. */
async function oeffne(page, zaehler = "3 von 3") {
  await page.goto("/rollen.html");
  await expect(page.locator("#result-count")).toHaveText(zaehler);
}

const filterfeld = (page) => page.getByRole("textbox", { name: "Nach E-Mail filtern" });
const mehrLaden = (page) => page.getByRole("button", { name: "Mehr laden" });
const zeilen = (page) => page.locator("#users-body").getByRole("row");
/** Die Tabellenzeile dieser Adresse. */
const zeile = (page, email) => zeilen(page).filter({ hasText: email });
/** Die Checkbox „Adminrecht“ in der Zeile dieser Adresse. */
const recht = (page, email) => page.getByRole("checkbox", { name: "Adminrecht: " + email, exact: true });
/** Was die Seite geändert hat: jede Anfrage, die nicht nur liest. */
const aenderungen = (api) => api.calls().map((call) => call.key).filter((key) => !key.startsWith("GET "));
/** „Es wurde nichts gemeldet“: app.js legt #toast erst mit der ersten Meldung an. Nur dort verwenden, wo der
 *  Test zuvor keinen Toast ausgelöst hat und das, was einen auslösen könnte, sicher verarbeitet ist. */
const keinToast = (page) => expect(page.locator("#toast")).toHaveCount(0);

/** Filtertext eingeben und die Entprellung ablaufen lassen — danach ist die Anfrage unterwegs. */
async function suche(page, text) {
  await filterfeld(page).fill(text);
  await page.clock.runFor(250);
}

/** Die Checkbox mit der Leertaste umschalten und abwarten, bis ihre Sperre ihr den Fokus genommen hat.
 *  Der Browser zieht ihn erst einen Moment NACH dem Sperren ab. Käme die Antwort der API vorher, behielte
 *  die Checkbox den Fokus von allein — und „der Fokus ist wieder da“ bewiese nichts über die Seite. */
async function schalteMitLeertaste(page, email) {
  await recht(page, email).focus();
  await page.keyboard.press("Space");
  await expect(recht(page, email)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
}

/** „Mehr laden“ mit der Eingabetaste auslösen und abwarten, bis die Sperre dem Knopf den Fokus genommen hat —
 *  aus demselben Grund wie bei schalteMitLeertaste. */
async function ladeMehrMitEnter(page) {
  await mehrLaden(page).focus();
  await page.keyboard.press("Enter");
  await expect(mehrLaden(page)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
}

/** `anzahl` Empfänger ab der laufenden Nummer `ab`: nutzer1@example.org, nutzer2@example.org … */
const empfaenger = (ab, anzahl) =>
  Array.from({ length: anzahl }, (_, i) => user({ id: 100 + ab + i, email: "nutzer" + (ab + i) + "@example.org" }));
/** Antwortet wie die API auf eine Liste dieser Konten: ab dem angefragten offset so viele, wie limit verlangt. */
const seiten = (konten) => (call) => {
  const offset = Number(call.query.offset);
  const limit = Number(call.query.limit);
  return { json: liste(konten.slice(offset, offset + limit), konten.length, limit, offset) };
};
/** … auf eine Liste mit `gesamt` Empfängern: nutzer1 bis nutzer<gesamt>. */
const geblaettert = (gesamt) => seiten(empfaenger(1, gesamt));
/** Was diese Liste auf „Mehr laden“ nach 50 geladenen Zeilen antwortet: nutzer50 noch einmal, dann die nächsten. */
const anschluss = (gesamt) => geblaettert(gesamt)({ query: ZWEITE_SEITE });
/** Die Adressen dieser Konten — der Text der Zeilen, wenn die Liste genau sie in dieser Reihenfolge zeigt. */
const adressen = (konten) => konten.map((konto) => konto.email);
const [NUTZER_1, NUTZER_2] = empfaenger(1, 2); // id 101 und 102, siehe VERGEBEN_NUTZER_1 und _2

test("Die Liste zeigt je Empfänger die Adresse und den Stand des Adminrechts", async ({ page }) => {
  await oeffne(page);

  await expect(zeilen(page)).toHaveText(["admin@example.org", "ida@example.org", "max@example.org"]);
  await expect(recht(page, IDA.email)).toBeChecked();
  await expect(recht(page, IDA.email)).toBeEnabled();
  await expect(recht(page, MAX.email)).not.toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
  await expect(mehrLaden(page)).toBeHidden(); // alles geladen — nichts nachzuladen
});

test("Auch deaktivierte Empfänger stehen in der Liste: angefragt wird ohne is_active-Filter", async ({ page, api }) => {
  api.stub(USERS, { json: liste([ICH, WEG]) });
  await oeffne(page, "2 von 2");

  // Mit Filter wäre das Adminrecht eines offboardeten Kontos hier weder sichtbar noch entziehbar.
  await expect(recht(page, WEG.email)).toBeVisible();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE]);
});

test("Ein deaktiviertes Konto trägt in der Spalte „Status“ das Kennzeichen „Deaktiviert“ und ist ausgegraut — ein aktives nicht", async ({ page, api }) => {
  api.stub(USERS, { json: liste([ICH, WEG]) });
  await oeffne(page, "2 von 2");

  await expect(page.getByRole("columnheader")).toHaveText(["E-Mail", "Status", "Admin"]);
  await expect(zeile(page, WEG.email).getByRole("cell")).toHaveText([WEG.email, "Deaktiviert", ""]);
  await expect(zeile(page, ICH.email).getByRole("cell")).toHaveText([ICH.email, "", ""]);
  await expect(zeile(page, WEG.email).getByRole("cell").first()).toHaveCSS("opacity", /^0\.\d+$/);
  await expect(zeile(page, ICH.email).getByRole("cell").first()).toHaveCSS("opacity", "1");
});

test("Die Navigation hebt „Rollen“ als aktuelle Seite hervor, den Nachbarn „Verteiler“ nicht", async ({ page }) => {
  await oeffne(page);

  await expect(page.getByRole("link", { name: "Rollen", exact: true })).toHaveCSS("font-weight", "600");
  await expect(page.getByRole("link", { name: "Verteiler", exact: true })).toHaveCSS("font-weight", "400");
});

test("Der Hinweis unter der Tabelle sagt: Adminrechte gibt es nur im Portal, eine Rolle im Identity Provider bewirkt nichts", async ({ page }) => {
  await oeffne(page);

  // ADR-0022: Rollen aus dem IdP werden nicht gelesen — es gibt keine Admins, die diese Liste nicht zeigt.
  await expect(page.getByText(
    "Adminrechte gibt es nur hier im Portal — diese Liste ist vollständig. Eine Rolle im Identity Provider bewirkt nichts.",
    { exact: true })).toBeVisible();
});

test("Bis /me geantwortet hat, bleibt das Filterfeld gesperrt und es wird keine Liste angefragt", async ({ page, api }) => {
  const ich = hold();
  api.stub(ME, ich.answer);
  await page.goto("/rollen.html");

  // Ohne /me ist die eigene Zeile nicht erkennbar — sie stünde ungesperrt in der Liste.
  await expect(filterfeld(page)).toBeDisabled();
  await expect(page.locator("#users-body")).toHaveText("Lade …");
  await expect(mehrLaden(page)).toBeHidden();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);

  ich.release({ json: admin() });
  await expect(filterfeld(page)).toBeEnabled();
  await expect(recht(page, ICH.email)).toBeDisabled();
});

test("Aussperr-Schutz: die eigene Zeile ist gesperrt, auch wenn /me die Adresse mit Großbuchstaben liefert", async ({ page, api }) => {
  api.stub(ME, { json: admin({ email: "Admin@Example.org" }) });
  await oeffne(page);

  const eigene = recht(page, "admin@example.org");
  await expect(eigene).toBeChecked();
  await expect(eigene).toBeDisabled();
  await expect(eigene).toHaveAttribute("title", SELBST);
  await expect(recht(page, IDA.email)).toBeEnabled(); // anderen Admins lässt sich das Recht entziehen
  await eigene.click({ force: true }); // gesperrt heißt: auch ein erzwungener Klick nimmt das Häkchen nicht weg …
  await expect(eigene).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([]); // … und sendet nichts
});

test("Aussperr-Schutz: die eigene Zeile ist gesperrt, auch wenn die Liste die Adresse mit Großbuchstaben führt", async ({ page, api }) => {
  api.stub(USERS, { json: liste([{ ...ICH, email: "ADMIN@Example.ORG" }, IDA, MAX]) });
  await oeffne(page);

  const eigene = recht(page, "ADMIN@Example.ORG");
  await expect(eigene).toBeChecked();
  await expect(eigene).toBeDisabled();
  await expect(eigene).toHaveAttribute("title", SELBST);
  await expect(recht(page, IDA.email)).toBeEnabled();
  await eigene.click({ force: true }); // auch ein erzwungener Klick nimmt das Häkchen nicht weg …
  await expect(eigene).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([]); // … und sendet nichts
});

test("Die eigene Zeile ist in beide Richtungen gesperrt: auch eine Selbstvergabe ist nicht möglich", async ({ page, api }) => {
  api.stub(USERS, { json: liste([{ ...ICH, is_admin: false }, IDA, MAX]) });
  await oeffne(page);

  // Sie ließe sich nicht zurücknehmen: Den Entzug bei sich selbst lehnt die API ab.
  await expect(recht(page, ICH.email)).not.toBeChecked();
  await expect(recht(page, ICH.email)).toBeDisabled();
  await expect(recht(page, MAX.email)).toBeEnabled(); // anderen lässt sich das Recht vergeben
  await recht(page, ICH.email).click({ force: true }); // auch ein erzwungener Klick setzt kein Häkchen …
  await expect(recht(page, ICH.email)).not.toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([]); // … und sendet nichts
});

test("Deaktiviertes Konto ohne Adminrecht: die Vergabe ist gesperrt, der Grund steht dabei", async ({ page, api }) => {
  api.stub(USERS, { json: liste([ICH, WEG]) });
  await oeffne(page, "2 von 2");

  await expect(recht(page, WEG.email)).not.toBeChecked();
  await expect(recht(page, WEG.email)).toBeDisabled();
  await expect(recht(page, WEG.email)).toHaveAttribute("title", KEINE_VERGABE);
  // Wäre sie nur als gesperrt ausgezeichnet, stünde nach dem Klick ein Häkchen da, das nicht stimmt.
  await recht(page, WEG.email).click({ force: true });
  await expect(recht(page, WEG.email)).not.toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([]);
});

test("Deaktiviertes Konto MIT Adminrecht: der Entzug bleibt klickbar und wird gesendet", async ({ page, api }) => {
  api.stub({ [USERS]: { json: liste([ICH, { ...WEG, is_admin: true }]) }, [ENTZIEHEN_WEG]: { json: WEG } });
  await oeffne(page, "2 von 2");

  // Sonst bliebe das Recht eines offboardeten Kontos stehen — und lebte bei der nächsten Anmeldung wieder auf.
  await expect(recht(page, WEG.email)).toHaveAttribute("title", NUR_ENTZUG);
  await recht(page, WEG.email).click();

  await expectToast(page, "Adminrecht entzogen: weg@example.org");
  await expect(recht(page, WEG.email)).not.toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN_WEG]);
});

test("Nach dem Entzug bei einem deaktivierten Konto ist die Checkbox gesperrt und nennt den Grund — ein weiterer Klick sendet nichts", async ({ page, api }) => {
  api.stub({ [USERS]: { json: liste([ICH, WEG_MIT_RECHT]) }, [ENTZIEHEN_WEG]: { json: WEG } });
  await oeffne(page, "2 von 2");
  await recht(page, WEG.email).click();
  await expectToast(page, "Adminrecht entzogen: weg@example.org");

  // So zeichnet die Seite dasselbe Konto beim nächsten Laden: Die Vergabe lehnte die API ab (409 USER_INACTIVE).
  await expect(recht(page, WEG.email)).toBeDisabled();
  await expect(recht(page, WEG.email)).toHaveAttribute("title", KEINE_VERGABE);
  await recht(page, WEG.email).click({ force: true });
  await expect(recht(page, WEG.email)).not.toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN_WEG]);
});

test("Meldet die API nach dem Entzug bei einem deaktivierten Konto weiter is_admin=true, bleibt die Checkbox gesetzt und benutzbar", async ({ page, api }) => {
  api.stub({ [USERS]: { json: liste([ICH, WEG_MIT_RECHT]) }, [ENTZIEHEN_WEG]: { json: WEG_MIT_RECHT } });
  await oeffne(page, "2 von 2");
  await recht(page, WEG.email).click();
  await expectToast(page, "Adminrecht vergeben: weg@example.org"); // die Antwort gilt, nicht der Klick

  // Gesperrt wäre das Recht dieses Kontos hier nicht mehr zu entziehen.
  await expect(recht(page, WEG.email)).toBeChecked();
  await expect(recht(page, WEG.email)).toBeEnabled();
  await expect(recht(page, WEG.email)).toHaveAttribute("title", NUR_ENTZUG);
  api.stub(ENTZIEHEN_WEG, { json: WEG });
  await recht(page, WEG.email).click();
  await expectToast(page, "Adminrecht entzogen: weg@example.org");
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN_WEG, ENTZIEHEN_WEG]);
});

test("Scheitert der Entzug bei einem deaktivierten Konto, bleibt die Checkbox gesetzt und frei für den nächsten Versuch", async ({ page, api }) => {
  api.stub({ [USERS]: { json: liste([ICH, WEG_MIT_RECHT]) }, [ENTZIEHEN_WEG]: GATEWAY });
  await oeffne(page, "2 von 2");
  await recht(page, WEG.email).click();
  await expectToast(page, "Fehler (HTTP 502)", { error: true });

  await expect(recht(page, WEG.email)).toBeChecked(); // zurückgerollt: das Recht besteht weiter
  await expect(recht(page, WEG.email)).toBeEnabled();
  await expect(recht(page, WEG.email)).toHaveAttribute("title", NUR_ENTZUG);
  api.stub(ENTZIEHEN_WEG, { json: WEG });
  await recht(page, WEG.email).click();
  await expectToast(page, "Adminrecht entzogen: weg@example.org");
  await expect(recht(page, WEG.email)).toBeDisabled(); // erst jetzt ist nichts mehr zu entziehen
});

test("Der Hinweis „Konto ist deaktiviert …“ steht nur am deaktivierten Konto, aktive Konten tragen keinen", async ({ page, api }) => {
  api.stub(USERS, { json: liste([ICH, IDA, MAX, { ...WEG, is_admin: true }]) });
  await oeffne(page, "4 von 4");

  await expect(recht(page, WEG.email)).toHaveAttribute("title", NUR_ENTZUG);
  // Sonst läse man an jedem gewöhnlichen Konto, es sei deaktiviert und eine Vergabe nicht möglich.
  await expect(recht(page, IDA.email)).not.toHaveAttribute("title");
  await expect(recht(page, MAX.email)).not.toHaveAttribute("title");
});

test("Vergeben sendet PUT …/users/<id der angeklickten Zeile>/admin — ohne Body, mit CSRF-Header", async ({ page, api }) => {
  await oeffne(page);
  await recht(page, MAX.email).click();

  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN]); // genau EINE Änderung — und zwar für Max (id 12)
  expect(api.calls(VERGEBEN)[0].json).toBeNull();
  expect(api.calls(VERGEBEN)[0].headers["x-requested-with"]).toBe("fetch");
});

test("Entziehen sendet DELETE …/users/<id der angeklickten Zeile>/admin", async ({ page, api }) => {
  await oeffne(page);
  await recht(page, IDA.email).click();

  await expectToast(page, "Adminrecht entzogen: ida@example.org");
  await expect(recht(page, IDA.email)).not.toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN]); // genau EINE Änderung — und zwar für Ida (id 31)
  expect(api.calls(ENTZIEHEN)[0].headers["x-requested-with"]).toBe("fetch");
});

test("Die Antwort der API gilt, nicht der Klick: meldet sie is_admin=false, ist das Häkchen wieder weg", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click();
  await expect(recht(page, MAX.email)).toBeChecked(); // der Klick

  put.release({ json: MAX }); // ein anderer Admin hat das Recht im selben Moment wieder entzogen
  await expectToast(page, "Adminrecht entzogen: max@example.org");
  await expect(recht(page, MAX.email)).not.toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Die Antwort der API gilt auch beim Entzug: meldet sie is_admin=true, bleibt das Häkchen gesetzt", async ({ page, api }) => {
  const del = hold();
  api.stub(ENTZIEHEN, del.answer);
  await oeffne(page);
  await recht(page, IDA.email).click();
  await expect(recht(page, IDA.email)).not.toBeChecked(); // der Klick

  del.release({ json: IDA }); // ein anderer Admin hat das Recht im selben Moment wieder vergeben
  await expectToast(page, "Adminrecht vergeben: ida@example.org");
  await expect(recht(page, IDA.email)).toBeChecked(); // sonst verschwiege die Liste, wer Störungsmeldungen senden darf
  await expect(recht(page, IDA.email)).toBeEnabled();
});

test("Meldet die Antwort auf den Entzug das Konto als deaktiviert, folgt die Zeile der Antwort: Kennzeichen „Deaktiviert“, die Vergabe ist gesperrt", async ({ page, api }) => {
  // Ida wurde deaktiviert, nachdem die Liste geladen war; die Antwort auf den Entzug sagt es.
  api.stub(ENTZIEHEN, { json: { ...IDA, is_active: false, is_admin: false } });
  await oeffne(page);
  await recht(page, IDA.email).click();
  await expectToast(page, "Adminrecht entzogen: ida@example.org");

  // Wie nach dem Neuladen — die Vergabe lehnte die API ab (409 USER_INACTIVE).
  await expect(zeile(page, IDA.email).getByRole("cell")).toHaveText([IDA.email, "Deaktiviert", ""]);
  await expect(zeile(page, IDA.email).getByRole("cell").first()).toHaveCSS("opacity", /^0\.\d+$/);
  await expect(recht(page, IDA.email)).toBeDisabled();
  await expect(recht(page, IDA.email)).toHaveAttribute("title", KEINE_VERGABE);
  await recht(page, IDA.email).click({ force: true });
  await expect(recht(page, IDA.email)).not.toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN]);
});

test("Meldet die Antwort auf den Entzug das Konto als wieder aktiv, folgt die Zeile der Antwort: kein Kennzeichen, die Vergabe ist frei", async ({ page, api }) => {
  // Das deaktivierte Konto hat sich neu angemeldet, nachdem die Liste geladen war — das reaktiviert es (ADR-0010);
  // die Antwort auf den Entzug sagt es.
  const wiederDa = { ...WEG, is_active: true };
  api.stub({
    [USERS]: { json: liste([ICH, WEG_MIT_RECHT]) },
    [ENTZIEHEN_WEG]: { json: wiederDa },
    [VERGEBEN_WEG]: { json: { ...wiederDa, is_admin: true } },
  });
  await oeffne(page, "2 von 2");
  await recht(page, WEG.email).click();
  await expectToast(page, "Adminrecht entzogen: weg@example.org");

  await expect(zeile(page, WEG.email).getByRole("cell")).toHaveText([WEG.email, "", ""]);
  await expect(zeile(page, WEG.email).getByRole("cell").first()).toHaveCSS("opacity", "1");
  await expect(recht(page, WEG.email)).not.toHaveAttribute("title");
  await recht(page, WEG.email).click(); // gesperrt wäre das Recht hier erst nach dem Neuladen wieder zu vergeben
  await expectToast(page, "Adminrecht vergeben: weg@example.org");
  await expect(recht(page, WEG.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN_WEG, VERGEBEN_WEG]);
});

test("Meldet die Antwort eine andere Adresse als die Liste, stehen Zeile, Name der Checkbox und Toast auf der gemeldeten", async ({ page, api }) => {
  // Die Adresse kommt aus dem IdP und wird bei der Anmeldung übernommen (ADR-0010) — auch nachdem die Liste geladen war.
  api.stub(VERGEBEN, { json: { ...MAX, email: "max.neu@example.org", is_admin: true } });
  await oeffne(page);
  await recht(page, MAX.email).click();

  await expectToast(page, "Adminrecht vergeben: max.neu@example.org");
  await expect(zeilen(page)).toHaveText(["admin@example.org", "ida@example.org", "max.neu@example.org"]);
  await expect(recht(page, "max.neu@example.org")).toBeChecked();
  await expect(recht(page, "max.neu@example.org")).toBeEnabled();
});

test("Vergeben scheitert (409 USER_INACTIVE): das Häkchen springt zurück, der Text der API steht im Fehler-Toast", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click();
  await expect(recht(page, MAX.email)).toBeChecked(); // gesetzt, solange die Anfrage läuft

  put.release(inaktiv(MAX.email));
  await expectToast(page, "max@example.org ist deaktiviert — bitte zuerst reaktivieren", { error: true });
  await expect(recht(page, MAX.email)).not.toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Entziehen scheitert (403, eigenes Recht inzwischen weg): das Häkchen bleibt gesetzt, Fehler-Toast", async ({ page, api }) => {
  const del = hold();
  api.stub(ENTZIEHEN, del.answer);
  await oeffne(page);
  await recht(page, IDA.email).click();
  await expect(recht(page, IDA.email)).not.toBeChecked(); // entfernt, solange die Anfrage läuft

  del.release(KEIN_ADMIN);
  await expectToast(page, "Keine Berechtigung für diese Funktion", { error: true });
  await expect(recht(page, IDA.email)).toBeChecked();
  await expect(recht(page, IDA.email)).toBeEnabled();
});

test("Solange die Anfrage läuft, ist die Checkbox gesperrt — ein zweiter Klick ändert nichts", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click();
  await expect(recht(page, MAX.email)).toBeDisabled();
  await recht(page, MAX.email).click({ force: true }); // ungeduldig noch einmal

  put.release({ json: { ...MAX, is_admin: true } });
  await expect(recht(page, MAX.email)).toBeEnabled();
  await expect(recht(page, MAX.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN]);
});

test("Lädt die Liste während eines Umschaltens neu, zeigt die neue Zeile den gewünschten Stand und bleibt gesperrt — ein Klick sendet nichts", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, { json: liste([MAX]) }); // die Liste kennt noch den Stand VOR dem Schreiben
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  await expect(recht(page, MAX.email)).toBeChecked(); // der Wunsch, nicht der Stand der Liste
  await expect(recht(page, MAX.email)).toBeDisabled();
  await recht(page, MAX.email).click({ force: true });
  await recht(page, MAX.email).focus(); // auch per Tastatur nicht: die Checkbox nimmt den Fokus nicht an
  await expect(recht(page, MAX.email)).not.toBeFocused();
  await expect(recht(page, MAX.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN]);
});

test("Lädt die Liste während eines Umschaltens neu, gilt die Antwort der Zeile, die jetzt dasteht: das Häkchen stimmt mit dem Toast überein", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, { json: liste([MAX]) }); // die Liste kennt noch den Stand VOR dem Schreiben
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Scheitert das Umschalten, nachdem die Liste neu geladen hat, steht die Zeile wieder auf dem Stand der Liste — frei für den nächsten Versuch", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, { json: liste([MAX]) });
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  put.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(recht(page, MAX.email)).not.toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
  api.stub(VERGEBEN, { json: { ...MAX, is_admin: true } });
  await recht(page, MAX.email).click();
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN, VERGEBEN]);
});

test("Scheitert das Umschalten, nachdem die neu geladene Liste schon den gewünschten Stand gemeldet hat, bleibt die Zeile auf dem Stand der Liste", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  // Gespeichert ist das Recht — die Liste meldet es —, nur die Antwort auf die Vergabe kommt nicht durch.
  api.stub(USERS, { json: liste([{ ...MAX, is_admin: true }]) });
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  put.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(recht(page, MAX.email)).toBeChecked(); // zurück auf den Klick-Stand zeigte die Zeile ein Recht nicht an, das besteht
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Auch nach zweimaligem Neuladen gilt die Antwort der Zeile, die dann dasteht", async ({ page, api }) => {
  const del = hold();
  api.stub(ENTZIEHEN, del.answer);
  await oeffne(page);
  await recht(page, IDA.email).click(); // Entzug unterwegs (zurückgehalten)
  await expect(recht(page, IDA.email)).toBeDisabled();
  api.stub(USERS, { json: liste([IDA]) }); // beide Listen kennen noch den Stand VOR dem Schreiben
  await suche(page, "ida");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  api.stub(USERS, { json: liste([ICH, IDA, MAX]) });
  await suche(page, "");
  await expect(page.locator("#result-count")).toHaveText("3 von 3");
  await expect(recht(page, IDA.email)).not.toBeChecked(); // weiter der Wunsch …
  await expect(recht(page, IDA.email)).toBeDisabled(); // … und weiter gesperrt

  del.release({ json: { ...IDA, is_admin: false } });
  await expectToast(page, "Adminrecht entzogen: ida@example.org");
  await expect(recht(page, IDA.email)).not.toBeChecked();
  await expect(recht(page, IDA.email)).toBeEnabled();
});

test("Scheitert das Umschalten nach zweimaligem Neuladen, steht die Zeile, die dann dasteht, wieder auf dem Stand der Liste", async ({ page, api }) => {
  const del = hold();
  api.stub(ENTZIEHEN, del.answer);
  await oeffne(page);
  await recht(page, IDA.email).click(); // Entzug unterwegs (zurückgehalten)
  await expect(recht(page, IDA.email)).toBeDisabled();
  api.stub(USERS, { json: liste([IDA]) });
  await suche(page, "ida");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  api.stub(USERS, { json: liste([ICH, IDA, MAX]) });
  await suche(page, "");
  await expect(page.locator("#result-count")).toHaveText("3 von 3");
  await expect(recht(page, IDA.email)).toBeDisabled();

  del.release(KEIN_ADMIN);
  await expectToast(page, "Keine Berechtigung für diese Funktion", { error: true });
  await expect(recht(page, IDA.email)).toBeChecked();
  await expect(recht(page, IDA.email)).toBeEnabled();
});

test("Steht das Konto nicht in der neu geladenen Liste, wenn die Antwort eintrifft, bleibt es beim Toast — die Zeilen der anderen bleiben unberührt", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, { json: liste([IDA]) });
  await suche(page, "ida");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await api.sync();
  await expect(zeilen(page)).toHaveText(["ida@example.org"]);
  await expect(recht(page, IDA.email)).toBeChecked();
  await expect(recht(page, IDA.email)).toBeEnabled();
});

test("Die Sperre endet mit der Antwort, auch wenn das Konto gerade nicht in der Liste steht: beim nächsten Laden ist seine Zeile frei", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, { json: liste([IDA]) });
  await suche(page, "ida");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  put.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });

  api.stub(USERS, { json: liste([ICH, IDA, MAX]) });
  await suche(page, "");
  await expect(page.locator("#result-count")).toHaveText("3 von 3");
  await expect(recht(page, MAX.email)).not.toBeChecked(); // der Stand der Liste, nicht mehr der Wunsch
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Zugeordnet wird über das Konto, nicht über die Stelle in der Liste: wer an die Stelle nachrückt, bleibt unberührt", async ({ page, api }) => {
  const karl = user({ id: 77, email: "karl@example.org" });
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // Max steht an dritter Stelle
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, { json: liste([ICH, IDA, karl, MAX]) }); // inzwischen hat sich Karl zum ersten Mal angemeldet
  await suche(page, "example");
  await expect(page.locator("#result-count")).toHaveText("4 von 4");
  await expect(recht(page, karl.email)).toBeEnabled(); // an dritter Stelle steht jetzt er
  await expect(recht(page, MAX.email)).toBeDisabled();

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
  await expect(recht(page, karl.email)).not.toBeChecked();
});

test("Laufen zwei Umschaltungen, während die Liste neu lädt, gilt jede Antwort der Zeile ihres Kontos", async ({ page, api }) => {
  const put = hold();
  const del = hold();
  api.stub({ [VERGEBEN]: put.answer, [ENTZIEHEN]: del.answer });
  await oeffne(page);
  await recht(page, MAX.email).click(); // Max: vergeben …
  await recht(page, IDA.email).click(); // … Ida: entziehen — beide unterwegs (zurückgehalten)
  await expect(recht(page, IDA.email)).toBeDisabled();
  api.stub(USERS, { json: liste([IDA, MAX]) }); // der Stand VOR beiden Schreibvorgängen
  await suche(page, "a");
  await expect(page.locator("#result-count")).toHaveText("2 von 2");

  del.release(KEIN_ADMIN);
  await expectToast(page, "Keine Berechtigung für diese Funktion", { error: true });
  await expect(recht(page, IDA.email)).toBeChecked();
  await expect(recht(page, IDA.email)).toBeEnabled();
  await expect(recht(page, MAX.email)).toBeChecked(); // weiter der Wunsch …
  await expect(recht(page, MAX.email)).toBeDisabled(); // … und gesperrt, bis auch seine Antwort da ist
  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Lädt „Mehr laden“ die Liste während eines Umschaltens von vorn, gilt die Antwort der Zeile, die jetzt dasteht: das Häkchen stimmt mit dem Toast überein", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const vonVorn = hold();
  const put = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? vonVorn.answer() : geblaettert(52)(call)),
    [VERGEBEN_NUTZER_1]: put.answer,
  });
  await mehrLaden(page).click(); // die nächste Seite meldet 52 statt 51 …
  await expect.poll(() => api.calls(USERS)).toHaveLength(3); // … das Neuladen von vorn ist unterwegs (zurückgehalten)
  await recht(page, NUTZER_1.email).click(); // die geladenen Zeilen stehen noch und bleiben bedienbar
  await expect(recht(page, NUTZER_1.email)).toBeDisabled();
  vonVorn.release({ json: liste(empfaenger(1, 50), 52) }); // die Liste kennt noch den Stand VOR dem Schreiben
  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await expect(recht(page, NUTZER_1.email)).toBeChecked(); // der Wunsch, nicht der Stand der Liste
  await expect(recht(page, NUTZER_1.email)).toBeDisabled();

  put.release({ json: { ...NUTZER_1, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(recht(page, NUTZER_1.email)).toBeChecked();
  await expect(recht(page, NUTZER_1.email)).toBeEnabled();
});

test("Trifft die Antwort auf ein Umschalten ein, bevor „Mehr laden“ die Liste fertig von vorn geladen hat, behält die neue Zeile den gespeicherten Stand — die ältere Listenantwort überschreibt ihn nicht", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const vonVorn = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? vonVorn.answer() : geblaettert(52)(call)),
    [VERGEBEN_NUTZER_1]: { json: { ...NUTZER_1, is_admin: true } },
  });
  await mehrLaden(page).click(); // die nächste Seite meldet 52 statt 51 …
  await expect.poll(() => api.calls(USERS)).toHaveLength(3); // … das Neuladen von vorn ist unterwegs (zurückgehalten)
  await recht(page, NUTZER_1.email).click();
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org"); // beantwortet, bevor die Liste da ist

  vonVorn.release({ json: liste(empfaenger(1, 50), 52) }); // gelesen VOR dem Schreiben, angekommen danach
  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await expect(recht(page, NUTZER_1.email)).toBeChecked();
  await expect(recht(page, NUTZER_1.email)).toBeEnabled();
});

test("Trifft die Antwort auf ein Umschalten ein, während eine Suche noch lädt, zeigt die Zeile im Suchergebnis den gespeicherten Stand", async ({ page, api }) => {
  const put = hold();
  const treffer = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await recht(page, MAX.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, MAX.email)).toBeDisabled();
  api.stub(USERS, treffer.answer);
  await suche(page, "max"); // unterwegs (zurückgehalten)
  await expect(page.locator("#users-body")).toHaveText("Lade …"); // die angeklickte Zeile steht nicht mehr da
  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");

  treffer.release({ json: liste([MAX]) }); // gelesen VOR dem Schreiben, angekommen danach
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(recht(page, MAX.email)).toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Eine Liste, die erst nach der Antwort angefragt wird, gilt wieder allein: hat ein anderer Admin das Recht inzwischen entzogen, zeigt die Zeile das", async ({ page, api }) => {
  await oeffne(page);
  await recht(page, MAX.email).click();
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();

  api.stub(USERS, { json: liste([MAX]) }); // gelesen NACH dem Schreiben — und dem Entzug durch den anderen Admin
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(recht(page, MAX.email)).not.toBeChecked();
  await expect(recht(page, MAX.email)).toBeEnabled();
});

test("Auch eine Seite, die „Mehr laden“ erst nach der Antwort anfragt, gilt wieder allein", async ({ page, api }) => {
  const put = hold();
  const [spaeter] = empfaenger(60, 1); // nutzer60 (id 160): ungefiltert erst auf der zweiten Seite
  api.stub({
    [USERS]: (call) => (call.query.query ? { json: liste([spaeter]) } : geblaettert(120)(call)),
    "PUT /api/v1/admin/users/160/admin": put.answer,
  });
  await oeffne(page, "50 von 120");
  await suche(page, "nutzer60");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  await recht(page, spaeter.email).click(); // unterwegs (zurückgehalten)
  await expect(recht(page, spaeter.email)).toBeDisabled();
  await suche(page, ""); // die Liste zeigt wieder alle: Seine Zeile steht nicht mehr da
  await expect(page.locator("#result-count")).toHaveText("50 von 120");
  put.release({ json: { ...spaeter, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer60@example.org");
  await mehrLaden(page).click(); // gelesen NACH dem Schreiben — und dem Entzug durch den anderen Admin

  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(recht(page, spaeter.email)).not.toBeChecked();
  await expect(recht(page, spaeter.email)).toBeEnabled();
});

test("Tastatur: nach dem Umschalten mit der Leertaste liegt der Fokus wieder auf der Checkbox", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await schalteMitLeertaste(page, MAX.email);

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, MAX.email)).toBeFocused();
});

test("Tastatur: auch nach einem abgelehnten Umschalten liegt der Fokus wieder auf der Checkbox", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await schalteMitLeertaste(page, MAX.email);

  put.release(inaktiv(MAX.email));
  await expectToast(page, "max@example.org ist deaktiviert — bitte zuerst reaktivieren", { error: true });
  await expect(recht(page, MAX.email)).not.toBeChecked();
  await expect(recht(page, MAX.email)).toBeFocused(); // sonst müsste man die Zeile mit Tab neu suchen
});

test("Tastatur: wer inzwischen im Filterfeld tippt, behält den Fokus — ein Leerzeichen schaltet nichts um", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await schalteMitLeertaste(page, MAX.email);
  await filterfeld(page).click();
  await page.keyboard.type("ida");

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await page.keyboard.press("Space");
  await expect(filterfeld(page)).toBeFocused();
  await expect(filterfeld(page)).toHaveValue("ida ");
  await expect(recht(page, MAX.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN]);
});

test("Tastatur: wer inzwischen zu einer anderen Checkbox gewechselt ist, behält dort den Fokus — die Leertaste gilt dieser Zeile", async ({ page, api }) => {
  const put = hold();
  api.stub(VERGEBEN, put.answer);
  await oeffne(page);
  await schalteMitLeertaste(page, MAX.email);
  await recht(page, IDA.email).focus(); // weiter zur Zeile darüber, während Max noch gespeichert wird

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(recht(page, IDA.email)).toBeFocused(); // nicht zurück auf Max gesprungen
  await page.keyboard.press("Space"); // spränge der Fokus zurück, nähme sie Max das Recht gleich wieder
  await expectToast(page, "Adminrecht entzogen: ida@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN, ENTZIEHEN]);
});

test("Tastatur: laufen zwei Umschaltungen zugleich, bekommt nur die zuletzt bediente Checkbox den Fokus zurück — die nächste Leertaste gilt ihrer Zeile", async ({ page, api }) => {
  const put = hold();
  const del = hold();
  api.stub({ [VERGEBEN]: put.answer, [ENTZIEHEN]: del.answer, [VERGEBEN_IDA]: { json: IDA } });
  await oeffne(page);
  await schalteMitLeertaste(page, MAX.email); // Max: vergeben …
  await schalteMitLeertaste(page, IDA.email); // … und gleich weiter zu Ida: entziehen

  put.release({ json: { ...MAX, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await expect(page.locator("body")).toBeFocused(); // die erste Antwort holt den Fokus nicht auf Max zurück
  del.release({ json: { ...IDA, is_admin: false } });
  await expectToast(page, "Adminrecht entzogen: ida@example.org");
  await expect(recht(page, IDA.email)).toBeFocused();
  await page.keyboard.press("Space"); // läge der Fokus auf Max, nähme sie ihm das eben vergebene Recht wieder
  await expectToast(page, "Adminrecht vergeben: ida@example.org");
  await expect(recht(page, MAX.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN, ENTZIEHEN, VERGEBEN_IDA]);
});

test("Tastatur: nach dem Entzug bei einem deaktivierten Konto bleibt der Fokus auf der Seite — die gesperrte Checkbox nimmt ihn nicht, eine weitere Leertaste sendet nichts", async ({ page, api }) => {
  const del = hold();
  api.stub({ [USERS]: { json: liste([ICH, IDA, WEG_MIT_RECHT]) }, [ENTZIEHEN_WEG]: del.answer });
  await oeffne(page);
  await schalteMitLeertaste(page, WEG.email);

  del.release({ json: WEG });
  await expectToast(page, "Adminrecht entzogen: weg@example.org");
  await expect(recht(page, WEG.email)).toBeDisabled();
  await expect(page.locator("body")).toBeFocused(); // auch nicht ersatzweise auf Idas Checkbox
  await page.keyboard.press("Space");
  await expect(recht(page, IDA.email)).toBeChecked();
  await api.sync();
  expect(aenderungen(api)).toEqual([ENTZIEHEN_WEG]);
});

test("Suche: nach 250 ms Ruhe geht genau EINE Anfrage raus — getrimmt und URL-kodiert", async ({ page, api }) => {
  await oeffne(page);
  api.stub(USERS, { json: liste([MAX]) });
  await filterfeld(page).pressSequentially("  a+b&c#d%e f@ö.or"); // 18 input-Ereignisse

  // 249 ms nach dem letzten Tastendruck ist die Frist nicht um; ein weiterer startet sie neu.
  await page.clock.runFor(249);
  await filterfeld(page).pressSequentially("g ");
  await page.clock.runFor(249);
  await api.sync();
  expect(api.calls(USERS)).toHaveLength(1); // nur der Abruf beim Öffnen
  await page.clock.runFor(1);

  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(zeilen(page)).toHaveText(["max@example.org"]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, { query: "a+b&c#d%e f@ö.org", limit: "50", offset: "0" }]);
});

test("Das Filterfeld nimmt höchstens 200 Zeichen an — längere Filter lehnt die API ab", async ({ page }) => {
  await oeffne(page);
  await filterfeld(page).fill("x".repeat(199));
  await filterfeld(page).pressSequentially("yz"); // das 200. Zeichen passt noch, das 201. nicht mehr

  await expect(filterfeld(page)).toHaveValue("x".repeat(199) + "y");
});

test("Eine neue Suche beginnt wieder bei offset 0 und ersetzt die Liste, statt anzuhängen", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  await mehrLaden(page).click();
  await expect(page.locator("#result-count")).toHaveText("100 von 120");

  api.stub(USERS, { json: liste([MAX]) });
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(zeilen(page)).toHaveText(["max@example.org"]);
  await expect(mehrLaden(page)).toBeHidden();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([
    ERSTE_SEITE, ZWEITE_SEITE, { query: "max", limit: "50", offset: "0" }]);
});

test("Keine Treffer: die Tabelle sagt es, der Zähler steht auf „0 von 0“ und „Mehr laden“ verschwindet", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  await expect(mehrLaden(page)).toBeVisible();
  api.stub(USERS, { json: liste([]) });
  await suche(page, "niemand");

  await expect(page.locator("#users-body")).toHaveText("Keine Treffer.");
  await expect(page.locator("#result-count")).toHaveText("0 von 0");
  await expect(mehrLaden(page)).toBeHidden(); // sonst stünde unter „Keine Treffer.“ ein Knopf, der wieder offset 0 anfragt
});

test("Ein Hinweis in der Tabelle steht mittig über allen drei Spalten", async ({ page, api }) => {
  api.stub(USERS, { json: liste([]) });
  await oeffne(page, "0 von 0");

  const hinweis = page.getByRole("cell", { name: "Keine Treffer." });
  await expect(hinweis).toHaveJSProperty("colSpan", 3); // nicht in die Spalte „E-Mail“ gequetscht
  await expect(hinweis).toHaveCSS("text-align", "center");
});

test("Race: die verspätete Antwort auf die ältere Suche ersetzt die neuere Liste nicht", async ({ page, api }) => {
  await oeffne(page);
  const alt = hold();
  api.stub(USERS, (call) => (call.query.query === "i" ? alt.answer() : { json: liste([IDA]) }));
  await suche(page, "i"); // unterwegs (zurückgehalten)
  await suche(page, "id");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  alt.release({ json: liste([ICH, IDA, MAX]) }); // auf „i“ passen alle drei
  await api.sync();
  await expect(zeilen(page)).toHaveText(["ida@example.org"]);
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
});

test("Race: trifft die ältere Antwort ein, während die neuere Suche noch läuft, wird sie nicht angezeigt", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  const alt = hold();
  const neu = hold();
  api.stub(USERS, (call) => (call.query.query === "i" ? alt.answer() : neu.answer()));
  await suche(page, "i");
  await suche(page, "id");

  alt.release({ json: liste([ICH, IDA, MAX]) });
  await api.sync();
  await expect(page.locator("#users-body")).toHaveText("Lade …");
  await expect(mehrLaden(page)).toBeDisabled(); // sonst ließe sich mitten in der laufenden Suche nachladen
  neu.release({ json: liste([IDA]) });
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(zeilen(page)).toHaveText(["ida@example.org"]);
});

test("Race: eine verspätete „Mehr laden“-Antwort wird nicht an das neuere Suchergebnis angehängt", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.query === "max" ? { json: liste([MAX]) } : seite2.answer()));
  await mehrLaden(page).click(); // unterwegs (zurückgehalten)
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  seite2.release(anschluss(120));
  await api.sync();
  await expect(zeilen(page)).toHaveText(["max@example.org"]);
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(mehrLaden(page)).toBeHidden();
});

test("Race: scheitert die ältere Suche verspätet, bleibt die neuere Liste stehen — ohne Fehlermeldung", async ({ page, api }) => {
  await oeffne(page);
  const alt = hold();
  api.stub(USERS, (call) => (call.query.query === "i" ? alt.answer() : { json: liste([IDA]) }));
  await suche(page, "i");
  await suche(page, "id");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  alt.release(DB_FEHLER);
  await api.sync();
  await expect(zeilen(page)).toHaveText(["ida@example.org"]);
  await keinToast(page);
});

test("„Mehr laden“ fragt die letzte geladene Zeile noch einmal mit an (offset 49, limit 51) und hängt nur die neuen an — keine Zeile steht doppelt da, keine fehlt", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  await expect(mehrLaden(page)).toBeVisible();
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(zeilen(page)).toHaveText(adressen(empfaenger(1, 100))); // nutzer50 einmal, darunter nutzer51
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, ZWEITE_SEITE]);
});

test("Auch die dritte Seite schließt an die letzte geladene Zeile an (offset 99) — ist alles geladen, verschwindet „Mehr laden“", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  await mehrLaden(page).click();
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("120 von 120");
  await expect(mehrLaden(page)).toBeHidden();
  await expect(zeilen(page)).toHaveText(adressen(empfaenger(1, 120)));
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, ZWEITE_SEITE, { query: "", limit: "51", offset: "99" }]);
});

test("Genau eine volle Seite (50 von 50): „Mehr laden“ erscheint nicht", async ({ page, api }) => {
  api.stub(USERS, geblaettert(50));
  await oeffne(page, "50 von 50");

  await expect(zeilen(page)).toHaveCount(50);
  await expect(mehrLaden(page)).toBeHidden(); // maßgeblich ist die Gesamtzahl, nicht ob die Seite voll war
});

test("Kommt beim Blättern ein Empfänger hinzu, lädt „Mehr laden“ die Liste von vorn — keine Zeile steht doppelt da, der neue fehlt nicht", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  // Eine erste Anmeldung sortiert sich VOR die geladene Seite ein — alles rutscht um eine Stelle.
  api.stub(USERS, seiten([user({ id: 99, email: "anna@example.org" }), ...empfaenger(1, 51)]));
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await expect(zeilen(page)).toHaveCount(50);
  await expect(zeilen(page).first()).toHaveText("anna@example.org");
  await mehrLaden(page).click(); // weiter geht es wie gewohnt mit der nächsten Seite
  await expect(page.locator("#result-count")).toHaveText("52 von 52");
  await expect(zeilen(page)).toHaveCount(52);
  await expect(recht(page, "nutzer50@example.org")).toHaveCount(1); // angehängt stünde nutzer50 zweimal da
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49"]);
});

test("Fallen beim Blättern Empfänger weg, lädt „Mehr laden“ die Liste von vorn — der Zähler stimmt, gelöschte Konten sind verschwunden", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  api.stub(USERS, geblaettert(49)); // nutzer50 und nutzer51 wurden inzwischen gelöscht — die nächste Seite ist leer
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("49 von 49"); // nicht „50 von 49“
  await expect(zeilen(page)).toHaveCount(49);
  await expect(recht(page, "nutzer50@example.org")).toHaveCount(0);
  await expect(mehrLaden(page)).toBeHidden();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("Kommt ein Konto hinzu, während ein anderes wegfällt, lädt „Mehr laden“ die Liste von vorn — auch bei unveränderter Gesamtzahl steht keine Zeile doppelt da, das neue Konto fehlt nicht", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  // Eine erste Anmeldung sortiert sich vorn ein, nutzer51 wird gelöscht: Die Gesamtzahl bleibt 51, aber alles ist
  // um eine Stelle nach hinten gerutscht — an der Anschlussstelle steht jetzt nutzer49 statt nutzer50.
  const verschoben = [user({ id: 99, email: "anna@example.org" }), ...empfaenger(1, 50)];
  api.stub(USERS, seiten(verschoben));
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("50 von 51");
  await expect(zeilen(page)).toHaveText(adressen(verschoben.slice(0, 50)));
  await mehrLaden(page).click(); // weiter geht es wie gewohnt mit der nächsten Seite
  await expect(page.locator("#result-count")).toHaveText("51 von 51");
  await expect(zeilen(page)).toHaveText(adressen(verschoben)); // angehängt stünde nutzer50 zweimal da, und anna fehlte
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49"]);
});

test("Fällt ein geladenes Konto weg, während dahinter eines hinzukommt, lädt „Mehr laden“ die Liste von vorn — auch bei unveränderter Gesamtzahl fehlt keine Zeile, das gelöschte Konto ist verschwunden", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  // nutzer7 wird gelöscht, nutzer52 meldet sich zum ersten Mal an: Die Gesamtzahl bleibt 51, aber alles hinter
  // nutzer7 ist um eine Stelle nach vorn gerutscht — an der Anschlussstelle steht jetzt nutzer51 statt nutzer50.
  const verschoben = [...empfaenger(1, 6), ...empfaenger(8, 45)];
  api.stub(USERS, seiten(verschoben));
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("50 von 51");
  await expect(zeilen(page)).toHaveText(adressen(verschoben.slice(0, 50))); // ohne nutzer7, mit nutzer51
  await mehrLaden(page).click();
  await expect(page.locator("#result-count")).toHaveText("51 von 51");
  await expect(zeilen(page)).toHaveText(adressen(verschoben)); // ohne Anschlussprüfung fehlte nutzer51 (übersprungen)
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49"]);
});

test("Fehlt in der Antwort auf „Mehr laden“ auch die Anschlusszeile, lädt die Liste von vorn", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  // Die API zählt und liest in zwei Abfragen: gezählt noch 51, gelesen ab der 50. Stelle nichts mehr.
  api.stub(USERS, (call) => (call.query.offset === "0" ? geblaettert(49)(call) : { json: liste([], 51, 51, 49) }));
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("49 von 49");
  await expect(zeilen(page)).toHaveCount(49);
  await expect(mehrLaden(page)).toBeHidden();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("Steht nach einer leeren ersten Seite noch „Mehr laden“ da, lädt der Knopf von vorn — eine Zeile zum Anschließen gibt es nicht", async ({ page, api }) => {
  // Die API zählt und liest in zwei Abfragen: gezählt noch ein Konto, gelesen keines mehr.
  api.stub(USERS, { json: liste([], 1) });
  await oeffne(page, "0 von 1");
  await expect(page.locator("#users-body")).toHaveText("Keine Treffer.");
  api.stub(USERS, { json: liste([MAX]) });
  await mehrLaden(page).click();

  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await expect(zeilen(page)).toHaveText(["max@example.org"]); // nicht unter „Keine Treffer.“ angehängt
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, ERSTE_SEITE]); // nicht offset −1
});

test("Ändert sich die Gesamtzahl mit jeder Anfrage, lädt ein Klick trotzdem nur einmal von vorn", async ({ page, api }) => {
  let gesamt = 120;
  api.stub(USERS, (call) => geblaettert(gesamt++)(call)); // jede Antwort meldet einen Empfänger mehr
  await oeffne(page, "50 von 120");
  await mehrLaden(page).click(); // Seite 2 meldet 121 → von vorn; die Antwort darauf meldet schon 122

  await expect(page.locator("#result-count")).toHaveText("50 von 122");
  await expect(mehrLaden(page)).toBeEnabled(); // keine Schleife: der nächste Schritt ist wieder Sache des Admins
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("Scheitert das Neuladen von vorn, bleiben die geladenen Zeilen stehen — nur ein Fehler-Toast, der nächste Versuch gelingt", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  // Die nächste Seite meldet schon 52 Empfänger, dann fällt das Backend aus.
  api.stub(USERS, (call) => (call.query.offset === "0" ? GATEWAY : geblaettert(52)(call)));
  await mehrLaden(page).click();

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilen(page)).toHaveCount(50);
  await expect(zeilen(page).first()).toHaveText("nutzer1@example.org");
  await expect(page.locator("#result-count")).toHaveText("50 von 51");
  await expect(mehrLaden(page)).toBeEnabled();
  api.stub(USERS, geblaettert(52));
  await mehrLaden(page).click();
  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49", "0"]);
});

test("Auch eine Antwort ohne JSON ist ein gescheitertes Neuladen von vorn: die geladenen Zeilen bleiben stehen, der nächste Versuch gelingt", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  // Die nächste Seite meldet schon 52 Empfänger; auf die Anfrage von vorn antwortet nicht mehr die API.
  api.stub(USERS, (call) => (call.query.offset === "0" ? ANMELDESEITE : geblaettert(52)(call)));
  await mehrLaden(page).click();

  await expectToast(page, KEINE_API_ANTWORT, { error: true });
  await expect(zeilen(page)).toHaveCount(50);
  await expect(zeilen(page).first()).toHaveText("nutzer1@example.org");
  await expect(page.locator("#result-count")).toHaveText("50 von 51");
  await expect(mehrLaden(page)).toBeEnabled();
  api.stub(USERS, geblaettert(52));
  await mehrLaden(page).click(); // Blätterstand und Gesamtzahl sind unberührt: wieder Seite 2, wieder 52 statt 51 → von vorn
  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49", "0"]);
});

test("Nach einem gescheiterten Neuladen von vorn lässt sich in der stehen gebliebenen Liste wieder umschalten", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? GATEWAY : geblaettert(52)(call)),
    [VERGEBEN_NUTZER_1]: { json: { ...NUTZER_1, is_admin: true } },
  });
  await mehrLaden(page).click();
  await expectToast(page, "Fehler (HTTP 502)", { error: true });

  await recht(page, NUTZER_1.email).focus();
  await page.keyboard.press("Space");
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(recht(page, NUTZER_1.email)).toBeChecked();
});

test("Race: eine neue Suche überholt auch das Neuladen von vorn — dessen verspätete Antwort ersetzt das Suchergebnis nicht", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const vonVorn = hold();
  api.stub(USERS, (call) => (call.query.query === "max" ? { json: liste([MAX]) }
    : call.query.offset === "0" ? vonVorn.answer() : geblaettert(52)(call)));
  await mehrLaden(page).click();
  // Die nächste Seite hat 52 Empfänger gemeldet, das Neuladen von vorn ist unterwegs (zurückgehalten).
  await expect.poll(() => api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  vonVorn.release({ json: liste(empfaenger(1, 50), 52) });
  await api.sync();
  await expect(zeilen(page)).toHaveText(["max@example.org"]);
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
  await recht(page, MAX.email).focus();
  await page.keyboard.press("Space"); // … und das Suchergebnis lässt sich bedienen
  await expectToast(page, "Adminrecht vergeben: max@example.org");
});

test("Race: eine überholte „Mehr laden“-Antwort mit anderer Gesamtzahl lädt nichts von vorn — das Suchergebnis bleibt bedienbar", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.query === "max" ? { json: liste([MAX]) } : seite2.answer()));
  await mehrLaden(page).click(); // unterwegs (zurückgehalten)
  await suche(page, "max");
  await expect(page.locator("#result-count")).toHaveText("1 von 1");

  seite2.release(anschluss(121)); // inzwischen 121 statt 120
  await api.sync();
  await recht(page, MAX.email).focus();
  await page.keyboard.press("Space");
  await expectToast(page, "Adminrecht vergeben: max@example.org");
  await api.sync();
  expect(api.calls(USERS)).toHaveLength(3); // erste Seite, zweite Seite, Suche — kein Neuladen für eine Liste, die es nicht mehr gibt
});

test("„Mehr laden“ blättert im Suchergebnis weiter: der Filtertext bleibt in der Anfrage", async ({ page, api }) => {
  await oeffne(page); // drei Empfänger, „Mehr laden“ ist ausgeblendet
  api.stub(USERS, geblaettert(70));
  await suche(page, "nutzer");
  await expect(page.locator("#result-count")).toHaveText("50 von 70");
  await mehrLaden(page).click(); // das größere Suchergebnis hat den Knopf wieder zum Vorschein gebracht

  await expect(page.locator("#result-count")).toHaveText("70 von 70");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([
    ERSTE_SEITE, { query: "nutzer", limit: "50", offset: "0" }, { query: "nutzer", limit: "51", offset: "49" }]);
});

test("„Mehr laden“ ist gesperrt, solange die Anfrage läuft, und danach wieder frei", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  const seite2 = hold();
  api.stub(USERS, seite2.answer);
  await mehrLaden(page).click();
  await expect(mehrLaden(page)).toBeDisabled(); // kein zweiter Abruf derselben Seite

  seite2.release(anschluss(120));
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(mehrLaden(page)).toBeEnabled();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49"]);
});

test("Nachladen scheitert: die geladenen Zeilen bleiben stehen, nur ein Fehler-Toast", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  api.stub(USERS, DB_FEHLER);
  await mehrLaden(page).click();

  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(zeilen(page)).toHaveCount(50);
  await expect(zeilen(page).first()).toHaveText("nutzer1@example.org");
  await expect(page.locator("#result-count")).toHaveText("50 von 51");
});

test("Nach einem gescheiterten Nachladen ist „Mehr laden“ wieder frei: der nächste Versuch holt dieselbe Seite", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  api.stub(USERS, DB_FEHLER);
  await mehrLaden(page).click();
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(mehrLaden(page)).toBeEnabled();

  api.stub(USERS, geblaettert(51));
  await mehrLaden(page).click();
  await expect(page.locator("#result-count")).toHaveText("51 von 51");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "49"]);
});

test("Liefert „Mehr laden“ nur die Anschlusszeile bei unveränderter Gesamtzahl, bleiben die geladenen Zeilen stehen", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const seite2 = hold();
  api.stub(USERS, seite2.answer);
  await mehrLaden(page).click();
  await expect(mehrLaden(page)).toBeDisabled();

  // Die API zählt und liest in zwei Abfragen — fällt dazwischen nutzer51 weg, passt die Seite nicht zur Zahl.
  seite2.release({ json: liste(empfaenger(50, 1), 51, 51, 49) });
  await expect(mehrLaden(page)).toBeEnabled(); // die Antwort ist verarbeitet
  await expect(zeilen(page)).toHaveText(adressen(empfaenger(1, 50))); // nutzer50 steht nicht zweimal da
  await expect(page.locator("#result-count")).toHaveText("50 von 51");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49"]); // kein Neuladen: die Liste schließt an
});

test("Tastatur: nach „Mehr laden“ liegt der Fokus wieder auf dem Knopf — die nächste Eingabetaste lädt die nächste Seite", async ({ page, api }) => {
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? seite2.answer() : geblaettert(120)(call)));
  await oeffne(page, "50 von 120");
  await ladeMehrMitEnter(page);

  seite2.release(anschluss(120));
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(mehrLaden(page)).toBeFocused(); // sonst lüde ein zweites Enter nichts, und Tab ginge am Knopf vorbei
  await page.keyboard.press("Enter");
  await expect(page.locator("#result-count")).toHaveText("120 von 120");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "99"]);
});

test("Nach „Mehr laden“ springt die Seite nicht: die neuen Zeilen schließen dort an, wo der Knopf war", async ({ page, api }) => {
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? seite2.answer() : geblaettert(120)(call)));
  await oeffne(page, "50 von 120");
  await mehrLaden(page).click(); // auch ein Mausklick setzt den Fokus auf den Knopf …
  await expect(page.locator("body")).toBeFocused(); // … und die Sperre nimmt ihn wieder

  seite2.release(anschluss(120));
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(mehrLaden(page)).toBeFocused();
  // Der Knopf ist mit den 50 neuen Zeilen nach unten gewandert — die Seite folgt ihm nicht.
  await expect(mehrLaden(page)).not.toBeInViewport();
  await expect(zeile(page, "nutzer51@example.org")).toBeInViewport();
});

test("Tastatur: auch nach einem gescheiterten Nachladen liegt der Fokus wieder auf „Mehr laden“ — die Eingabetaste versucht es erneut", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const seite2 = hold();
  api.stub(USERS, seite2.answer);
  await ladeMehrMitEnter(page);

  seite2.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(mehrLaden(page)).toBeFocused();
  api.stub(USERS, geblaettert(51));
  await page.keyboard.press("Enter");
  await expect(page.locator("#result-count")).toHaveText("51 von 51");
});

test("Tastatur: auch wenn „Mehr laden“ die Liste von vorn lädt, liegt der Fokus danach wieder auf dem Knopf", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? seite2.answer() : geblaettert(121)(call)));
  await ladeMehrMitEnter(page);

  seite2.release(anschluss(121)); // ein Empfänger mehr — die Seite lädt von vorn
  await expect(page.locator("#result-count")).toHaveText("50 von 121");
  await expect(mehrLaden(page)).toBeFocused();
});

test("Tastatur: wer während des Nachladens ins Filterfeld gewechselt ist, behält dort den Fokus", async ({ page, api }) => {
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? seite2.answer() : geblaettert(120)(call)));
  await oeffne(page, "50 von 120");
  await ladeMehrMitEnter(page);
  await filterfeld(page).click();

  seite2.release(anschluss(120));
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(filterfeld(page)).toBeFocused(); // nicht auf den Knopf gezogen — das nächste Leerzeichen lüde sonst nach
  await page.keyboard.type("ida ");
  await expect(filterfeld(page)).toHaveValue("ida ");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49"]);
});

test("Lädt eine Suche, während der Fokus auf der Seite liegt, zieht „Mehr laden“ ihn nicht an sich", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  await mehrLaden(page).click(); // der Knopf war schon einmal das zuletzt Bediente
  await expect(page.locator("#result-count")).toHaveText("100 von 120");

  api.stub(USERS, geblaettert(70));
  await filterfeld(page).fill("nutzer");
  await page.getByRole("heading", { name: "Rollen verwalten" }).click(); // Klick neben das Feld: der Fokus liegt auf der Seite
  await expect(page.locator("body")).toBeFocused();
  await page.clock.runFor(250);
  await expect(page.locator("#result-count")).toHaveText("50 von 70");
  await expect(mehrLaden(page)).toBeVisible();
  await expect(page.locator("body")).toBeFocused(); // zurück bekommt den Fokus nur, wer ihn hatte
});

test("Race: eine von der Suche überholte „Mehr laden“-Antwort zieht den Fokus nicht auf den Knopf", async ({ page, api }) => {
  const seite2 = hold();
  api.stub(USERS, (call) => (call.query.query === "nutzer" ? geblaettert(70)(call)
    : call.query.offset === "49" ? seite2.answer() : geblaettert(120)(call)));
  await oeffne(page, "50 von 120");
  await ladeMehrMitEnter(page); // unterwegs (zurückgehalten) — der Knopf hatte den Fokus und ist das zuletzt Bediente
  await filterfeld(page).fill("nutzer");
  await page.getByRole("heading", { name: "Rollen verwalten" }).click(); // Klick neben das Feld: der Fokus liegt auf der Seite
  await page.clock.runFor(250);
  await expect(page.locator("#result-count")).toHaveText("50 von 70");
  await expect(mehrLaden(page)).toBeEnabled(); // sichtbar und frei — er nähme den Fokus an

  seite2.release(anschluss(120));
  await api.sync();
  await expect(page.locator("body")).toBeFocused(); // die Liste, für die er geladen hat, gibt es nicht mehr
  await expect(page.locator("#result-count")).toHaveText("50 von 70");
});

test("Tastatur: wer nach dem Umschalten „Mehr laden“ drückt, bekommt den Fokus dorthin zurück — die Antwort auf das Umschalten zieht ihn nicht auf die Checkbox", async ({ page, api }) => {
  const put = hold();
  const seite2 = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? seite2.answer() : geblaettert(120)(call)),
    [VERGEBEN_NUTZER_1]: put.answer,
  });
  await oeffne(page, "50 von 120");
  await schalteMitLeertaste(page, NUTZER_1.email);
  await ladeMehrMitEnter(page);

  put.release({ json: { ...NUTZER_1, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(page.locator("body")).toBeFocused(); // läge er auf der Checkbox, nähme die nächste Leertaste das Recht wieder
  seite2.release(anschluss(120));
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(mehrLaden(page)).toBeFocused();
});

test("Tastatur: wer während des Nachladens eine Checkbox umschaltet, bekommt den Fokus dorthin zurück — „Mehr laden“ zieht ihn nicht an sich", async ({ page, api }) => {
  const put = hold();
  const seite2 = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? seite2.answer() : geblaettert(120)(call)),
    [VERGEBEN_NUTZER_1]: put.answer,
  });
  await oeffne(page, "50 von 120");
  await ladeMehrMitEnter(page);
  await schalteMitLeertaste(page, NUTZER_1.email);

  seite2.release(anschluss(120));
  await expect(page.locator("#result-count")).toHaveText("100 von 120");
  await expect(page.locator("body")).toBeFocused(); // zuletzt bedient wurde die Checkbox, nicht der Knopf
  put.release({ json: { ...NUTZER_1, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(recht(page, NUTZER_1.email)).toBeFocused();
});

test("Tastatur: lädt „Mehr laden“ die Liste während des Umschaltens von vorn, bekommt die Checkbox desselben Kontos in der neuen Liste den Fokus zurück", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const vonVorn = hold();
  const put = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? vonVorn.answer() : geblaettert(52)(call)),
    [VERGEBEN_NUTZER_1]: put.answer,
  });
  await ladeMehrMitEnter(page); // die nächste Seite meldet 52 statt 51 …
  await expect.poll(() => api.calls(USERS)).toHaveLength(3); // … das Neuladen von vorn ist unterwegs (zurückgehalten)
  await schalteMitLeertaste(page, NUTZER_1.email);
  vonVorn.release({ json: liste(empfaenger(1, 50), 52) }); // alle Zeilen sind ersetzt, auch die bediente
  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await expect(page.locator("body")).toBeFocused(); // zuletzt bedient wurde die Checkbox, nicht der Knopf

  put.release({ json: { ...NUTZER_1, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(recht(page, NUTZER_1.email)).toBeFocused(); // sonst müsste man die Zeile mit Tab neu suchen
  await expect(recht(page, NUTZER_1.email)).toBeChecked();
});

test("Tastatur: wer nach dem Umschalten „Mehr laden“ drückt und damit die Liste von vorn lädt, behält den Fokus auf dem Knopf — die Antwort auf das Umschalten zieht ihn nicht auf die neu gezeichnete Checkbox", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const vonVorn = hold();
  const put = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? vonVorn.answer() : geblaettert(52)(call)),
    [VERGEBEN_NUTZER_1]: put.answer,
  });
  await schalteMitLeertaste(page, NUTZER_1.email); // unterwegs (zurückgehalten)
  await ladeMehrMitEnter(page); // die nächste Seite meldet 52 statt 51 …
  await expect.poll(() => api.calls(USERS)).toHaveLength(3); // … das Neuladen von vorn ist unterwegs (zurückgehalten)
  vonVorn.release({ json: liste(empfaenger(1, 50), 52) }); // alle Zeilen sind ersetzt, auch die umgeschaltete
  await expect(page.locator("#result-count")).toHaveText("50 von 52");
  await expect(mehrLaden(page)).toBeFocused(); // zuletzt bedient wurde der Knopf, nicht die Checkbox

  put.release({ json: { ...NUTZER_1, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(recht(page, NUTZER_1.email)).toBeChecked();
  await expect(recht(page, NUTZER_1.email)).toBeEnabled();
  await expect(mehrLaden(page)).toBeFocused(); // läge er auf der Checkbox, nähme die nächste Leertaste das Recht wieder
});

test("Tastatur: wer während einer Umschaltung eine Zeile weitergeht, behält dort den Fokus, auch wenn „Mehr laden“ inzwischen vergeblich von vorn lädt — die Leertaste gilt dieser Zeile", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const seite2 = hold();
  const put = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? GATEWAY : seite2.answer()),
    [VERGEBEN_NUTZER_1]: put.answer,
    [VERGEBEN_NUTZER_2]: { json: { ...NUTZER_2, is_admin: true } },
  });
  await ladeMehrMitEnter(page); // Seite 2 ist unterwegs (zurückgehalten) …
  await schalteMitLeertaste(page, NUTZER_1.email); // … nutzer1 wird gespeichert (zurückgehalten) …
  await recht(page, NUTZER_2.email).focus(); // … und der Admin ist schon eine Zeile weiter

  seite2.release(anschluss(52)); // 52 statt 51: von vorn — und das scheitert
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(recht(page, NUTZER_2.email)).toBeFocused(); // die Zeilen stehen noch, also auch der Fokus
  put.release({ json: { ...NUTZER_1, is_admin: true } });
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await expect(recht(page, NUTZER_1.email)).toBeChecked();
  await expect(recht(page, NUTZER_2.email)).toBeFocused(); // nicht zurück auf nutzer1 gesprungen
  await page.keyboard.press("Space"); // läge der Fokus auf nutzer1, nähme sie ihm das eben vergebene Recht wieder
  await expectToast(page, "Adminrecht vergeben: nutzer2@example.org");
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN_NUTZER_1, VERGEBEN_NUTZER_2]);
});

test("Tastatur: wer während des Nachladens in die Tabelle wechselt, behält dort den Fokus, auch wenn „Mehr laden“ vergeblich von vorn lädt — der Knopf zieht ihn nicht an sich", async ({ page, api }) => {
  api.stub(USERS, geblaettert(51));
  await oeffne(page, "50 von 51");
  const seite2 = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "0" ? GATEWAY : seite2.answer()),
    [VERGEBEN_NUTZER_1]: { json: { ...NUTZER_1, is_admin: true } },
  });
  await ladeMehrMitEnter(page);
  await recht(page, NUTZER_1.email).focus(); // weiter in die Tabelle, ohne umzuschalten

  seite2.release(anschluss(52)); // 52 statt 51: von vorn — und das scheitert
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(recht(page, NUTZER_1.email)).toBeFocused(); // die Zeilen stehen noch, also auch der Fokus
  await page.keyboard.press("Space"); // läge er auf dem Knopf, lüde sie nach, statt umzuschalten
  await expectToast(page, "Adminrecht vergeben: nutzer1@example.org");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("Ohne Adminrecht: Absage statt Liste, das Filterfeld bleibt gesperrt, keine Admin-Anfrage", async ({ page, api }) => {
  api.stub(ME, { json: me() });
  await page.goto("/rollen.html");

  await expect(page.locator("#users-body")).toHaveText(ABSAGE);
  await expect(filterfeld(page)).toBeDisabled();
  await expect(page.locator("#result-count")).toHaveText("");
  await expect(mehrLaden(page)).toBeHidden();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);
});

test("Adminrecht zwischen /me und Liste entzogen (403 NOT_ADMIN): dieselbe Absage, kein Fehler-Toast", async ({ page, api }) => {
  api.stub(USERS, KEIN_ADMIN);
  await page.goto("/rollen.html");

  await expect(page.locator("#users-body")).toHaveText(ABSAGE);
  await expect(filterfeld(page)).toBeDisabled(); // init() hatte es schon freigegeben
  await keinToast(page);
});

test("Adminrecht entzogen, während die Seite offen ist: „Mehr laden“ räumt die Liste und zeigt die Absage", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  api.stub(USERS, KEIN_ADMIN);
  await mehrLaden(page).click();

  await expect(page.locator("#users-body")).toHaveText(ABSAGE);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(filterfeld(page)).toBeDisabled();
  await expect(page.locator("#result-count")).toHaveText("");
  await expect(mehrLaden(page)).toBeHidden();
  await keinToast(page);
});

test("Die Liste lädt nicht (500): Fehlermeldung in Tabelle und Toast, nichts zum Nachladen", async ({ page, api }) => {
  api.stub(USERS, DB_FEHLER);
  await page.goto("/rollen.html");

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Datenbank nicht erreichbar");
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(mehrLaden(page)).toBeHidden(); // es gibt nichts, woran sich anhängen ließe
});

test("Nach einem Ladefehler lädt eine neue Suche die Liste", async ({ page, api }) => {
  api.stub(USERS, DB_FEHLER);
  await page.goto("/rollen.html");
  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Datenbank nicht erreichbar");

  api.stub(USERS, { json: liste([MAX]) });
  await suche(page, "max");
  await expect(zeilen(page)).toHaveText(["max@example.org"]); // die Fehlermeldung ist ersetzt
  await expect(page.locator("#result-count")).toHaveText("1 von 1");
});

test("Scheitert eine Suche, verschwinden Zähler und „Mehr laden“ der alten Liste — an die Fehlermeldung lässt sich nichts anhängen", async ({ page, api }) => {
  api.stub(USERS, geblaettert(120));
  await oeffne(page, "50 von 120");
  await expect(mehrLaden(page)).toBeVisible();
  api.stub(USERS, GATEWAY);
  await suche(page, "max");

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 502)");
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(page.locator("#result-count")).toHaveText(""); // nicht mehr „50 von 120“ — die Liste ist weg
  await expect(mehrLaden(page)).toBeHidden(); // ein Klick fragte offset 0 an und hängte Zeilen UNTER die Fehlermeldung
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, { query: "max", limit: "50", offset: "0" }]);
});

test("/me scheitert (500): Fehlermeldung in Tabelle und Toast, das Filterfeld bleibt gesperrt", async ({ page, api }) => {
  api.stub(ME, DB_FEHLER);
  await page.goto("/rollen.html");

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Datenbank nicht erreichbar");
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await expect(filterfeld(page)).toBeDisabled();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);
});

test("Ohne Sitzung: Weiterleitung zum Login mit next=/rollen.html, keine Admin-Anfrage", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/rollen.html");

  await expect(page).toHaveURL("/auth/login?next=%2Frollen.html");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]);
  expect(api.calls(LOGIN)[0].query).toEqual({ next: "/rollen.html" });
});

test("Sitzung läuft vor dem Klick ab (401): Weiterleitung zum Login mit next=/rollen.html", async ({ page, api }) => {
  api.stub({ [VERGEBEN]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await recht(page, MAX.email).click();

  await expect(page).toHaveURL("/auth/login?next=%2Frollen.html");
  await api.sync();
  expect(aenderungen(api)).toEqual([VERGEBEN]);
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/rollen.html" }]);
});

test("Die E-Mail-Adresse bleibt Text: Zeile, Name der Checkbox und Toast erzeugen kein Element", async ({ page, api }) => {
  const boese = user({ id: 12, email: XSS });
  api.stub({ [USERS]: { json: liste([boese]) }, [VERGEBEN]: { json: { ...boese, is_admin: true } } });
  await oeffne(page, "1 von 1");

  await expect(zeilen(page)).toHaveText([XSS]);
  await recht(page, XSS).click();
  await expectToast(page, "Adminrecht vergeben: " + XSS);
  await expect(zeilen(page)).toHaveText([XSS]); // auch die Zeile, die jetzt der Antwort folgt
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("Der Fehlertext der API bleibt Text: Tabelle und Toast erzeugen kein Element", async ({ page, api }) => {
  api.stub(USERS, fehler(500, "INTERNAL", XSS));
  await page.goto("/rollen.html");

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: " + XSS);
  await expectToast(page, XSS, { error: true });
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("Auch die Gesamtzahl der API bleibt Text: der Zähler erzeugt kein Element", async ({ page, api }) => {
  api.stub(USERS, { json: liste([MAX], XSS) });
  await oeffne(page, "1 von " + XSS);

  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("antwortet statt der API jemand mit 200 und HTML, liest der Admin eine deutsche Fehlermeldung — keine Skriptmeldung des Browsers", async ({ page, api }) => {
  api.stub(USERS, ANMELDESEITE);
  await page.goto("/rollen.html");

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: " + KEINE_API_ANTWORT);
  await expectToast(page, KEINE_API_ANTWORT, { error: true });
});
