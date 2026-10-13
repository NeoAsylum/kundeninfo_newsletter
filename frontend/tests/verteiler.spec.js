/* verteiler.html + verteiler.js: Verteiler anlegen, bearbeiten, (de)aktivieren und löschen (Admin). */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const {
  me, admin, adminTopic, fehler, NICHT_ANGEMELDET, KEIN_ADMIN, LOGIN_STUB, GATEWAY, ANMELDESEITE, KEINE_API_ANTWORT,
  KEINE_VERBINDUNG, XSS,
} = require("./daten");

const ME = "GET /api/v1/me";
const LIST = "GET /api/v1/admin/topics";
const CREATE = "POST /api/v1/admin/topics";
const PATCH = "PATCH /api/v1/admin/topics/sap";
const DELETE = "DELETE /api/v1/admin/topics/sap";
const PATCH_NETZ = "PATCH /api/v1/admin/topics/netzwerk";
const DELETE_NETZ = "DELETE /api/v1/admin/topics/netzwerk";
const LOGIN = "GET /auth/login";

// Ein zweiter Verteiler: in der Liste neben „SAP Produktion“ oder als der neu angelegte.
const NETZ = adminTopic({ id: "netzwerk", name: "Netzwerk", description: null });
const ANGELEGT = { status: 201, json: NETZ };
// Ein weiterer: Er wird in einem Test neu angelegt, während anderes noch läuft.
const TELEFONIE = adminTopic({ id: "telefonie", name: "Telefonie", description: null });
// Eine Liste, die weit über das Fenster hinausreicht. Deaktiviert rückt „Verteiler 02“ ans Ende: Die API sortiert so.
const VIELE = Array.from({ length: 40 }, (_, nr) => adminTopic({ id: "v" + nr, name: "Verteiler " + String(nr).padStart(2, "0") }));
const VIELE_02_AUS = [...VIELE.filter((verteiler) => verteiler.id !== "v2"), { ...VIELE[2], is_active: false }];
const PATCH_02 = "PATCH /api/v1/admin/topics/v2";
// Slug aus der Zeit der SQL-Pflege: passt nicht ins heutige Muster und braucht URL-Kodierung.
const KRUMM = adminTopic({ id: "büro/nord 1", name: "Büro Nord" });
const KRUMM_PFAD = "/api/v1/admin/topics/b%C3%BCro%2Fnord%201";
const DB_FEHLER = fehler(500, "INTERNAL", "Datenbank nicht erreichbar");
const KEINE_BERECHTIGUNG =
  "Für die Verteiler-Verwaltung fehlt dir die Berechtigung — sie ist dem im Portal vergebenen Adminrecht vorbehalten.";
const SITZUNG_ABGELAUFEN =
  "Sitzung abgelaufen — die Eingabe bleibt stehen. Bitte in einem zweiten Tab neu anmelden und erneut speichern.";
const SITZUNG_ABGELAUFEN_AKTION =
  "Sitzung abgelaufen — die Eingabe in der Maske bleibt stehen. Bitte in einem zweiten Tab neu anmelden und die Aktion wiederholen.";
// So meldet app.js eine abgelaufene Sitzung, wenn es zum Login weiterleitet — und wenn der Schleifenschutz das verhindert.
const WEITERLEITUNG = "Nicht angemeldet — Weiterleitung zum Login";
const COOKIE_HINWEIS = "Anmeldung fehlgeschlagen — bitte Cookies zulassen und die Seite neu laden.";
const SLUG_VERGEBEN = fehler(409, "TOPIC_EXISTS", "Der Slug „netzwerk“ ist bereits vergeben (Verteiler „Netzwerk alt“)");
const NAMENSREGEL = "Der Name muss 2 bis 120 Zeichen lang sein.";
const SLUGREGEL =
  "Der Slug muss 2 bis 64 Zeichen lang sein, mit einem Kleinbuchstaben oder einer Ziffer beginnen " +
  "und darf sonst nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.";
const PFLICHT_ERKLAERUNG =
  "Pflicht-Verteiler: Jeder aktive Empfänger ist implizit dabei, es gibt keine Abo-Zeilen zum Zählen.";
const KEINE_ABOS = "Es hängen keine Abos daran.";

test.beforeEach(async ({ api }) => {
  api.stub({
    [ME]: { json: admin() },
    [LIST]: { json: [adminTopic()] },
  });
});

/** Seite öffnen und abwarten, was init() als Letztes zeichnet: den Tabelleninhalt. */
async function oeffne(page, tabelle = /SAP Produktion/) {
  await page.goto("/verteiler.html");
  await expect(page.locator("#verteiler-body")).toHaveText(tabelle);
}

const knopf = (page, name) => page.getByRole("button", { name, exact: true });
const zeile = (page, name) => page.getByRole("row", { name });
/** Der Knopf, der den Verteiler dieser Zeile aus- oder einschaltet — wie er gerade auch heißt. */
const umschalter = (page, name) => zeile(page, name).getByRole("button", { name: /^(Deaktivieren|Aktivieren)$/ });
/** Die Knöpfe der Zeile, die gerade gesperrt (true) oder bedienbar (false) sind — jede Zeile hat drei. */
const zeilenKnoepfe = (page, name, gesperrt) => zeile(page, name).getByRole("button", { disabled: gesperrt });
const aus = (verteiler) => ({ ...verteiler, is_active: false });

/** Einen Zeilen-Knopf mit der Eingabetaste auslösen und abwarten, bis er gesperrt ist und den Fokus abgegeben hat —
 *  sonst bewiese „der Fokus ist wieder da“ nichts über die Seite. */
async function loeseMitEnterAus(page, button) {
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
}

/** „SAP Produktion“ bearbeiten und speichern — die Antwort hält der Test zurück. Währenddessen macht der Admin weiter. */
async function speichereSapMitHaengenderAntwort(page, api) {
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: patch.answer });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Name").fill("SAP Betrieb");
  await knopf(page, "Speichern").click();
  await expect(knopf(page, "Speichern")).toBeDisabled(); // die Anfrage für „SAP Produktion“ läuft
  api.stub(LIST, { json: [adminTopic({ name: "SAP Betrieb" }), NETZ] }); // so sieht die Liste nach dem Speichern aus
  return { release: () => patch.release({ json: adminTopic({ name: "SAP Betrieb" }) }) };
}

/** Zwei Umschaltungen kurz nacheinander laden die Liste zweimal neu. Die ERSTE Abfrage hängt noch, wenn die zweite
 *  den Endstand (beide inaktiv) schon gezeichnet hat — ihre Antwort gibt der Test danach frei. */
async function ueberholeListenabfrage(page, api) {
  const alt = hold();
  let abruf = 0;
  api.stub({
    // 1. Abruf: Start · 2.: nach dem ersten Umschalten, hängt · 3.: nach dem zweiten, kommt sofort
    [LIST]: () => [{ json: [adminTopic(), NETZ] }, alt.answer(), { json: [aus(adminTopic()), aus(NETZ)] }][abruf++],
    [PATCH]: { json: aus(adminTopic()) },
    [PATCH_NETZ]: { json: aus(NETZ) },
  });
  await oeffne(page);
  await umschalter(page, "SAP Produktion").click();
  await umschalter(page, "Netzwerk").click();
  await expect(page.locator("#anzahl")).toHaveText("2 Verteiler, 2 davon inaktiv");
  return alt;
}

/** Die Rückfrage vor dem Löschen; `verlust` ist der Satz darüber, was mit verloren geht. */
const frage = (name, slug, verlust) =>
  "Verteiler „" + name + "“ (" + slug + ") endgültig löschen?\n\n" + verlust +
  "\n\nDas Löschen selbst ist nicht rückgängig zu machen.";
const abosVerloren = (anzahl) =>
  anzahl + " Abo(s) gehen dabei verloren und sind nicht wiederherstellbar — die Empfänger müssten sich neu eintragen.";

/** Die Maske lehnt jeden dieser Slugs ab: Hinweis, Fokus zurück im Slug-Feld — und es geht kein POST raus. */
async function slugsWerdenAbgelehnt(page, api, slugs) {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  for (const slug of slugs) {
    await page.getByLabel("Slug").fill(slug);
    await knopf(page, "Speichern").click();
    await expectToast(page, SLUGREGEL, { error: true });
    await expect(page.getByLabel("Slug")).toBeFocused();
    await page.clock.runFor(5000); // Toast ausblenden: der nächste Durchlauf muss einen NEUEN zeigen
    await expect(page.locator("#toast")).not.toContainClass("show");
  }
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
}

/* ---------- Liste ---------- */

test("die Liste zeigt je Verteiler eine Zeile mit Name, Slug, Beschreibung und beiden Zählern", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ subscriber_count: 12, dispatch_count: 3 }), NETZ] });
  await oeffne(page);

  await expect(zeile(page, "SAP Produktion").getByRole("cell"))
    .toHaveText([/^SAP Produktion/, "Störungen im SAP", "12", "3", /Löschen$/]);
  await expect(zeile(page, "SAP Produktion").getByText("sap", { exact: true })).toBeVisible(); // der Slug unter dem Namen
  // Ohne Beschreibung steht ein Strich — keine leere Zelle und kein „null“.
  await expect(zeile(page, "Netzwerk").getByRole("cell")).toHaveText([/^Netzwerk/, "–", "0", "0", /Löschen$/]);
  await expect(zeile(page, "Netzwerk").getByText("netzwerk", { exact: true })).toBeVisible();
  await expect(page.locator("#verteiler-body").getByRole("row")).toHaveCount(2);
  await expect(page.locator("#anzahl")).toHaveText("2 Verteiler");
});

test("auch eine als Leertext gelieferte Beschreibung steht in der Liste als Strich", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ description: "" })] }); // z. B. per SQL angelegt, nicht NULL
  await oeffne(page);

  await expect(zeile(page, "SAP Produktion").getByRole("cell")).toHaveText([/^SAP Produktion/, "–", "0", "0", /Löschen$/]);
});

test("große Zähler stehen in deutscher Schreibweise da (1.234) — auch in einem englisch eingestellten Browser", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ subscriber_count: 1234, dispatch_count: 5678 })] });
  await oeffne(page);

  // Vorbedingung: Dieser Browser schreibt von sich aus NICHT deutsch (playwright.config.js) — sonst bewiese der Test nichts.
  expect(await page.evaluate(() => (1234).toLocaleString()), "der Testbrowser muss von sich aus englisch formatieren").toBe("1,234");
  await expect(zeile(page, "SAP Produktion").getByRole("cell"))
    .toHaveText([/^SAP Produktion/, "Störungen im SAP", "1.234", "5.678", /Löschen$/]);
});

test("solange die Liste lädt, steht „Lade Verteiler …“ in der Tabelle — danach nur noch die Verteiler", async ({ page, api }) => {
  const liste = hold();
  api.stub(LIST, liste.answer);
  await page.goto("/verteiler.html");

  await expect(page.locator("#verteiler-body")).toHaveText("Lade Verteiler …");
  liste.release({ json: [adminTopic(), NETZ] });

  await expect(page.locator("#verteiler-body").getByRole("row")).toHaveText([/^SAP Produktion/, /^Netzwerk/]);
});

test("die Zählzeile nennt, wie viele Verteiler es gibt und wie viele davon inaktiv sind", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic(), aus(NETZ), aus(KRUMM)] });
  await oeffne(page);

  await expect(page.locator("#anzahl")).toHaveText("3 Verteiler, 2 davon inaktiv");
});

test("Pflicht, Inaktiv und laufender Versand stehen als farbige Kennzeichen mit Erklärung am Namen", async ({ page, api }) => {
  api.stub(LIST, { json: [
    adminTopic({ id: "alle", name: "Hausmitteilung", is_mandatory: true }),
    adminTopic({ id: "alt", name: "Altsystem", is_active: false }),
    adminTopic({ id: "mail", name: "E-Mail", has_open_dispatch: true }),
    adminTopic(),
  ] });
  await oeffne(page);

  const pflicht = zeile(page, "Hausmitteilung").getByText("Pflicht", { exact: true });
  const inaktiv = zeile(page, "Altsystem").getByText("Inaktiv", { exact: true });
  const versand = zeile(page, "E-Mail").getByText("Versand läuft", { exact: true });
  await expect(pflicht).toHaveAttribute("title", "Gilt automatisch für alle aktiven Empfänger und ist nicht abbestellbar");
  await expect(inaktiv).toHaveAttribute("title", /erscheint weder in der Abo-Maske noch in der Versand-Auswahl/);
  await expect(versand).toHaveAttribute("title", /^Umbenennen ist gesperrt, bis der Versand abgeschlossen ist/);
  // Farbig hinterlegt — nicht bloß fett gesetzter Text ohne Hintergrund.
  for (const marke of [pflicht, inaktiv, versand]) await expect(marke).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // Genau diese drei: der gewöhnliche Verteiler „SAP Produktion“ trägt kein Kennzeichen.
  await expect(page.getByText(/^(Pflicht|Inaktiv|Versand läuft)$/)).toHaveText(["Pflicht", "Inaktiv", "Versand läuft"]);
});

test("ein Verteiler, der Pflicht und inaktiv ist und einen offenen Versand hat, trägt alle drei Kennzeichen", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ is_mandatory: true, is_active: false, has_open_dispatch: true })] });
  await oeffne(page);

  await expect(zeile(page, "SAP Produktion").getByText(/^(Pflicht|Inaktiv|Versand läuft)$/))
    .toHaveText(["Pflicht", "Inaktiv", "Versand läuft"]);
});

test("ein aktiver Verteiler bietet „Deaktivieren“ an, ein inaktiver „Aktivieren“", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });
  await oeffne(page);

  await expect(zeile(page, "SAP Produktion").getByRole("button")).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await expect(zeile(page, "Netzwerk").getByRole("button")).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
});

test("ein inaktiver Verteiler steht abgeblendet in der Liste, ein aktiver nicht", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });
  await oeffne(page);

  await expect(zeile(page, "Netzwerk").getByRole("cell", { name: "–", exact: true })).toHaveCSS("opacity", /^0\.\d+$/);
  await expect(zeile(page, "SAP Produktion").getByRole("cell", { name: "Störungen im SAP" })).toHaveCSS("opacity", "1");
});

test("Pflicht-Verteiler zeigen bei den Abos einen Strich mit Erklärung statt einer irreführenden 0", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ is_mandatory: true })] });
  await oeffne(page);

  await expect(zeile(page, "SAP Produktion").getByRole("cell"))
    .toHaveText([/^SAP Produktion/, "Störungen im SAP", "–", "0", /Löschen$/]);
  await expect(zeile(page, "SAP Produktion").getByRole("cell", { name: "–", exact: true }))
    .toHaveAttribute("title", PFLICHT_ERKLAERUNG);
});

test("schon EINE liegengebliebene Abo-Zeile eines Pflicht-Verteilers nennt der Hinweis — als Abo gezählt wird sie nicht", async ({ page, api }) => {
  const mitAltlast = (anzahl) => PFLICHT_ERKLAERUNG +
    " (" + anzahl + " ältere Abo-Zeile(n) liegen ungenutzt und würden wieder greifen, wenn die Pflicht zurückgenommen wird.)";
  api.stub(LIST, { json: [
    adminTopic({ id: "eine", name: "Hausmitteilung", is_mandatory: true, subscriber_count: 1 }),
    adminTopic({ id: "viele", name: "Früher freiwillig", is_mandatory: true, subscriber_count: 7 }),
  ] });
  await oeffne(page, /Hausmitteilung/);

  await expect(zeile(page, "Hausmitteilung").getByRole("cell", { name: "–", exact: true })).toHaveAttribute("title", mitAltlast(1));
  await expect(zeile(page, "Früher freiwillig").getByRole("cell", { name: "–", exact: true })).toHaveAttribute("title", mitAltlast(7));
  await expect(zeile(page, "Früher freiwillig").getByRole("cell"))
    .toHaveText([/^Früher freiwillig/, "Störungen im SAP", "–", "0", /Löschen$/]);
});

test("Löschen ist gesperrt und begründet, sobald über den Verteiler auch nur EINE Meldung verschickt wurde", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ dispatch_count: 1 }), { ...NETZ, dispatch_count: 3 }] });
  await oeffne(page);

  for (const [name, anzahl] of [["SAP Produktion", 1], ["Netzwerk", 3]]) {
    const gesperrt = zeile(page, name).getByRole("button", { name: "Löschen" });
    await expect(gesperrt).toBeDisabled();
    await expect(gesperrt).toHaveAttribute(
      "title",
      "Nicht löschbar: Über diesen Verteiler wurden bereits " + anzahl + " Meldung(en) verschickt, und die Meldungshistorie " +
      "bleibt unveränderlich. Nimm ihn stattdessen mit „Deaktivieren“ aus Abo-Maske und Versand-Auswahl.");
    await expect(zeile(page, name).getByRole("cell", { name: String(anzahl), exact: true })).toHaveAttribute(
      "title", "Versendete Meldungen — die Historie bleibt unveränderlich und verhindert das Löschen.");
  }
});

test("ohne verschickte Meldungen bleibt Löschen möglich — weder Knopf noch Meldungen-Zelle tragen einen Sperrhinweis", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ subscriber_count: 5 })] });
  await oeffne(page);

  const frei = zeile(page, "SAP Produktion").getByRole("button", { name: "Löschen" });
  await expect(frei).toBeEnabled();
  await expect(frei).not.toHaveAttribute("title");
  await expect(zeile(page, "SAP Produktion").getByRole("cell", { name: "0", exact: true })).not.toHaveAttribute("title");
});

test("eine leere Liste erklärt über die ganze Tabellenbreite, wie der erste Verteiler entsteht", async ({ page, api }) => {
  api.stub(LIST, { json: [] });
  await oeffne(page, "Noch kein Verteiler angelegt — „Neuen Verteiler anlegen“ erstellt den ersten.");

  // Der Hinweis reicht über alle Spalten, statt in die erste gequetscht zu stehen.
  await expect(page.getByRole("columnheader")).toHaveCount(5);
  await expect(page.locator("#verteiler-body").getByRole("cell")).toHaveAttribute("colspan", "5");
  await expect(page.locator("#anzahl")).toHaveText("");
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeVisible();
});

test("die Navigation markiert „Verteiler“ als aktuelle Seite", async ({ page }) => {
  await oeffne(page);

  await expect(page.getByRole("navigation").locator(".active")).toHaveText(["Verteiler"]);
});

/* ---------- Maske öffnen, Slug-Vorschlag ---------- */

test("„Neuen Verteiler anlegen“ öffnet die leere Maske, der Fokus steht im Namen", async ({ page }) => {
  await oeffne(page);
  await expect(page.locator("#form-panel")).toBeHidden();

  await knopf(page, "Neuen Verteiler anlegen").click();

  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByLabel("Slug")).toHaveValue("");
  await expect(page.getByLabel("Slug")).toBeEditable();
  await expect(page.getByText("Wird aus dem Namen vorgeschlagen und ist nach dem Anlegen nicht mehr änderbar.")).toBeVisible();
  await expect(page.getByLabel("Beschreibung")).toHaveValue("");
  await expect(page.getByLabel("Pflicht-Verteiler")).not.toBeChecked();
});

test("unter einer langen Liste holt das Öffnen die Maske ins Fenster — von der Überschrift bis zum Speichern-Knopf", async ({ page, api }) => {
  api.stub(LIST, { json: Array.from({ length: 40 }, (_, nr) => adminTopic({ id: "v" + nr, name: "Verteiler " + nr })) });
  await oeffne(page, /Verteiler 39/);
  await expect(page.getByRole("link", { name: "Datenschutzhinweis" })).not.toBeInViewport(); // das Seitenende liegt weit unter dem Fenster

  await knopf(page, "Neuen Verteiler anlegen").click();

  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeInViewport();
  await expect(knopf(page, "Speichern")).toBeInViewport();
});

test("der Slug wird aus dem Namen vorgeschlagen: Umlaute aufgelöst, alles andere zu EINEM Bindestrich", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Name").fill("  Büro-Geräte / Größe & ÖL (Süd 2)  ");

  await expect(page.getByLabel("Slug")).toHaveValue("buero-geraete-groesse-oel-sued-2");
});

test("der Slug-Vorschlag löst JEDEN Umlaut und jedes ß auf, nicht nur das erste", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Name").fill("Ärger Geräte Öl Größe Über Süd Straße Maße");

  await expect(page.getByLabel("Slug")).toHaveValue("aerger-geraete-oel-groesse-ueber-sued-strasse-masse");
});

test("der Slug-Vorschlag endet nach 64 Zeichen und nie mit einem Bindestrich", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Name").fill("a".repeat(70));
  await expect(page.getByLabel("Slug")).toHaveValue("a".repeat(64));
  // Hier fiele der Schnitt genau hinter den Bindestrich — der bleibt nicht stehen.
  await page.getByLabel("Name").fill("b".repeat(63) + " cde");
  await expect(page.getByLabel("Slug")).toHaveValue("b".repeat(63));
});

test("ein selbst getippter Slug wird vom Namen nicht mehr überschrieben", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");

  await page.getByLabel("Slug").fill("netz");
  await page.getByLabel("Name").fill("Netzwerk und Telefonie");

  await expect(page.getByLabel("Slug")).toHaveValue("netz");
});

test("ein geleertes Slug-Feld gibt den Vorschlag wieder frei", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Slug").fill("eigener-slug");
  await page.getByLabel("Name").fill("Netzwerk");
  await expect(page.getByLabel("Slug")).toHaveValue("eigener-slug");

  await page.getByLabel("Slug").fill("");
  await page.getByLabel("Name").fill("Netzwerk Nord");

  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk-nord");
});

test("auch ein Slug-Feld, in dem nur Leerzeichen stehen, gibt den Vorschlag wieder frei", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Slug").fill("eigener-slug");

  await page.getByLabel("Slug").fill("   ");
  await page.getByLabel("Name").fill("Netzwerk");

  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
});

test("eine neu geöffnete Maske schlägt den Slug wieder vor, auch wenn vorher einer von Hand getippt war", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Slug").fill("eigener-slug");
  await knopf(page, "Abbrechen").click();

  await knopf(page, "Neuen Verteiler anlegen").click();
  await expect(page.getByLabel("Slug")).toHaveValue(""); // nichts aus der verworfenen Eingabe
  await page.getByLabel("Name").fill("Netzwerk");

  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
});

/* ---------- Anlegen ---------- */

test("Anlegen sendet Slug, Name, Beschreibung und Pflicht in EINEM POST", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Beschreibung").fill("Router, WLAN und VPN");
  await page.getByLabel("Pflicht-Verteiler").check();

  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json)).toEqual([
    { id: "netzwerk", name: "Netzwerk", description: "Router, WLAN und VPN", is_mandatory: true },
  ]);
  expect(api.calls(CREATE)[0].headers).toMatchObject({ "x-requested-with": "fetch", "content-type": "application/json" });
});

test("nach dem Anlegen ist die Maske zu, die Liste neu geladen und der Fokus wieder auf „Neuen Verteiler anlegen“", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  api.stub(LIST, { json: [adminTopic(), NETZ] });

  await knopf(page, "Speichern").click();

  await expect(zeile(page, "Netzwerk")).toBeVisible();
  await expect(page.locator("#anzahl")).toHaveText("2 Verteiler");
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
});

test("Anlegen schneidet Leerraum ab und sendet eine leere Beschreibung als null", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("  Netzwerk  ");
  await page.getByLabel("Slug").fill("  netz ");
  await page.getByLabel("Beschreibung").fill("  \n ");

  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json)).toEqual([
    { id: "netz", name: "Netzwerk", description: null, is_mandatory: false },
  ]);
});

/* ---------- Prüfung vor dem Senden ---------- */

test("ein Name mit nur einem Zeichen wird nicht gesendet: Hinweis, Fokus zurück im Namen", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill(" A ");
  await page.getByLabel("Slug").fill("gueltig");

  await knopf(page, "Speichern").click();

  await expectToast(page, NAMENSREGEL, { error: true });
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveValue(" A "); // die Eingabe bleibt zum Korrigieren stehen
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
});

test("ein Name mit genau 2 und einer mit genau 120 Zeichen wird angenommen", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);

  for (const name of ["IT", "N".repeat(120)]) {
    await knopf(page, "Neuen Verteiler anlegen").click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Slug").fill("kurz");
    await knopf(page, "Speichern").click();
    await expect(page.locator("#form-panel")).toBeHidden();
  }

  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.name)).toEqual(["IT", "N".repeat(120)]);
});

test("mehr als 120 Zeichen nimmt das Namensfeld nicht an", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Name").fill("N".repeat(121));

  await expect(page.getByLabel("Name")).toHaveValue("N".repeat(120));
});

test("stehen doch mehr als 120 Zeichen im Namensfeld, wird nicht gesendet: Hinweis, Fokus zurück im Namen", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Slug").fill("lang");
  // Am maxlength des Feldes vorbei kommt nur ein Skript (Erweiterung, Lesezeichen-Skript) — die Prüfung hält auch dann.
  await page.getByLabel("Name").evaluate((feld) => { feld.value = "N".repeat(121); });

  await knopf(page, "Speichern").click();

  await expectToast(page, NAMENSREGEL, { error: true });
  await expect(page.getByLabel("Name")).toBeFocused();
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
});

test("ein ungültiger Slug wird nicht gesendet — leer, zu kurz oder mit falschem ersten Zeichen: Hinweis, Fokus zurück im Slug", async ({ page, api }) => {
  // leer · ein Zeichen · beginnt mit Bindestrich · beginnt mit Großbuchstabe
  await slugsWerdenAbgelehnt(page, api, ["", "n", "-netz", "Netz"]);
});

test("ein ungültiger Slug wird nicht gesendet — Großbuchstabe, Unterstrich, Leerzeichen oder Umlaut mittendrin", async ({ page, api }) => {
  await slugsWerdenAbgelehnt(page, api, ["netzWerk", "netz_1", "netz werk", "bürö"]);
});

test("mehr als 64 Zeichen nimmt das Slug-Feld nicht an", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Slug").fill("s".repeat(65));

  await expect(page.getByLabel("Slug")).toHaveValue("s".repeat(64));
});

test("stehen doch mehr als 64 Zeichen im Slug-Feld, wird nicht gesendet: Hinweis, Fokus zurück im Slug", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Slug").evaluate((feld) => { feld.value = "s".repeat(65); }); // am maxlength des Feldes vorbei

  await knopf(page, "Speichern").click();

  await expectToast(page, SLUGREGEL, { error: true });
  await expect(page.getByLabel("Slug")).toBeFocused();
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
});

test("der kürzeste gültige Slug hat 2 Zeichen und darf mit einer Ziffer beginnen, der längste hat 64", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);

  for (const slug of ["1a", "a-" + "b".repeat(62)]) {
    await knopf(page, "Neuen Verteiler anlegen").click();
    await page.getByLabel("Name").fill("Netzwerk");
    await page.getByLabel("Slug").fill(slug);
    await knopf(page, "Speichern").click();
    await expect(page.locator("#form-panel")).toBeHidden();
  }

  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.id)).toEqual(["1a", "a-" + "b".repeat(62)]);
});

test("mehr als 2000 Zeichen nimmt die Beschreibung nicht an", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Beschreibung").fill("B".repeat(2001));

  await expect(page.getByLabel("Beschreibung")).toHaveJSProperty("textLength", 2000); // das 2001. Zeichen kam nicht an
});

/* ---------- Bearbeiten ---------- */

test("Bearbeiten füllt die Maske mit den Werten des Verteilers; der Slug ist gesperrt und begründet", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ is_mandatory: true })] });
  await oeffne(page);

  await knopf(page, "Bearbeiten").click();

  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Slug")).toHaveValue("sap");
  await expect(page.getByLabel("Slug")).not.toBeEditable();
  await expect(page.getByText("Nicht änderbar: Der Slug ist der Primärschlüssel, auf den alle Abos und alle versendeten Meldungen verweisen.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("SAP Produktion");
  await expect(page.getByLabel("Name")).toBeEditable();
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByText("Erscheint in der Abo-Maske, in der Versand-Auswahl und im Betreff jeder Mail.")).toBeVisible();
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Störungen im SAP");
  await expect(page.getByLabel("Pflicht-Verteiler")).toBeChecked();
});

test("Bearbeiten öffnet den Verteiler der angeklickten Zeile und speichert auf dessen Slug — nicht auf den ersten der Liste", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: { json: adminTopic() }, [PATCH_NETZ]: { json: NETZ } });
  await oeffne(page);

  await zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" }).click();
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await expect(page.getByLabel("Beschreibung")).toHaveValue(""); // „Netzwerk“ hat keine — die von „SAP Produktion“ steht nicht da
  await page.getByLabel("Name").fill("Netzwerk Süd");
  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk Süd“ gespeichert");
  await api.sync();
  expect(api.calls(PATCH_NETZ).map((call) => call.json)).toEqual([{ name: "Netzwerk Süd" }]);
  expect(api.calls(PATCH)).toHaveLength(0);
});

test("Bearbeiten sendet nur, was sich geändert hat — hier allein den Namen; der Slug bleibt stehen", async ({ page, api }) => {
  api.stub(PATCH, { json: adminTopic({ name: "SAP Betrieb" }) });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("SAP Betrieb");
  await expect(page.getByLabel("Slug")).toHaveValue("sap"); // kein neuer Vorschlag: der Slug ist der Schlüssel
  api.stub(LIST, { json: [adminTopic({ name: "SAP Betrieb" })] });

  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „SAP Betrieb“ gespeichert");
  await expect(zeile(page, "SAP Betrieb")).toBeVisible(); // Liste neu geladen
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ name: "SAP Betrieb" }]);
});

test("Bearbeiten sendet nur, was sich geändert hat — hier Beschreibung und Pflicht, nicht den Namen", async ({ page, api }) => {
  api.stub(PATCH, { json: adminTopic({ description: "Alle SAP-Systeme", is_mandatory: true }) });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Beschreibung").fill("Alle SAP-Systeme");
  await page.getByLabel("Pflicht-Verteiler").check();

  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „SAP Produktion“ gespeichert");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ description: "Alle SAP-Systeme", is_mandatory: true }]);
});

test("eine geleerte Beschreibung wird als null gesendet, eine zurückgenommene Pflicht als false", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic({ is_mandatory: true })] }, [PATCH]: { json: adminTopic({ description: null }) } });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Beschreibung").fill("   ");
  await page.getByLabel("Pflicht-Verteiler").uncheck();

  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „SAP Produktion“ gespeichert");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ description: null, is_mandatory: false }]);
});

test("Bearbeiten ohne Änderung sendet nichts, sagt das und schließt die Maske", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("  SAP Produktion "); // Leerraum am Rand ist keine Änderung

  await knopf(page, "Speichern").click();

  await expectToast(page, "Keine Änderung — nichts gespeichert.");
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LIST]); // weder PATCH noch neues Laden
  await knopf(page, "Bearbeiten").click();
  await expect(knopf(page, "Speichern")).toBeEnabled(); // die Maske ist weiter benutzbar
});

test("eine leere Beschreibung zählt nicht als Änderung, auch wenn die API sie als Leertext liefert", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ description: "" })] }); // z. B. per SQL angelegt, nicht NULL
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();

  await knopf(page, "Speichern").click();

  await expectToast(page, "Keine Änderung — nichts gespeichert.");
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(0);
});

test("läuft ein Versand, ist der Name gesperrt und begründet; der Fokus startet in der Beschreibung", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ has_open_dispatch: true })] });
  await oeffne(page);

  await knopf(page, "Bearbeiten").click();

  await expect(page.getByLabel("Name")).toHaveValue("SAP Produktion");
  await expect(page.getByLabel("Name")).not.toBeEditable();
  await expect(page.getByText(
    "Umbenennen gesperrt, solange ein Versand offen ist: Der Meldungstitel wird zur Sendezeit aus dem Betreff " +
    "zurückgerechnet und stünde sonst falsch in den Mails.")).toBeVisible();
  await expect(page.getByLabel("Beschreibung")).toBeFocused();
});

test("auch beim Bearbeiten wird ein zu kurzer Name nicht gesendet", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("S");

  await knopf(page, "Speichern").click();

  await expectToast(page, NAMENSREGEL, { error: true });
  await expect(page.getByLabel("Name")).toBeFocused();
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(0);
});

test("ein alter Slug außerhalb des Musters hindert das Bearbeiten nicht und geht URL-kodiert in den Pfad", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [KRUMM] }, ["PATCH " + KRUMM_PFAD]: { json: KRUMM } });
  await oeffne(page, /Büro Nord/);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("Büro Nord und Süd");

  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Büro Nord und Süd“ gespeichert");
  await api.sync();
  expect(api.calls("PATCH " + KRUMM_PFAD).map((call) => call.json)).toEqual([{ name: "Büro Nord und Süd" }]);
});

test("nach einer Bearbeitung ist die Maske für die Neuanlage leer und frei — Speichern legt neu an, statt zu überschreiben", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic({ is_mandatory: true, has_open_dispatch: true })] }, [CREATE]: ANGELEGT });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await expect(page.getByLabel("Name")).not.toBeEditable();

  await knopf(page, "Neuen Verteiler anlegen").click();
  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
  await expect(page.getByLabel("Slug")).toHaveValue("");
  await expect(page.getByLabel("Slug")).toBeEditable();
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByLabel("Name")).toBeEditable(); // die Sperre des laufenden Versands gilt nicht mehr
  await expect(page.getByLabel("Beschreibung")).toHaveValue("");
  await expect(page.getByLabel("Pflicht-Verteiler")).not.toBeChecked();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json)).toEqual([
    { id: "netzwerk", name: "Netzwerk", description: null, is_mandatory: false },
  ]);
});

/* ---------- Enter, Fehler beim Speichern, Sperre ---------- */

test("Enter im Namensfeld speichert wie der Knopf — das Tippen davor sendet nichts", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();

  await page.getByLabel("Name").pressSequentially("Netzwerk"); // echte Tastendrücke
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
  await page.getByLabel("Name").press("Enter");

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.id)).toEqual(["netzwerk"]);
});

test("Enter im Slug-Feld speichert wie der Knopf", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Slug").fill("netz");

  await page.getByLabel("Slug").press("Enter");

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.id)).toEqual(["netz"]);
});

test("Enter auf dem Pflicht-Haken speichert wie in einem Formular — und schaltet den Haken nicht um", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");

  await page.getByLabel("Pflicht-Verteiler").press("Enter");

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json)).toEqual([
    { id: "netzwerk", name: "Netzwerk", description: null, is_mandatory: false },
  ]);
});

test("Enter in der Beschreibung beginnt eine neue Zeile und speichert nicht", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Beschreibung").fill("Router");

  await page.getByLabel("Beschreibung").press("Enter");
  await page.getByLabel("Beschreibung").pressSequentially("WLAN");

  await expect(page.getByLabel("Beschreibung")).toHaveValue("Router\nWLAN");
  await expect(page.locator("#form-panel")).toBeVisible();
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
});

test("Anlegen scheitert, weil der Slug vergeben ist: Fehlertext der API, die Maske bleibt mit der Eingabe offen", async ({ page, api }) => {
  const vergeben = "Der Slug „netzwerk“ ist bereits vergeben (Verteiler „Netzwerk alt“, derzeit deaktiviert)";
  api.stub(CREATE, fehler(409, "TOPIC_EXISTS", vergeben));
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Beschreibung").fill("Router, WLAN und VPN");
  await page.getByLabel("Pflicht-Verteiler").check();

  await knopf(page, "Speichern").click();

  await expectToast(page, vergeben, { error: true });
  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible(); // die Maske ist nicht zugegangen
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Router, WLAN und VPN");
  await expect(page.getByLabel("Pflicht-Verteiler")).toBeChecked();
  await expect(knopf(page, "Speichern")).toBeEnabled();
  await api.sync();
  expect(api.calls(LIST)).toHaveLength(1); // nichts gespeichert, also auch nichts neu geladen
});

test("Speichern scheitert, weil der Name vergeben ist: die korrigierte Eingabe geht aus derselben Maske als PATCH durch", async ({ page, api }) => {
  const vergeben = "„Netzwerk“ ist schon der Name von Verteiler „netzwerk“ — bitte einen unterscheidbaren Namen wählen";
  api.stub(PATCH, fehler(409, "TOPIC_NAME_EXISTS", vergeben));
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();
  await expectToast(page, vergeben, { error: true });
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible(); // die Maske ist nicht zugegangen
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await expect(knopf(page, "Speichern")).toBeEnabled();

  api.stub(PATCH, { json: adminTopic({ name: "Netzwerk Süd" }) });
  await page.getByLabel("Name").fill("Netzwerk Süd");
  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk Süd“ gespeichert");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ name: "Netzwerk" }, { name: "Netzwerk Süd" }]);
  expect(api.calls(CREATE)).toHaveLength(0); // weiterhin die Bearbeitung, keine Neuanlage
});

test("Speichern ist gesperrt, solange die Anfrage läuft — ein Doppelklick legt nur einmal an", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");

  await knopf(page, "Speichern").dblclick();
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.locator("#form-panel")).toBeVisible(); // die Maske schließt erst mit der Antwort
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(1);
  post.release(ANGELEGT);

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await knopf(page, "Neuen Verteiler anlegen").click();
  await expect(knopf(page, "Speichern")).toBeEnabled(); // für die nächste Eingabe wieder frei
});

test("ein zweites Enter während des laufenden Speicherns legt nicht noch einmal an", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");

  await page.getByLabel("Name").press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await page.getByLabel("Name").press("Enter"); // am gesperrten Knopf vorbei
  await api.sync();
  // Einen zweiten POST beantwortete die API mit 409 „Slug bereits vergeben“ — ein Fehler, obwohl das Anlegen geklappt hat.
  expect(api.calls(CREATE)).toHaveLength(1);
  post.release(ANGELEGT);

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(1);
});

test("auch beim Bearbeiten sendet ein zweites Enter während des laufenden Speicherns kein zweites PATCH", async ({ page, api }) => {
  const patch = hold();
  api.stub(PATCH, patch.answer);
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("SAP Betrieb");

  await page.getByLabel("Name").press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await page.getByLabel("Name").press("Enter");
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(1);
  patch.release({ json: adminTopic({ name: "SAP Betrieb" }) });

  await expectToast(page, "Verteiler „SAP Betrieb“ gespeichert");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ name: "SAP Betrieb" }]);
});

test("während des Speicherns nehmen die Textfelder keine Eingabe an — mit dem Schließen der Maske geht nichts Getipptes verloren", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Name").press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();

  for (const feld of ["Name", "Slug", "Beschreibung"]) {
    await expect(page.getByLabel(feld)).not.toBeEditable();
    await page.getByLabel(feld).focus();
    await page.keyboard.type("x"); // echte Tastendrücke: Sie erreichen das Feld und ändern nichts
  }
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await expect(page.getByLabel("Beschreibung")).toHaveValue("");
  post.release(ANGELEGT);

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await expect(page.locator("#form-panel")).toBeHidden();
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json)).toEqual([
    { id: "netzwerk", name: "Netzwerk", description: null, is_mandatory: false }, // gespeichert ist, was in der Maske stand
  ]);
});

test("während des Speicherns schaltet der Pflicht-Haken nicht um — weder per Klick noch per Leertaste noch über seine Beschriftung", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Name").press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  const haken = page.getByLabel("Pflicht-Verteiler");
  await expect(haken).toBeDisabled(); // als gesperrt ausgezeichnet (aria-disabled) — dass er nichts annimmt, zeigen die Klicks

  await haken.click({ force: true });
  await expect(haken).not.toBeChecked();
  await haken.focus();
  await page.keyboard.press("Space");
  await expect(haken).not.toBeChecked();
  await page.getByText("Pflicht-Verteiler", { exact: true }).click({ force: true });
  await expect(haken).not.toBeChecked();
  post.release(ANGELEGT);

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.is_mandatory)).toEqual([false]);
});

test("während des Speicherns nehmen Felder und Haken weiter den Tastaturfokus an — sie sind schreibgeschützt, nicht abgeschaltet", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();
  await expect(knopf(page, "Speichern")).toBeDisabled();

  for (const feld of ["Slug", "Name", "Beschreibung", "Pflicht-Verteiler"]) {
    await page.getByLabel(feld).focus(); // ein abgeschaltetes Feld (disabled) nähme den Fokus nicht an
    await expect(page.getByLabel(feld)).toBeFocused();
  }
  post.release(ANGELEGT);
  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
});

test("nach einem abgelehnten Speichern nehmen Felder und Haken wieder Eingaben an — die korrigierte Fassung geht durch", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Name").press("Enter");
  await expect(page.getByLabel("Beschreibung")).not.toBeEditable(); // gesperrt, solange gespeichert wird
  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });

  const haken = page.getByLabel("Pflicht-Verteiler");
  await haken.click(); // dieselben drei Wege wie oben — jetzt schaltet jeder um
  await expect(haken).toBeChecked();
  await haken.press("Space");
  await expect(haken).not.toBeChecked();
  await page.getByText("Pflicht-Verteiler", { exact: true }).click();
  await expect(haken).toBeChecked();
  await page.getByLabel("Name").fill("Netzwerk Nord"); // schlägt auch den Slug neu vor
  await page.getByLabel("Beschreibung").fill("Router und WLAN");
  api.stub(CREATE, ANGELEGT);
  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk Nord“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json)).toEqual([
    { id: "netzwerk", name: "Netzwerk", description: null, is_mandatory: false },
    { id: "netzwerk-nord", name: "Netzwerk Nord", description: "Router und WLAN", is_mandatory: true },
  ]);
});

test("nach einem abgelehnten Speichern einer Bearbeitung bleiben der Slug und — bei laufendem Versand — der Name gesperrt, die Beschreibung ist wieder frei", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic({ has_open_dispatch: true })] }, [PATCH]: GATEWAY });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Beschreibung").fill("Alle SAP-Systeme");
  await knopf(page, "Speichern").click();
  await expectToast(page, "Fehler (HTTP 502)", { error: true });

  await expect(page.getByLabel("Slug")).not.toBeEditable();
  await expect(page.getByLabel("Name")).not.toBeEditable();
  await expect(page.getByLabel("Beschreibung")).toBeEditable();
});

test("nach einem abgelehnten Speichern speichert das nächste Enter wieder", async ({ page, api }) => {
  api.stub(CREATE, SLUG_VERGEBEN);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Name").press("Enter");
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });

  api.stub(CREATE, ANGELEGT);
  await page.getByLabel("Slug").fill("netz-2");
  await page.getByLabel("Slug").press("Enter");

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.id)).toEqual(["netzwerk", "netz-2"]);
});

test("eine gehaltene Eingabetaste speichert nur einmal — auch wenn die Ablehnung schon da und Speichern wieder frei ist", async ({ page, api }) => {
  api.stub(CREATE, SLUG_VERGEBEN);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");

  await page.keyboard.down("Enter");
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeEnabled();
  await page.keyboard.down("Enter"); // Tastenwiederholung: die Taste ist noch nicht losgelassen
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");

  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(1);
});

test("eine gehaltene Eingabetaste im Namensfeld legt an, ohne dass die Maske gleich wieder aufgeht", async ({ page, api }) => {
  api.stub(CREATE, ANGELEGT);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");

  await page.keyboard.down("Enter");
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused(); // gespeichert, die Maske ist zu
  await page.keyboard.down("Enter"); // Tastenwiederholung — trifft jetzt „Neuen Verteiler anlegen“
  await page.keyboard.up("Enter");

  await expect(page.locator("#form-panel")).toBeHidden();
  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await page.keyboard.press("Enter"); // ein NEUER Tastendruck öffnet sie
  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
});

test("eine gehaltene Eingabetaste auf „Bearbeiten“ öffnet die Maske nur — sie speichert und schließt sie nicht gleich wieder", async ({ page }) => {
  await oeffne(page);
  await knopf(page, "Bearbeiten").focus();

  await page.keyboard.down("Enter");
  await expect(page.getByLabel("Name")).toBeFocused();
  await page.keyboard.down("Enter"); // Tastenwiederholung — trifft jetzt das Namensfeld
  await page.keyboard.up("Enter");

  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.locator("#toast")).toHaveCount(0); // kein „Keine Änderung — nichts gespeichert.“
});

test("eine gehaltene Eingabetaste in der Beschreibung fügt weiter Zeile um Zeile ein", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Beschreibung").fill("Router");

  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter"); // Tastenwiederholung — in einem Textfeld erwünscht
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");

  await expect(page.getByLabel("Beschreibung")).toHaveValue("Router\n\n\n");
  await api.sync();
  expect(api.calls(CREATE)).toHaveLength(0);
});

/* ---------- Der Admin macht weiter, während das Speichern noch läuft ---------- */

test("öffnet der Admin während des Speicherns einen anderen Verteiler, bleibt dessen Maske offen — samt Eingabe und Fokus", async ({ page, api }) => {
  const erstes = await speichereSapMitHaengenderAntwort(page, api);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Beschreibung").fill("Router und WLAN");

  erstes.release();

  await expectToast(page, "Verteiler „SAP Betrieb“ gespeichert"); // dass gespeichert wurde, erfährt der Admin trotzdem
  await expect(zeile(page, "SAP Betrieb")).toBeVisible(); // und die Liste ist neu geladen
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Router und WLAN");
  await expect(page.getByLabel("Beschreibung")).toBeFocused();
});

test("während das Speichern des ersten Verteilers noch läuft, lässt sich der zweite schon speichern", async ({ page, api }) => {
  const erstes = await speichereSapMitHaengenderAntwort(page, api);
  api.stub(PATCH_NETZ, { json: NETZ });
  await zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Beschreibung").fill("Router und WLAN");

  await expect(knopf(page, "Speichern")).toBeEnabled();
  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk“ gespeichert");
  await expect(page.locator("#form-panel")).toBeHidden();
  await api.sync();
  expect(api.calls(PATCH_NETZ).map((call) => call.json)).toEqual([{ description: "Router und WLAN" }]);
  erstes.release();
  await expectToast(page, "Verteiler „SAP Betrieb“ gespeichert");
});

test("die Antwort auf das erste Speichern gibt „Speichern“ nicht frei, solange das zweite noch läuft", async ({ page, api }) => {
  const erstes = await speichereSapMitHaengenderAntwort(page, api);
  const zweites = hold();
  api.stub(PATCH_NETZ, zweites.answer);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Name").fill("Netzwerk Süd");
  await page.getByLabel("Name").press("Enter"); // das zweite Speichern läuft

  erstes.release();
  await expect(zeile(page, "SAP Betrieb")).toBeVisible(); // die erste Antwort ist verarbeitet, die Liste neu geladen
  await page.getByLabel("Name").press("Enter");
  await api.sync();

  expect(api.calls(PATCH_NETZ)).toHaveLength(1); // kein zweites PATCH für „Netzwerk“
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.getByLabel("Name")).not.toBeEditable(); // auch die Felder gibt erst die eigene Antwort frei
  zweites.release({ json: { ...NETZ, name: "Netzwerk Süd" } });
  await expectToast(page, "Verteiler „Netzwerk Süd“ gespeichert");
  await expect(page.locator("#form-panel")).toBeHidden();
});

test("öffnet der Admin während des Speicherns die Neuanlage, bleibt sie offen und ihr „Speichern“ frei", async ({ page, api }) => {
  const erstes = await speichereSapMitHaengenderAntwort(page, api);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Pflicht-Verteiler").check(); // die Sperre des laufenden Speicherns galt der vorigen Maske
  await page.getByLabel("Name").fill("Telefonie");
  await expect(knopf(page, "Speichern")).toBeEnabled();

  erstes.release();

  await expectToast(page, "Verteiler „SAP Betrieb“ gespeichert");
  await expect(zeile(page, "SAP Betrieb")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Telefonie");
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByLabel("Pflicht-Verteiler")).toBeChecked();
  await expect(knopf(page, "Speichern")).toBeEnabled();
});

test("bricht der Admin während des Speicherns ab und geht in die Liste, holt die späte Antwort den Fokus nicht weg", async ({ page, api }) => {
  const erstes = await speichereSapMitHaengenderAntwort(page, api);
  await knopf(page, "Abbrechen").click();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
  await zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" }).focus(); // weiter in die Liste

  erstes.release();

  await expectToast(page, "Verteiler „SAP Betrieb“ gespeichert"); // gespeichert wurde trotzdem — das sagt der Toast
  await expect(zeile(page, "SAP Betrieb")).toBeVisible();
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" })).toBeFocused();
});

/* ---------- Sitzung läuft beim Speichern ab ---------- */

test("Sitzung läuft beim Anlegen ab (401): kein Sprung zum Login, die Eingabe bleibt stehen", async ({ page, api }) => {
  api.stub({ [CREATE]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Beschreibung").fill("Lange getippte Beschreibung");
  await page.getByLabel("Pflicht-Verteiler").check();

  await knopf(page, "Speichern").click();

  await expectToast(page, SITZUNG_ABGELAUFEN, { error: true });
  await expect(page).toHaveURL("/verteiler.html");
  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Lange getippte Beschreibung");
  await expect(page.getByLabel("Pflicht-Verteiler")).toBeChecked();
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
});

test("Sitzung läuft beim Speichern einer Bearbeitung ab (401): kein Sprung zum Login, die Eingabe bleibt stehen", async ({ page, api }) => {
  api.stub({ [PATCH]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Beschreibung").fill("Lange getippte Beschreibung");

  await knopf(page, "Speichern").click();

  await expectToast(page, SITZUNG_ABGELAUFEN, { error: true });
  await expect(page).toHaveURL("/verteiler.html");
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Lange getippte Beschreibung");
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
});

test("nach abgelaufener Sitzung ist „Speichern“ wieder frei: nach dem Anmelden im zweiten Tab geht derselbe Stand durch", async ({ page, api }) => {
  api.stub({ [CREATE]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();
  await expectToast(page, SITZUNG_ABGELAUFEN, { error: true });

  api.stub(CREATE, ANGELEGT); // inzwischen im zweiten Tab neu angemeldet
  await knopf(page, "Speichern").click();

  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await expect(page.locator("#form-panel")).toBeHidden();
  await api.sync();
  expect(api.calls(CREATE).map((call) => call.json.id)).toEqual(["netzwerk", "netzwerk"]);
  expect(api.calls(LOGIN)).toHaveLength(0);
});

/* ---------- Sitzung läuft bei einer Zeilen-Aktion ab ---------- */

test("Sitzung läuft beim Umschalten ab (401), während die Maske offen ist: kein Sprung zum Login — die Zeile ist wieder frei, Maske und Eingabe bleiben", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Beschreibung").fill("Lange getippte Beschreibung");

  await umschalter(page, "Netzwerk").click();

  await expectToast(page, SITZUNG_ABGELAUFEN_AKTION, { error: true });
  await expect(page).toHaveURL("/verteiler.html");
  await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Lange getippte Beschreibung");
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
  expect(api.calls(LIST)).toHaveLength(1); // nichts geändert, also auch nichts neu geladen
});

test("Sitzung läuft beim Löschen ab (401), während die Maske offen ist: kein Sprung zum Login — Zeile, Maske und Eingabe bleiben", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [DELETE_NETZ]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Name").fill("SAP Betrieb");

  api.confirmNext(true);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click();

  await expectToast(page, SITZUNG_ABGELAUFEN_AKTION, { error: true });
  await expect(page).toHaveURL("/verteiler.html");
  await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("SAP Betrieb");
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
});

test("nach dem Anmelden im zweiten Tab geht dieselbe Zeilen-Aktion durch — die Eingabe in der Maske steht noch", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Telefonie");
  await umschalter(page, "Netzwerk").click();
  await expectToast(page, SITZUNG_ABGELAUFEN_AKTION, { error: true });

  api.stub({ [PATCH_NETZ]: { json: aus(NETZ) }, [LIST]: { json: [adminTopic(), aus(NETZ)] } }); // inzwischen neu angemeldet
  await umschalter(page, "Netzwerk").click();

  await expectToast(page, "„Netzwerk“ deaktiviert");
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren");
  await expect(page.getByLabel("Name")).toHaveValue("Telefonie");
  await api.sync();
  expect(api.calls(PATCH_NETZ).map((call) => call.json)).toEqual([{ is_active: false }, { is_active: false }]);
  expect(api.calls(LOGIN)).toHaveLength(0);
});

test("ohne offene Maske führt eine abgelaufene Sitzung beim Umschalten weiter zum Login", async ({ page, api }) => {
  api.stub({ [PATCH]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);

  await knopf(page, "Deaktivieren").click();

  await expect(page).toHaveURL("/auth/login?next=%2Fverteiler.html");
});

test("ohne offene Maske führt eine abgelaufene Sitzung beim Löschen weiter zum Login", async ({ page, api }) => {
  api.stub({ [DELETE]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);

  api.confirmNext(true);
  await knopf(page, "Löschen").click();

  await expect(page).toHaveURL("/auth/login?next=%2Fverteiler.html");
});

test("auch nach „Abbrechen“ führt eine abgelaufene Sitzung bei einer Zeilen-Aktion wieder zum Login — es steht keine Eingabe mehr auf dem Spiel", async ({ page, api }) => {
  api.stub({ [PATCH]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await knopf(page, "Abbrechen").click();

  await knopf(page, "Deaktivieren").click();

  await expect(page).toHaveURL("/auth/login?next=%2Fverteiler.html");
});

test("ohne offene Maske meldet die Zeilen-Aktion bei abgelaufener Sitzung die Weiterleitung zum Login — ein Sprung, mit next=/verteiler.html", async ({ page, api }) => {
  api.stub({ [PATCH]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } }); // der Login lädt noch: Der Browser steht weiter auf der Seite
  await oeffne(page);

  await knopf(page, "Deaktivieren").click();

  await expectToast(page, WEITERLEITUNG, { error: true });
  await api.sync();
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/verteiler.html" }]);
});

test("ohne offene Maske gilt für die Zeilen-Aktion der Schleifenschutz von app.js: Nach „Zurück“ vom Login steht der Cookie-Hinweis — kein zweiter Sprung", async ({ page, api }) => {
  // Nachgestellt wie in app.spec.js: Der Login kommt nicht (204), die Seite bekommt das Ereignis, mit dem der Browser
  // die Rückkehr aus seinem Cache meldet; die Sitzung lässt sich dabei nicht prüfen (Netz weg).
  api.stub({ [PATCH]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } });
  await oeffne(page);
  await knopf(page, "Deaktivieren").click();
  await expectToast(page, WEITERLEITUNG, { error: true });
  api.stub(ME, { abort: true });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

  await knopf(page, "Deaktivieren").click();

  await expectToast(page, COOKIE_HINWEIS, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
  expect(api.calls(PATCH)).toHaveLength(2);
});

test("schließt „Abbrechen“ die Maske, bevor die 401-Antwort des Umschaltens eintrifft, führt die Antwort zum Login — es steht keine Eingabe mehr auf dem Spiel", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: patch.answer, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await umschalter(page, "Netzwerk").click(); // bei offener Maske abgesetzt — es zählt, wie die Seite bei der Antwort dasteht
  await expect(umschalter(page, "Netzwerk")).toBeDisabled();
  await knopf(page, "Abbrechen").click();
  await expect(page.locator("#form-panel")).toBeHidden();

  patch.release(NICHT_ANGEMELDET);

  await expect(page).toHaveURL("/auth/login?next=%2Fverteiler.html");
});

test("schließt ein fertiges Speichern die Maske, bevor die 401-Antwort des Umschaltens eintrifft, führt die Antwort zum Login", async ({ page, api }) => {
  const post = hold();
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [CREATE]: post.answer, [PATCH_NETZ]: patch.answer, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Telefonie");
  await knopf(page, "Speichern").click();
  await expect(knopf(page, "Speichern")).toBeDisabled(); // das Speichern läuft, die Maske steht noch
  await umschalter(page, "Netzwerk").click();
  await expect(umschalter(page, "Netzwerk")).toBeDisabled();
  api.stub(LIST, { json: [adminTopic(), NETZ, TELEFONIE] });
  post.release({ status: 201, json: TELEFONIE });
  await expect(page.locator("#form-panel")).toBeHidden(); // gespeichert: Die Maske ist zu …
  await expect(zeile(page, "Telefonie")).toBeVisible(); // … und die Liste neu geladen

  patch.release(NICHT_ANGEMELDET);

  await expect(page).toHaveURL("/auth/login?next=%2Fverteiler.html");
});

for (const [fall, key, loeseAus] of [
  ["Umschalten", PATCH_NETZ, async (page) => { await umschalter(page, "Netzwerk").click(); }],
  ["Löschen", DELETE_NETZ, async (page, api) => {
    api.confirmNext(true);
    await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click();
  }],
]) {
  test(`öffnet der Admin die Maske erst, während das ${fall} läuft, und trifft dann die 401-Antwort ein, bleibt die Seite stehen — kein Sprung zum Login, die Eingabe ist noch da`, async ({ page, api }) => {
    const antwort = hold();
    api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [key]: antwort.answer, [LOGIN]: LOGIN_STUB });
    await oeffne(page);
    await loeseAus(page, api); // abgesetzt, solange keine Maske offen ist
    await expect(umschalter(page, "Netzwerk")).toBeDisabled(); // die Anfrage läuft
    await knopf(page, "Neuen Verteiler anlegen").click(); // die Antwort lässt auf sich warten — der Admin arbeitet weiter
    await page.getByLabel("Name").fill("Telefonie");
    await page.getByLabel("Beschreibung").fill("Lange getippte Beschreibung");

    antwort.release(NICHT_ANGEMELDET);

    await expectToast(page, SITZUNG_ABGELAUFEN_AKTION, { error: true });
    await expect(page).toHaveURL("/verteiler.html");
    await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
    await expect(page.getByRole("heading", { name: "Neuen Verteiler anlegen" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Telefonie");
    await expect(page.getByLabel("Beschreibung")).toHaveValue("Lange getippte Beschreibung");
    await api.sync();
    expect(api.calls(LOGIN)).toHaveLength(0);
  });
}

test("ist bei der 401-Antwort des Umschaltens eine ANDERE Maske offen als beim Absenden, bleibt die Seite stehen — der Hinweis nennt die Eingabe in der Maske, und sie steht noch", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: patch.answer, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await umschalter(page, "Netzwerk").click();
  await expect(umschalter(page, "Netzwerk")).toBeDisabled();
  await knopf(page, "Abbrechen").click(); // die Maske vom Absenden ist zu …
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click(); // … und eine andere offen
  await page.getByLabel("Name").fill("SAP Betrieb");

  patch.release(NICHT_ANGEMELDET);

  await expectToast(page, SITZUNG_ABGELAUFEN_AKTION, { error: true });
  await expect(page).toHaveURL("/verteiler.html");
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("SAP Betrieb");
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
});

/* ---------- Deaktivieren / Aktivieren ---------- */

test("Deaktivieren sendet PATCH { is_active: false }, meldet es und lädt die Liste neu", async ({ page, api }) => {
  api.stub(PATCH, { json: aus(adminTopic()) });
  await oeffne(page);
  api.stub(LIST, { json: [aus(adminTopic())] });

  await knopf(page, "Deaktivieren").click();

  await expectToast(page, "„SAP Produktion“ deaktiviert");
  await expect(knopf(page, "Aktivieren")).toBeVisible();
  await expect(page.getByText("Inaktiv", { exact: true })).toBeVisible();
  await expect(page.locator("#anzahl")).toHaveText("1 Verteiler, 1 davon inaktiv");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ is_active: false }]);
});

test("Aktivieren sendet PATCH { is_active: true }", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [aus(adminTopic())] }, [PATCH]: { json: adminTopic() } });
  await oeffne(page);
  api.stub(LIST, { json: [adminTopic()] });

  await knopf(page, "Aktivieren").click();

  await expectToast(page, "„SAP Produktion“ aktiviert");
  await expect(knopf(page, "Deaktivieren")).toBeVisible();
  await expect(page.locator("#anzahl")).toHaveText("1 Verteiler");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ is_active: true }]);
});

test("Deaktivieren wirkt auf den Verteiler der angeklickten Zeile, nicht auf den ersten der Liste", async ({ page, api }) => {
  // Der erste Verteiler ist inaktiv: Griffe die Seite nach ihm, ginge für „SAP Produktion“ ein Aktivieren raus.
  api.stub({ [LIST]: { json: [aus(adminTopic()), NETZ] }, [PATCH]: { json: adminTopic() }, [PATCH_NETZ]: { json: aus(NETZ) } });
  await oeffne(page);

  await zeile(page, "Netzwerk").getByRole("button", { name: "Deaktivieren" }).click();

  await expectToast(page, "„Netzwerk“ deaktiviert");
  await api.sync();
  expect(api.calls(PATCH_NETZ).map((call) => call.json)).toEqual([{ is_active: false }]);
  expect(api.calls(PATCH)).toHaveLength(0);
});

test("ein Neuladen ersetzt die Liste — kein Verteiler steht danach doppelt da", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: { json: aus(adminTopic()) } });
  await oeffne(page);
  api.stub(LIST, { json: [aus(adminTopic()), NETZ] });

  await zeile(page, "SAP Produktion").getByRole("button", { name: "Deaktivieren" }).click();

  await expect(page.locator("#anzahl")).toHaveText("2 Verteiler, 1 davon inaktiv"); // neu geladen
  await expect(page.locator("#verteiler-body").getByRole("row")).toHaveText([/^SAP Produktion/, /^Netzwerk/]);
});

test("eine überholte Listenantwort ersetzt die neuere Liste nicht", async ({ page, api }) => {
  const alt = await ueberholeListenabfrage(page, api);

  alt.release({ json: [aus(adminTopic()), NETZ] }); // der Stand VOR dem zweiten Umschalten
  await api.sync();

  await expect(page.locator("#anzahl")).toHaveText("2 Verteiler, 2 davon inaktiv");
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren"); // kein „Deaktivieren“ für einen schon inaktiven Verteiler
});

test("auch eine überholte Listenabfrage, die scheitert, ersetzt die neuere Liste nicht und meldet keinen Fehler", async ({ page, api }) => {
  const alt = await ueberholeListenabfrage(page, api);

  alt.release(GATEWAY);
  await api.sync();

  await expect(page.locator("#verteiler-body").getByRole("row")).toHaveText([/^SAP Produktion/, /^Netzwerk/]);
  await expect(page.locator("#anzahl")).toHaveText("2 Verteiler, 2 davon inaktiv");
  await expectToast(page, "„Netzwerk“ deaktiviert"); // die Erfolgsmeldung steht noch da, kein „Fehler (HTTP 502)“
});

test("der Umschalt-Knopf ist gesperrt, solange die Anfrage läuft — ein Doppelklick sendet nur einmal", async ({ page, api }) => {
  const patch = hold();
  api.stub(PATCH, patch.answer);
  await oeffne(page);
  api.stub(LIST, { json: [aus(adminTopic())] });

  await knopf(page, "Deaktivieren").dblclick();
  await expect(knopf(page, "Deaktivieren")).toBeDisabled();
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(1);
  patch.release({ json: aus(adminTopic()) });

  await expect(knopf(page, "Aktivieren")).toBeEnabled();
});

test("Umschalten scheitert: Fehlertext im Toast, die Zeile bleibt, wie sie war", async ({ page, api }) => {
  api.stub(PATCH, fehler(404, "TOPIC_NOT_FOUND", "Topic 'sap' existiert nicht"));
  await oeffne(page);

  await knopf(page, "Deaktivieren").click();

  await expectToast(page, "Topic 'sap' existiert nicht", { error: true });
  await expect(knopf(page, "Deaktivieren")).toBeEnabled();
  await expect(page.getByText("Inaktiv", { exact: true })).toBeHidden();
  await expect(page.locator("#anzahl")).toHaveText("1 Verteiler");
  await api.sync();
  expect(api.calls(LIST)).toHaveLength(1); // kein Neuladen nach einem Fehler
});

test("Umschalten kodiert einen Slug mit Sonderzeichen im Pfad", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [KRUMM] }, ["PATCH " + KRUMM_PFAD]: { json: aus(KRUMM) } });
  await oeffne(page, /Büro Nord/);

  await knopf(page, "Deaktivieren").click();

  await expectToast(page, "„Büro Nord“ deaktiviert");
  await api.sync();
  expect(api.calls("PATCH " + KRUMM_PFAD).map((call) => call.json)).toEqual([{ is_active: false }]);
});

/* ---------- Löschen ---------- */

test("Löschen fragt erst nach — Abbrechen sendet nichts und lässt die Zeile stehen", async ({ page, api }) => {
  await oeffne(page);

  api.confirmNext(false);
  await knopf(page, "Löschen").click();

  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", KEINE_ABOS)]);
  expect(api.calls(DELETE)).toHaveLength(0);
  await expect(zeile(page, "SAP Produktion")).toBeVisible();
  await expect(knopf(page, "Löschen")).toBeEnabled();
});

test("die Löschfrage nennt, wie viele Abos verloren gehen", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ subscriber_count: 37 })] });
  await oeffne(page);

  api.confirmNext(false);
  await knopf(page, "Löschen").click();

  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", abosVerloren(37))]);
  expect(api.calls(DELETE)).toHaveLength(0);
});

test("die Löschfrage nennt auch ein EINZELNES Abo als Verlust", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ subscriber_count: 1 })] });
  await oeffne(page);

  api.confirmNext(false);
  await knopf(page, "Löschen").click();

  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", abosVerloren(1))]);
  expect(api.calls(DELETE)).toHaveLength(0);
});

test("die Löschfrage erklärt bei einem Pflicht-Verteiler die liegengebliebenen Abo-Zeilen", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ is_mandatory: true, subscriber_count: 3 })] });
  await oeffne(page);

  api.confirmNext(false);
  await knopf(page, "Löschen").click();

  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap",
    "3 liegengebliebene Abo-Zeile(n) gehen mit verloren. Sie wirken heute nicht (Pflicht-Verteiler), " +
    "würden ohne die Pflicht aber wieder greifen.")]);
  expect(api.calls(DELETE)).toHaveLength(0);
});

test("die Löschfrage eines Pflicht-Verteilers OHNE liegengebliebene Abo-Zeilen sagt, dass keine Abos daran hängen", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ is_mandatory: true, subscriber_count: 0 })] });
  await oeffne(page);

  api.confirmNext(false);
  await knopf(page, "Löschen").click();

  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", KEINE_ABOS)]);
  expect(api.calls(DELETE)).toHaveLength(0);
});

test("die Löschfrage nennt den Verteiler der angeklickten Zeile, nicht den ersten der Liste", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic(), { ...NETZ, subscriber_count: 2 }] });
  await oeffne(page);

  api.confirmNext(false);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click();

  await api.sync();
  expect(api.dialogs).toEqual([frage("Netzwerk", "netzwerk", abosVerloren(2))]);
  expect(api.calls().map((call) => call.key)).toEqual([ME, LIST]); // abgebrochen: nichts gesendet
});

test("bestätigtes Löschen sendet EIN DELETE, meldet den Erfolg und lädt die Liste neu", async ({ page, api }) => {
  const loeschung = hold();
  api.stub(DELETE, loeschung.answer);
  await oeffne(page);
  api.stub(LIST, { json: [] });

  api.confirmNext(true);
  await knopf(page, "Löschen").click();
  await expect(knopf(page, "Löschen")).toBeDisabled(); // gesperrt, solange die Anfrage läuft
  loeschung.release({ status: 204 });

  await expectToast(page, "Verteiler „SAP Produktion“ gelöscht");
  await expect(page.locator("#verteiler-body")).toHaveText(/^Noch kein Verteiler angelegt/);
  await expect(page.locator("#anzahl")).toHaveText("");
  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", KEINE_ABOS)]);
  expect(api.calls(DELETE).map((call) => call.json)).toEqual([null]); // genau eins, ohne Body
});

test("Löschen kodiert einen Slug mit Sonderzeichen im Pfad", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [KRUMM] }, ["DELETE " + KRUMM_PFAD]: { status: 204 } });
  await oeffne(page, /Büro Nord/);

  api.confirmNext(true);
  await knopf(page, "Löschen").click();

  await expectToast(page, "Verteiler „Büro Nord“ gelöscht");
  await api.sync();
  expect(api.dialogs).toEqual([frage("Büro Nord", "büro/nord 1", KEINE_ABOS)]);
  expect(api.calls("DELETE " + KRUMM_PFAD)).toHaveLength(1);
});

test("wird der Verteiler gelöscht, der gerade bearbeitet wird, schließt die Maske", async ({ page, api }) => {
  api.stub(DELETE, { status: 204 });
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("SAP Betrieb");
  api.stub(LIST, { json: [] });

  api.confirmNext(true);
  await knopf(page, "Löschen").click();

  await expectToast(page, "Verteiler „SAP Produktion“ gelöscht");
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", KEINE_ABOS)]); // der gespeicherte Name, nicht der getippte
});

test("wird der bearbeitete Verteiler gelöscht, nachdem die Liste zwischendurch neu geladen wurde, schließt die Maske trotzdem", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: { json: aus(NETZ) }, [DELETE]: { status: 204 } });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });
  await zeile(page, "Netzwerk").getByRole("button", { name: "Deaktivieren" }).click();
  await expect(zeile(page, "Netzwerk").getByRole("button", { name: "Aktivieren", exact: true })).toBeVisible(); // Liste neu geladen
  api.stub(LIST, { json: [aus(NETZ)] });

  api.confirmNext(true);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Löschen" }).click();

  await expectToast(page, "Verteiler „SAP Produktion“ gelöscht");
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", KEINE_ABOS)]);
});

test("wird ein ANDERER Verteiler gelöscht, bleibt die offene Maske mit ihrer Eingabe stehen", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [DELETE_NETZ]: { status: 204 } });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Name").fill("SAP Betrieb");
  api.stub(LIST, { json: [adminTopic()] });

  api.confirmNext(true);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click();

  await expectToast(page, "Verteiler „Netzwerk“ gelöscht");
  await expect(zeile(page, "Netzwerk")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("SAP Betrieb");
  expect(api.dialogs).toEqual([frage("Netzwerk", "netzwerk", KEINE_ABOS)]);
});

test("Löschen scheitert (409, Meldungen vorhanden): Fehlertext im Toast, Zeile und offene Maske bleiben", async ({ page, api }) => {
  const inBenutzung = "„SAP Produktion“ hat 2 Versand/Versände in der Historie und kann nicht gelöscht werden — " +
    "die Historie bleibt unveränderlich. Deaktiviere den Verteiler stattdessen.";
  api.stub(DELETE, fehler(409, "TOPIC_IN_USE", inBenutzung));
  await oeffne(page);
  await knopf(page, "Bearbeiten").click();
  await page.getByLabel("Name").fill("SAP Betrieb");

  api.confirmNext(true);
  await knopf(page, "Löschen").click();

  await expectToast(page, inBenutzung, { error: true });
  await expect(zeile(page, "SAP Produktion")).toBeVisible();
  await expect(knopf(page, "Löschen")).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible(); // die Maske ist nicht zugegangen …
  await expect(page.getByLabel("Name")).toHaveValue("SAP Betrieb"); // … und die Eingabe steht noch darin
  await api.sync();
  expect(api.dialogs).toEqual([frage("SAP Produktion", "sap", KEINE_ABOS)]);
  expect(api.calls(LIST)).toHaveLength(1); // kein Neuladen nach einem Fehler
});

/* ---------- Die Zeile bleibt gesperrt, bis ihre Aktion beantwortet ist ---------- */

test("solange das Umschalten läuft, sind auch „Bearbeiten“ und „Löschen“ derselben Zeile gesperrt — die Nachbarzeile bleibt bedienbar", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: patch.answer });
  await oeffne(page);

  await umschalter(page, "SAP Produktion").click();
  await expect(zeilenKnoepfe(page, "SAP Produktion", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Löschen" }).click({ force: true }); // fragte sonst nach
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click({ force: true });
  await expect(page.locator("#form-panel")).toBeHidden();
  await zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" }).click();
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await api.sync();
  expect(api.dialogs).toEqual([]);
  patch.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
});

test("nach erfolgreichem Umschalten bleibt die Zeile gesperrt, bis auch die neu geladene Liste da ist — weder Klick noch Tastendruck senden die Änderung noch einmal", async ({ page, api }) => {
  const liste = hold();
  api.stub(PATCH, { json: aus(adminTopic()) });
  await oeffne(page);
  api.stub(LIST, liste.answer);
  await knopf(page, "Deaktivieren").click();
  await expectToast(page, "„SAP Produktion“ deaktiviert"); // die Aktion ist beantwortet …
  await api.sync();
  expect(api.calls(LIST)).toHaveLength(2); // … ihr Listenabruf hängt: Die Zeile zeigt noch den alten Stand

  await expect(zeilenKnoepfe(page, "SAP Produktion", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await knopf(page, "Deaktivieren").click({ force: true }); // ungeduldig noch einmal
  await knopf(page, "Deaktivieren").focus(); // ein gesperrter Knopf nimmt den Fokus nicht an
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(1);
  liste.release({ json: [aus(adminTopic())] });

  await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
});

for (const [fall, ueberholt] of [
  ["kommt an", { json: [aus(adminTopic()), NETZ] }],
  ["scheitert", GATEWAY],
]) {
  test(`überholt ein neuerer Listenabruf den der Aktion, bleibt die Zeile gesperrt, bis der neuere da ist — der überholte ${fall}`, async ({ page, api }) => {
    const alt = hold();
    const neu = hold();
    let abruf = 0;
    api.stub({
      // 1. Abruf: Start · 2.: nach dem Umschalten von „SAP Produktion“ · 3.: nach dem von „Netzwerk“ — beide hängen
      [LIST]: () => [{ json: [adminTopic(), NETZ] }, alt.answer(), neu.answer()][abruf++],
      [PATCH]: { json: aus(adminTopic()) },
      [PATCH_NETZ]: { json: aus(NETZ) },
    });
    await oeffne(page);
    await umschalter(page, "SAP Produktion").click();
    await expectToast(page, "„SAP Produktion“ deaktiviert");
    await umschalter(page, "Netzwerk").click();
    await expectToast(page, "„Netzwerk“ deaktiviert");
    await api.sync();
    expect(api.calls(LIST)).toHaveLength(3);
    alt.release(ueberholt); // die Antwort auf den Abruf von „SAP Produktion“: überholt, die Tabelle bleibt beim alten Stand
    await api.sync();

    await expect(zeilenKnoepfe(page, "SAP Produktion", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
    await umschalter(page, "SAP Produktion").click({ force: true }); // sendete „deaktivieren“ ein zweites Mal
    await api.sync();
    expect(api.calls(PATCH)).toHaveLength(1);
    neu.release({ json: [aus(adminTopic()), aus(NETZ)] });

    await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
    await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
    await expect(page.locator("#toast")).toHaveText("„Netzwerk“ deaktiviert"); // kein „Fehler (HTTP 502)“
  });
}

test("überholt der Listenabruf nach einem Speichern den einer Zeilen-Aktion, bleibt die Zeile gesperrt, bis der jüngere gezeichnet ist — es bleibt bei der Erfolgsmeldung des Speicherns", async ({ page, api }) => {
  const alt = hold();
  const neu = hold();
  let abruf = 0;
  api.stub({
    // 1. Abruf: Start · 2.: nach dem Umschalten von „Netzwerk“ · 3.: nach dem Anlegen von „Telefonie“ — beide hängen
    [LIST]: () => [{ json: [adminTopic(), NETZ] }, alt.answer(), neu.answer()][abruf++],
    [CREATE]: { status: 201, json: TELEFONIE },
    [PATCH_NETZ]: { json: aus(NETZ) },
  });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Telefonie");
  await umschalter(page, "Netzwerk").click();
  await expectToast(page, "„Netzwerk“ deaktiviert");
  await knopf(page, "Speichern").click();
  await expectToast(page, "Verteiler „Telefonie“ angelegt");
  await api.sync();
  expect(api.calls(LIST)).toHaveLength(3);
  alt.release({ json: [adminTopic(), aus(NETZ)] }); // die Antwort auf den Abruf von „Netzwerk“: überholt, die Tabelle bleibt beim alten Stand
  await api.sync();

  await expect(zeilenKnoepfe(page, "Netzwerk", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await umschalter(page, "Netzwerk").click({ force: true }); // sendete „deaktivieren“ ein zweites Mal
  await api.sync();
  expect(api.calls(PATCH_NETZ)).toHaveLength(1);
  neu.release({ json: [adminTopic(), TELEFONIE, aus(NETZ)] });

  await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
  await expect(zeile(page, "Telefonie")).toBeVisible();
  await expectToast(page, "Verteiler „Telefonie“ angelegt"); // kein Fehler-Toast
});

test("überholt der Listenabruf nach einem Speichern den des Seitenstarts und scheitert der danach, bleibt die Tabelle beim jüngeren Stand — es bleibt bei der Erfolgsmeldung des Speicherns", async ({ page, api }) => {
  const start = hold();
  let abruf = 0;
  api.stub({
    // 1. Abruf: Start, hängt · 2.: nach dem Anlegen von „Telefonie“, kommt sofort
    [LIST]: () => [start.answer(), { json: [adminTopic(), TELEFONIE] }][abruf++],
    [CREATE]: { status: 201, json: TELEFONIE },
  });
  await page.goto("/verteiler.html");
  await knopf(page, "Neuen Verteiler anlegen").click(); // die Liste lässt auf sich warten — der Admin legt schon an
  await page.getByLabel("Name").fill("Telefonie");
  await knopf(page, "Speichern").click();
  await expectToast(page, "Verteiler „Telefonie“ angelegt");
  await expect(zeile(page, "Telefonie")).toBeVisible();

  start.release(GATEWAY);
  await api.sync();

  await expect(zeile(page, "Telefonie")).toBeVisible(); // kein „Laden fehlgeschlagen“ an Stelle der Liste
  await expectToast(page, "Verteiler „Telefonie“ angelegt"); // kein Fehler-Toast
});

test("zeichnet ein anderes Neuladen die Zeile neu, während ihr Umschalten noch läuft, bleibt sie gesperrt — ein zweiter Klick sendet nichts", async ({ page, api }) => {
  const netz = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: { json: aus(adminTopic()) }, [PATCH_NETZ]: netz.answer });
  await oeffne(page);
  await umschalter(page, "Netzwerk").click();
  await expect(umschalter(page, "Netzwerk")).toBeDisabled(); // die Anfrage für „Netzwerk“ läuft
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });
  await umschalter(page, "SAP Produktion").click(); // antwortet sofort und lädt die Liste neu
  await expect(umschalter(page, "SAP Produktion")).toHaveText("Aktivieren");
  await expect(umschalter(page, "SAP Produktion")).toBeEnabled(); // diese Aktion ist beantwortet, ihre Zeile frei

  await expect(zeilenKnoepfe(page, "Netzwerk", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await umschalter(page, "Netzwerk").click({ force: true }); // ungeduldig noch einmal
  await api.sync();
  expect(api.calls(PATCH_NETZ)).toHaveLength(1);
  api.stub(LIST, { json: [aus(NETZ), aus(adminTopic())] });
  netz.release({ json: aus(NETZ) });

  await expectToast(page, "„Netzwerk“ deaktiviert");
  await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
});

test("Tastatur: auch die neu gezeichnete Zeile nimmt weder Fokus noch Tastendruck an, solange ihr Umschalten läuft", async ({ page, api }) => {
  const netz = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: { json: aus(adminTopic()) }, [PATCH_NETZ]: netz.answer });
  await oeffne(page);
  await loeseMitEnterAus(page, umschalter(page, "Netzwerk"));
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });
  await umschalter(page, "SAP Produktion").click(); // zeichnet die Liste neu; nach dem Mausklick liegt der Fokus auf der Seite
  await expect(umschalter(page, "SAP Produktion")).toBeEnabled();
  await expect(page.locator("body")).toBeFocused();

  await umschalter(page, "Netzwerk").focus(); // ein gesperrter Knopf nimmt den Fokus nicht an
  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await api.sync();
  expect(api.calls(PATCH_NETZ)).toHaveLength(1);
  expect(api.calls(PATCH)).toHaveLength(1); // und der Tastendruck traf auch keine andere Zeile
});

test("die gesperrte Zeile übersteht auch zwei Neuzeichnungen — frei wird sie erst mit ihrer eigenen Antwort", async ({ page, api }) => {
  const sap = hold();
  api.stub({
    [LIST]: { json: [adminTopic(), NETZ] },
    [PATCH]: sap.answer,
    [PATCH_NETZ]: (call) => ({ json: { ...NETZ, is_active: call.json.is_active } }),
  });
  await oeffne(page);
  await umschalter(page, "SAP Produktion").click(); // diese Anfrage hängt
  await expect(umschalter(page, "SAP Produktion")).toBeDisabled();
  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });
  await umschalter(page, "Netzwerk").click(); // erstes Neuzeichnen
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren");
  api.stub(LIST, { json: [adminTopic(), NETZ] });
  await umschalter(page, "Netzwerk").click(); // zweites Neuzeichnen
  await expect(umschalter(page, "Netzwerk")).toHaveText("Deaktivieren");
  await expect(umschalter(page, "Netzwerk")).toBeEnabled();

  await expect(zeilenKnoepfe(page, "SAP Produktion", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await umschalter(page, "SAP Produktion").click({ force: true });
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(1);
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });
  sap.release({ json: aus(adminTopic()) });

  await expectToast(page, "„SAP Produktion“ deaktiviert");
  await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
});

test("scheitert die Aktion, nachdem die Liste umsortiert neu gezeichnet wurde, wird genau ihre Zeile frei — die andere wartende bleibt gesperrt", async ({ page, api }) => {
  const sap = hold();
  const netz = hold();
  api.stub({
    [LIST]: { json: [KRUMM, adminTopic(), NETZ] },
    [PATCH]: sap.answer,
    [PATCH_NETZ]: netz.answer,
    ["PATCH " + KRUMM_PFAD]: { json: aus(KRUMM) },
  });
  await oeffne(page);
  await umschalter(page, "SAP Produktion").click();
  await umschalter(page, "Netzwerk").click(); // beide Anfragen hängen
  api.stub(LIST, { json: [adminTopic(), NETZ, aus(KRUMM)] }); // „Büro Nord“ rückt ans Ende, die beiden wartenden einen Platz vor
  await umschalter(page, "Büro Nord").click();
  await expect(page.locator("#verteiler-body").getByRole("row")).toHaveText([/^SAP Produktion/, /^Netzwerk/, /^Büro Nord/]);
  await expect(umschalter(page, "Büro Nord")).toBeEnabled();

  netz.release(GATEWAY); // kein Neuladen: Die Freigabe muss die Zeile selbst finden — über den Verteiler, nicht über den Platz

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await expect(zeilenKnoepfe(page, "SAP Produktion", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await umschalter(page, "SAP Produktion").click({ force: true });
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(1);
});

test("nach ihrer Antwort ist die Zeile wieder frei und bleibt es, wenn die Liste das nächste Mal neu gezeichnet wird", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: { json: aus(adminTopic()) }, [PATCH_NETZ]: { json: aus(NETZ) } });
  await oeffne(page);
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });
  await umschalter(page, "SAP Produktion").click();
  await expect(umschalter(page, "SAP Produktion")).toHaveText("Aktivieren");
  api.stub(LIST, { json: [aus(NETZ), aus(adminTopic())] });

  await umschalter(page, "Netzwerk").click(); // zeichnet die Liste noch einmal neu
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren");

  await api.sync();
  await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
  await expect(zeilenKnoepfe(page, "Netzwerk", false)).toHaveText(["Bearbeiten", "Aktivieren", "Löschen"]);
});

test("eine laufende Löschung sperrt die Zeile über ein Neuzeichnen hinweg — ein zweiter Klick fragt nicht noch einmal und sendet nichts", async ({ page, api }) => {
  const loeschung = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: { json: aus(adminTopic()) }, [DELETE_NETZ]: loeschung.answer });
  await oeffne(page);
  api.confirmNext(true);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click();
  await expect(zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" })).toBeDisabled();
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });
  await umschalter(page, "SAP Produktion").click(); // lädt die Liste neu
  await expect(umschalter(page, "SAP Produktion")).toHaveText("Aktivieren");

  await expect(zeilenKnoepfe(page, "Netzwerk", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click({ force: true });
  await api.sync();
  expect(api.dialogs).toHaveLength(1);
  expect(api.calls(DELETE_NETZ)).toHaveLength(1);
  api.stub(LIST, { json: [aus(adminTopic())] });
  loeschung.release({ status: 204 });

  await expectToast(page, "Verteiler „Netzwerk“ gelöscht");
  await expect(zeile(page, "Netzwerk")).toHaveCount(0);
});

test("nach erfolgreichem Löschen bleibt die Zeile gesperrt, bis die neu geladene Liste sie entfernt — ein zweiter Klick fragt nicht noch einmal und sendet nichts", async ({ page, api }) => {
  const liste = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [DELETE_NETZ]: { status: 204 } });
  await oeffne(page);
  api.stub(LIST, liste.answer);
  api.confirmNext(true);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click();
  await expectToast(page, "Verteiler „Netzwerk“ gelöscht"); // die Löschung ist beantwortet …
  await api.sync();
  expect(api.calls(LIST)).toHaveLength(2); // … ihr Listenabruf hängt: Die Zeile steht noch da

  await expect(zeilenKnoepfe(page, "Netzwerk", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }).click({ force: true }); // fragte sonst nach
  await api.sync();
  expect(api.dialogs).toHaveLength(1);
  expect(api.calls(DELETE_NETZ)).toHaveLength(1);
  liste.release({ json: [adminTopic()] });

  await expect(zeile(page, "Netzwerk")).toHaveCount(0);
  await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
});

test("wird die Zeile wieder frei, bleibt das „Löschen“ eines nicht löschbaren Verteilers gesperrt und begründet", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic({ dispatch_count: 2 })] }, [PATCH]: patch.answer });
  await oeffne(page);
  await knopf(page, "Deaktivieren").click();
  await expect(knopf(page, "Bearbeiten")).toBeDisabled(); // die ganze Zeile ist gesperrt

  patch.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilenKnoepfe(page, "SAP Produktion", false)).toHaveText(["Bearbeiten", "Deaktivieren"]);
  await expect(knopf(page, "Löschen")).toBeDisabled();
  await expect(knopf(page, "Löschen")).toHaveAttribute("title", /^Nicht löschbar: Über diesen Verteiler wurden bereits 2 Meldung/);
  await knopf(page, "Löschen").click({ force: true }); // fragte sonst nach
  await api.sync();
  expect(api.dialogs).toEqual([]);
});

/* ---------- Tastaturfokus nach Umschalten und Löschen ---------- */

test("Tastatur: nach dem Umschalten steht der Fokus wieder auf dem Knopf der Zeile — jetzt „Aktivieren“", async ({ page, api }) => {
  const patch = hold();
  api.stub(PATCH, patch.answer);
  await oeffne(page);
  api.stub(LIST, { json: [aus(adminTopic())] });
  await loeseMitEnterAus(page, knopf(page, "Deaktivieren"));

  patch.release({ json: aus(adminTopic()) });

  await expect(knopf(page, "Aktivieren")).toBeFocused(); // die Zeile ist neu gezeichnet, der Knopf ein anderes Element
});

test("Tastatur: der Fokus folgt dem Verteiler, nicht dem Platz in der Liste", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: [NETZ, adminTopic()] }, [PATCH_NETZ]: patch.answer });
  await oeffne(page);
  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] }); // die API sortiert inaktive Verteiler ans Ende
  await loeseMitEnterAus(page, umschalter(page, "Netzwerk"));

  patch.release({ json: aus(NETZ) });

  await expect(page.locator("#verteiler-body").getByRole("row")).toHaveText([/^SAP Produktion/, /^Netzwerk/]);
  await expect(umschalter(page, "Netzwerk")).toBeFocused(); // nicht der Knopf, der jetzt in der ersten Zeile steht
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren");
});

test("Tastatur: rückt die deaktivierte Zeile ans Ende einer langen Liste, holt der Fokus sie ins Fenster", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: VIELE }, [PATCH_02]: patch.answer });
  await oeffne(page, /Verteiler 39/);
  api.stub(LIST, { json: VIELE_02_AUS });
  await loeseMitEnterAus(page, umschalter(page, "Verteiler 02"));

  patch.release({ json: VIELE_02_AUS[39] });

  await expect(umschalter(page, "Verteiler 02")).toBeFocused();
  await expect(umschalter(page, "Verteiler 02")).toBeInViewport(); // zu sehen — nicht irgendwo unter dem Fensterrand
});

test("ein Mausklick auf „Deaktivieren“ lässt die Seite stehen, wo sie ist — sie springt der Zeile nicht ans Listenende nach", async ({ page, api }) => {
  api.stub({ [LIST]: { json: VIELE }, [PATCH_02]: { json: VIELE_02_AUS[39] } });
  await oeffne(page, /Verteiler 39/);
  api.stub(LIST, { json: VIELE_02_AUS });

  await umschalter(page, "Verteiler 02").click();

  await expectToast(page, "„Verteiler 02“ deaktiviert");
  await expect(umschalter(page, "Verteiler 02")).toHaveText("Aktivieren"); // neu gezeichnet — jetzt ganz unten
  await api.sync();
  await expect(umschalter(page, "Verteiler 02")).not.toBeInViewport();
  await expect(zeile(page, "Verteiler 03")).toBeInViewport(); // der Admin sieht weiter die Zeilen, bei denen er war
  await expect(page.locator("body")).toBeFocused(); // nach einem Mausklick gibt es keinen Tastaturfokus zurückzuholen
});

test("Tastatur: scheitert das Umschalten, steht der Fokus wieder auf dem Knopf", async ({ page, api }) => {
  const patch = hold();
  api.stub(PATCH, patch.answer);
  await oeffne(page);
  await loeseMitEnterAus(page, knopf(page, "Deaktivieren"));

  patch.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(knopf(page, "Deaktivieren")).toBeFocused(); // sonst ginge die nächste Taste ins Leere
});

test("Tastatur: lässt sich die Liste nach dem Umschalten nicht neu laden, steht der Fokus auf „Neuen Verteiler anlegen“", async ({ page, api }) => {
  const patch = hold();
  api.stub(PATCH, patch.answer);
  await oeffne(page);
  api.stub(LIST, GATEWAY);
  await loeseMitEnterAus(page, knopf(page, "Deaktivieren"));

  patch.release({ json: aus(adminTopic()) });

  await expect(page.locator("#verteiler-body")).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 502)");
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused(); // die Zeile mit dem Knopf gibt es nicht mehr
});

test("Tastatur: scheitert das Löschen, steht der Fokus wieder auf „Löschen“", async ({ page, api }) => {
  const loeschung = hold();
  api.stub(DELETE, loeschung.answer);
  await oeffne(page);
  api.confirmNext(true);
  await loeseMitEnterAus(page, knopf(page, "Löschen"));

  loeschung.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(knopf(page, "Löschen")).toBeFocused();
});

test("Tastatur: nach dem Löschen steht der Fokus auf „Neuen Verteiler anlegen“", async ({ page, api }) => {
  const loeschung = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [DELETE]: loeschung.answer });
  await oeffne(page);
  api.stub(LIST, { json: [NETZ] });
  api.confirmNext(true);
  await loeseMitEnterAus(page, zeile(page, "SAP Produktion").getByRole("button", { name: "Löschen" }));

  loeschung.release({ status: 204 });

  await expectToast(page, "Verteiler „SAP Produktion“ gelöscht");
  await expect(zeile(page, "SAP Produktion")).toHaveCount(0);
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused(); // nicht auf „Löschen“ der nachgerückten Zeile
});

test("Tastatur: wer während des Umschaltens die Neuanlage öffnet, tippt dort ungestört weiter", async ({ page, api }) => {
  const patch = hold();
  api.stub(PATCH, patch.answer);
  await oeffne(page);
  api.stub(LIST, { json: [aus(adminTopic())] });
  await loeseMitEnterAus(page, knopf(page, "Deaktivieren"));
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.keyboard.type("Netz");

  patch.release({ json: aus(adminTopic()) });

  await expect(knopf(page, "Aktivieren")).toBeVisible(); // die Liste ist neu gezeichnet
  await page.keyboard.type("werk"); // spränge der Fokus in die Zeile, ginge das Tippen ins Leere
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
});

test("Tastatur: wer während des Umschaltens zur nächsten Zeile weitergeht, behält dort den Fokus — auch über das Neuzeichnen hinweg", async ({ page, api }) => {
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: patch.answer });
  await oeffne(page);
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });
  await loeseMitEnterAus(page, umschalter(page, "SAP Produktion"));
  await page.keyboard.press("Tab"); // „Löschen“ derselben Zeile ist mit gesperrt — der nächste Halt ist „Bearbeiten“ der nächsten
  await expect(zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" })).toBeFocused();

  patch.release({ json: aus(adminTopic()) });

  await expect(umschalter(page, "SAP Produktion")).toHaveText("Aktivieren"); // neu gezeichnet
  await expect(zeile(page, "Netzwerk").getByRole("button", { name: "Bearbeiten" })).toBeFocused();
  await page.keyboard.press("Enter"); // die Eingabetaste gilt dieser Zeile — nicht dem Knopf, der eben umgeschaltet hat
  await expect(page.getByLabel("Slug")).toHaveValue("netzwerk");
  await api.sync();
  expect(api.calls(PATCH)).toHaveLength(1);
});

test("Tastatur: laufen zwei Umschaltungen zugleich, holt die erste Antwort den Fokus nicht in ihre Zeile — er geht an die zuletzt bediente", async ({ page, api }) => {
  const sap = hold();
  const netz = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: sap.answer, [PATCH_NETZ]: netz.answer });
  await oeffne(page);
  await loeseMitEnterAus(page, umschalter(page, "SAP Produktion"));
  await loeseMitEnterAus(page, umschalter(page, "Netzwerk")); // der Admin ist schon eine Zeile weiter
  api.stub(LIST, { json: [NETZ, aus(adminTopic())] });

  sap.release({ json: aus(adminTopic()) });
  await expect(umschalter(page, "SAP Produktion")).toHaveText("Aktivieren"); // neu gezeichnet
  await api.sync();
  // Stünde der Fokus jetzt auf „Aktivieren“ von SAP, nähme die nächste Eingabetaste die Deaktivierung zurück.
  await expect(page.locator("body")).toBeFocused();
  api.stub(LIST, { json: [aus(NETZ), aus(adminTopic())] });
  netz.release({ json: aus(NETZ) });

  await expectToast(page, "„Netzwerk“ deaktiviert");
  await expect(umschalter(page, "Netzwerk")).toBeFocused();
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren");
});

test("Tastatur: antwortet die zuletzt bediente Zeile zuerst, bleibt der Fokus bei ihr — auch wenn die frühere Antwort die Liste noch einmal neu zeichnet", async ({ page, api }) => {
  const sap = hold();
  const netz = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH]: sap.answer, [PATCH_NETZ]: netz.answer });
  await oeffne(page);
  await loeseMitEnterAus(page, umschalter(page, "SAP Produktion"));
  await loeseMitEnterAus(page, umschalter(page, "Netzwerk"));
  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });

  netz.release({ json: aus(NETZ) });
  await expectToast(page, "„Netzwerk“ deaktiviert");
  await expect(umschalter(page, "Netzwerk")).toBeFocused();
  api.stub(LIST, { json: [aus(NETZ), aus(adminTopic())] });
  sap.release({ json: aus(adminTopic()) });

  await expectToast(page, "„SAP Produktion“ deaktiviert");
  await expect(umschalter(page, "SAP Produktion")).toHaveText("Aktivieren"); // noch einmal neu gezeichnet
  await expect(umschalter(page, "Netzwerk")).toBeFocused();
});

test("Tastatur: eine gehaltene Eingabetaste schaltet nur einmal um — erst ein neuer Tastendruck schaltet zurück", async ({ page, api }) => {
  api.stub(PATCH, (call) => ({ json: adminTopic({ is_active: call.json.is_active }) }));
  await oeffne(page);
  api.stub(LIST, { json: [aus(adminTopic())] });
  await knopf(page, "Deaktivieren").focus();

  await page.keyboard.down("Enter");
  await expect(knopf(page, "Aktivieren")).toBeFocused(); // umgeschaltet — derselbe Knopf täte jetzt das Gegenteil
  await page.keyboard.down("Enter"); // Tastenwiederholung: die Taste ist noch nicht losgelassen
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ is_active: false }]);

  api.stub(LIST, { json: [adminTopic()] });
  await page.keyboard.press("Enter");
  await expectToast(page, "„SAP Produktion“ aktiviert");
  await api.sync();
  expect(api.calls(PATCH).map((call) => call.json)).toEqual([{ is_active: false }, { is_active: true }]);
});

/* ---------- Abbrechen ---------- */

test("Abbrechen schließt die Maske ohne Anfrage und gibt den Fokus an „Neuen Verteiler anlegen“ zurück", async ({ page, api }) => {
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");

  await knopf(page, "Abbrechen").click();

  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeFocused();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LIST]);
});

/* ---------- Berechtigung und Ladefehler ---------- */

test("ohne Adminrecht: Hinweis statt Liste, kein Knopf „Neuen Verteiler anlegen“, keine Admin-Anfrage", async ({ page, api }) => {
  api.stub(ME, { json: me() });
  await oeffne(page, KEINE_BERECHTIGUNG);

  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeHidden();
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(page.locator("#anzahl")).toHaveText("");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);
});

test("wird das Adminrecht zwischen /me und der Liste entzogen (403), steht der Berechtigungshinweis statt einer leeren Tabelle", async ({ page, api }) => {
  api.stub(LIST, KEIN_ADMIN);
  await oeffne(page, KEINE_BERECHTIGUNG);

  await expect(page.locator("#anzahl")).toHaveText("");
});

test("wird das Adminrecht zwischen /me und der Liste entzogen (403), verschwindet auch „Neuen Verteiler anlegen“", async ({ page, api }) => {
  api.stub(LIST, KEIN_ADMIN);
  await oeffne(page, KEINE_BERECHTIGUNG);

  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeHidden(); // dasselbe Bild wie ohne Adminrecht in /me
  await expect(page.locator("#form-panel")).toBeHidden();
});

test("wird das Adminrecht zwischen /me und der Liste entzogen (403), kommt kein Fehler-Toast dazu — der Hinweis in der Tabelle sagt es, wie auf der Rollen-Seite", async ({ page, api }) => {
  api.stub(LIST, KEIN_ADMIN);
  await oeffne(page, KEINE_BERECHTIGUNG);

  await api.sync();
  await expect(page.locator("#toast")).toHaveCount(0);
});

test("meldet erst das Neuladen nach einer Aktion den Entzug (403), bleibt deren Erfolgsmeldung stehen — kein Fehler-Toast überschreibt sie", async ({ page, api }) => {
  api.stub(PATCH, { json: aus(adminTopic()) });
  await oeffne(page);
  api.stub(LIST, KEIN_ADMIN);

  await knopf(page, "Deaktivieren").click();

  await expect(page.locator("#verteiler-body")).toHaveText(KEINE_BERECHTIGUNG);
  await api.sync();
  await expectToast(page, "„SAP Produktion“ deaktiviert");
});

test("wird das Adminrecht bei offener Maske entzogen (403 beim Neuladen), schließt die Maske — der Fokus hängt an keinem versteckten Knopf", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: { json: aus(NETZ) } });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Name").fill("SAP Betrieb");
  api.stub(LIST, KEIN_ADMIN);

  await umschalter(page, "Netzwerk").press("Enter");

  await expect(page.locator("#verteiler-body")).toHaveText(KEINE_BERECHTIGUNG);
  await expect(page.locator("#form-panel")).toBeHidden();
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeHidden();
  await expect(page.locator("body")).toBeFocused();
});

test("scheitert das Neuladen aus anderem Grund (502), bleiben „Neuen Verteiler anlegen“ und die offene Maske stehen", async ({ page, api }) => {
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: { json: aus(NETZ) } });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Name").fill("SAP Betrieb");
  api.stub(LIST, GATEWAY);

  await umschalter(page, "Netzwerk").click();

  await expect(page.locator("#verteiler-body")).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 502)");
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("SAP Betrieb"); // die Eingabe ist nicht weg, nur weil die Liste gerade nicht lädt
});

test("„Neuen Verteiler anlegen“ erscheint erst, wenn /me das Adminrecht bestätigt hat", async ({ page, api }) => {
  const ich = hold();
  api.stub(ME, ich.answer);
  await page.goto("/verteiler.html");

  await expect(page.locator("#verteiler-body")).toHaveText("Lade Verteiler …");
  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeHidden(); // noch weiß die Seite nicht, wer angemeldet ist
  ich.release({ json: admin() });

  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeVisible();
});

test("scheitert schon /me, bleibt „Neuen Verteiler anlegen“ versteckt — der Knopf stünde ohne Funktion da", async ({ page, api }) => {
  api.stub(ME, GATEWAY);
  await oeffne(page, "Laden fehlgeschlagen: Fehler (HTTP 502)");

  await expect(knopf(page, "Neuen Verteiler anlegen")).toBeHidden();
});

test("scheitert das Laden der Liste (500), steht der Fehlertext der API in der Tabelle und im Toast", async ({ page, api }) => {
  api.stub(LIST, DB_FEHLER);
  await oeffne(page, "Laden fehlgeschlagen: Datenbank nicht erreichbar");

  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
});

test("scheitert das Neuladen nach einer Aktion, verschwindet mit der Liste auch die alte Zählzeile", async ({ page, api }) => {
  api.stub(PATCH, { json: aus(adminTopic()) });
  await oeffne(page);
  await expect(page.locator("#anzahl")).toHaveText("1 Verteiler");
  api.stub(LIST, DB_FEHLER);

  await knopf(page, "Deaktivieren").click();

  await expect(page.locator("#verteiler-body")).toHaveText("Laden fehlgeschlagen: Datenbank nicht erreichbar");
  await expect(page.locator("#anzahl")).toHaveText("");
  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
});

test("scheitert schon /me (500), meldet die Seite den Fehler und fragt keine Admin-Daten ab", async ({ page, api }) => {
  api.stub(ME, DB_FEHLER);
  await oeffne(page, "Laden fehlgeschlagen: Datenbank nicht erreichbar");

  await expectToast(page, "Datenbank nicht erreichbar", { error: true });
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);
});

test("ohne Sitzung: Weiterleitung zum Login mit next=/verteiler.html", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/verteiler.html");

  await expect(page).toHaveURL("/auth/login?next=%2Fverteiler.html");
  await api.sync();
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/verteiler.html" }]);
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]); // sonst keine Anfrage
});

/* ---------- XSS: alles aus der API ist Text ---------- */

test("XSS: Name, Slug, Beschreibung und Zähler aus der API stehen als Text in der Liste", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({
    id: "s" + XSS, name: "N" + XSS, description: "B" + XSS, subscriber_count: "A" + XSS, dispatch_count: "M" + XSS,
  })] });
  await oeffne(page, /N<img/);

  await expect(page.locator("#verteiler-body").getByRole("cell"))
    .toHaveText(["N" + XSS + "s" + XSS, "B" + XSS, "A" + XSS, "M" + XSS, "BearbeitenDeaktivierenLöschen"]);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: beim Bearbeiten stehen Name, Slug und Beschreibung unverändert in den Feldern", async ({ page, api }) => {
  api.stub(LIST, { json: [adminTopic({ id: "s" + XSS, name: "N" + XSS, description: "B" + XSS })] });
  await oeffne(page, /N<img/);

  await knopf(page, "Bearbeiten").click();

  await expect(page.getByLabel("Name")).toHaveValue("N" + XSS);
  await expect(page.getByLabel("Slug")).toHaveValue("s" + XSS);
  await expect(page.getByLabel("Beschreibung")).toHaveValue("B" + XSS);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: Löschfrage und Erfolgsmeldung nennen Name und Slug wörtlich", async ({ page, api }) => {
  const boese = adminTopic({ id: "s" + XSS, name: "N" + XSS });
  const loeschen = "DELETE /api/v1/admin/topics/" + encodeURIComponent(boese.id);
  api.stub({ [LIST]: { json: [boese] }, [loeschen]: { status: 204 } });
  await oeffne(page, /N<img/);

  api.confirmNext(true);
  await knopf(page, "Löschen").click();

  await expectToast(page, "Verteiler „N" + XSS + "“ gelöscht");
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
  await api.sync();
  expect(api.dialogs).toEqual([frage("N" + XSS, "s" + XSS, KEINE_ABOS)]);
  expect(api.calls(loeschen)).toHaveLength(1);
});

test("XSS: auch mit Angriffstext im Slug findet der Tastaturfokus den Knopf der Zeile wieder — es entsteht kein Element", async ({ page, api }) => {
  const boese = adminTopic({ id: "s" + XSS, name: "Altlast" });
  const umschalten = "PATCH /api/v1/admin/topics/" + encodeURIComponent(boese.id);
  api.stub({ [LIST]: { json: [boese, NETZ] }, [umschalten]: { json: aus(boese) } });
  await oeffne(page, /Altlast/);
  api.stub(LIST, { json: [NETZ, aus(boese)] });

  await umschalter(page, "Altlast").press("Enter");

  await expect(umschalter(page, "Altlast")).toHaveText("Aktivieren");
  await expect(umschalter(page, "Altlast")).toBeFocused(); // der Slug steckt im Merkmal, über das der Knopf wiedergefunden wird
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: auch mit Angriffstext im Slug bleibt die neu gezeichnete Zeile gesperrt und wird mit ihrer Antwort frei — es entsteht kein Element", async ({ page, api }) => {
  const boese = adminTopic({ id: "s" + XSS, name: "Altlast" });
  const patch = hold();
  api.stub({
    [LIST]: { json: [boese, NETZ] },
    ["PATCH /api/v1/admin/topics/" + encodeURIComponent(boese.id)]: patch.answer,
    [PATCH_NETZ]: { json: aus(NETZ) },
  });
  await oeffne(page, /Altlast/);
  await umschalter(page, "Altlast").click();
  api.stub(LIST, { json: [boese, aus(NETZ)] });
  await umschalter(page, "Netzwerk").click(); // zeichnet die Liste neu
  await expect(umschalter(page, "Netzwerk")).toHaveText("Aktivieren");
  await expect(zeilenKnoepfe(page, "Altlast", true)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);

  patch.release(GATEWAY); // kein Neuladen: Die Freigabe findet die Zeile über den Slug

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilenKnoepfe(page, "Altlast", false)).toHaveText(["Bearbeiten", "Deaktivieren", "Löschen"]);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: der Fehlertext der API steht als Text in Tabelle und Toast", async ({ page, api }) => {
  api.stub(LIST, fehler(500, "INTERNAL", XSS));
  await oeffne(page, "Laden fehlgeschlagen: " + XSS);

  await expectToast(page, XSS, { error: true });
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("Netz weg beim Anlegen: der Hinweis steht im Toast, die Maske bleibt mit der Eingabe offen — ein zweites Speichern geht durch", async ({ page, api }) => {
  api.stub(CREATE, { abort: true });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();

  await expectToast(page, KEINE_VERBINDUNG, { error: true });
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await expect(knopf(page, "Speichern")).toBeEnabled();

  api.stub({ [CREATE]: ANGELEGT, [LIST]: { json: [adminTopic(), NETZ] } });
  await knopf(page, "Speichern").click();
  await expectToast(page, "Verteiler „Netzwerk“ angelegt");
  await expect(zeile(page, "Netzwerk")).toBeVisible();
});

test("Antwortet beim Speichern statt der API etwas davor (200 ohne JSON), meldet die Maske keinen Erfolg — sie bleibt mit der Eingabe offen", async ({ page, api }) => {
  api.stub(CREATE, ANMELDESEITE);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();

  await expectToast(page, KEINE_API_ANTWORT, { error: true });
  await expect(page.locator("#form-panel")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Netzwerk");
  await api.sync();
  expect(api.calls(LIST)).toHaveLength(1); // nichts gespeichert, also auch nichts neu geladen
});

test("Scheitert das per Tastatur über den Knopf ausgelöste Speichern, steht der Fokus wieder auf „Speichern“", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").focus();

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toBeFocused(); // der gesperrte Knopf verliert den Fokus
  post.release(SLUG_VERGEBEN);

  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeFocused(); // die Maske ist ja noch offen
});

test("Wer während des Speicherns zurück ins Namensfeld gegangen ist, behält dort den Fokus, wenn es scheitert", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toBeFocused();

  await page.getByLabel("Name").focus();
  post.release(SLUG_VERGEBEN);

  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(page.getByLabel("Name")).toBeFocused();
});

test("Wird per Tastatur ein Verteiler gelöscht, während die Maske eines anderen offen ist, übersteht deren Eingabe auch die nächste Eingabetaste", async ({ page, api }) => {
  const loeschung = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [DELETE_NETZ]: loeschung.answer });
  await oeffne(page);
  await zeile(page, "SAP Produktion").getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByLabel("Beschreibung").fill("Lange getippte Beschreibung");
  api.confirmNext(true);
  await loeseMitEnterAus(page, zeile(page, "Netzwerk").getByRole("button", { name: "Löschen" }));
  api.stub(LIST, { json: [adminTopic()] });
  loeschung.release({ status: 204 });
  await expectToast(page, "Verteiler „Netzwerk“ gelöscht");
  await expect(zeile(page, "Netzwerk")).toHaveCount(0);
  await api.sync();

  await page.keyboard.press("Enter"); // läge der Fokus auf „Neuen Verteiler anlegen“, ersetzte das die Maske durch eine leere

  await expect(page.getByRole("heading", { name: "Verteiler bearbeiten" })).toBeVisible();
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Lange getippte Beschreibung");
});

test("Maus: wer nach dem Klick auf „Speichern“ in die Liste zurückgescrollt hat, bleibt dort — die Ablehnung holt die Seite nicht zur Maske", async ({ page, api }) => {
  const post = hold();
  api.stub({ [LIST]: { json: VIELE }, [CREATE]: post.answer });
  await oeffne(page, /Verteiler 39/);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").click();
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(knopf(page, "Speichern")).not.toBeInViewport();

  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeFocused(); // der Fokus ist zurück …
  expect(await page.evaluate(() => window.scrollY)).toBe(0); // … die Seite steht, wo der Admin sie hingeschoben hat
});

test("Tastatur: wer während des Speicherns in die Liste zurückgeblättert hat, sieht nach der Ablehnung wieder „Speichern“", async ({ page, api }) => {
  const post = hold();
  api.stub({ [LIST]: { json: VIELE }, [CREATE]: post.answer });
  await oeffne(page, /Verteiler 39/);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").focus();
  await page.keyboard.press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(knopf(page, "Speichern")).not.toBeInViewport();

  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeFocused();
  await expect(knopf(page, "Speichern")).toBeInViewport(); // sonst träfe die nächste Eingabetaste einen Knopf, den man nicht sieht
});

test("Per Enter im Namensfeld gespeichert, danach neben die Felder geklickt: Die Ablehnung zieht den Fokus nicht auf „Speichern“", async ({ page, api }) => {
  const post = hold();
  api.stub(CREATE, post.answer);
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await page.getByLabel("Name").press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await page.getByRole("heading", { name: "Neuen Verteiler anlegen" }).click(); // nichts Fokussierbares
  await expect(page.locator("body")).toBeFocused();

  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeEnabled();
  await expect(page.locator("body")).toBeFocused(); // zurück bekommt den Fokus nur, wer ihn hatte
});

test("Tastatur: läuft noch ein Umschalten, wenn das Speichern scheitert, landet der Fokus auf „Speichern“ — nicht auf dem Knopf der Zeile", async ({ page, api }) => {
  const patch = hold();
  const post = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [PATCH_NETZ]: patch.answer, [CREATE]: post.answer });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Telefonie");
  await loeseMitEnterAus(page, umschalter(page, "Netzwerk"));
  await knopf(page, "Speichern").focus();
  await page.keyboard.press("Enter"); // zuletzt bedient ist jetzt „Speichern“
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();

  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });
  patch.release({ json: aus(NETZ) }); // die Antwort auf das Umschalten kommt zuerst
  await expectToast(page, "„Netzwerk“ deaktiviert");
  await api.sync();
  await expect(page.locator("body")).toBeFocused(); // die Zeile holt sich den Fokus nicht — die nächste Eingabetaste schaltete sonst zurück

  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeFocused();
});

test("Tastatur-Speichern läuft, dann ein Mausklick auf „Deaktivieren“ oben in der Liste: Die Ablehnung holt weder Fokus noch Seite zu „Speichern“", async ({ page, api }) => {
  const post = hold();
  const patch = hold();
  api.stub({ [LIST]: { json: VIELE }, [CREATE]: post.answer, "PATCH /api/v1/admin/topics/v0": patch.answer });
  await oeffne(page, /Verteiler 39/);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Netzwerk");
  await knopf(page, "Speichern").focus();
  await page.keyboard.press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await umschalter(page, "Verteiler 00").click(); // zuletzt bedient ist jetzt ein Zeilen-Knopf — mit der Maus
  await expect(umschalter(page, "Verteiler 00")).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  const vorher = await page.evaluate(() => window.scrollY);

  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeEnabled();
  await expect(page.locator("body")).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(vorher); // der Admin bleibt oben in der Liste
});

test("Tastatur-Speichern läuft, dann ein Zeilen-Knopf per Tastatur: Der Fokus gehört der Zeile — auch wenn das Speichern zuerst scheitert", async ({ page, api }) => {
  const post = hold();
  const patch = hold();
  api.stub({ [LIST]: { json: [adminTopic(), NETZ] }, [CREATE]: post.answer, [PATCH_NETZ]: patch.answer });
  await oeffne(page);
  await knopf(page, "Neuen Verteiler anlegen").click();
  await page.getByLabel("Name").fill("Telefonie");
  await knopf(page, "Speichern").focus();
  await page.keyboard.press("Enter");
  await expect(knopf(page, "Speichern")).toBeDisabled();
  await expect(page.locator("body")).toBeFocused();
  await loeseMitEnterAus(page, umschalter(page, "Netzwerk")); // zuletzt bedient ist jetzt der Knopf der Zeile

  post.release(SLUG_VERGEBEN);
  await expectToast(page, SLUG_VERGEBEN.json.detail, { error: true });
  await expect(knopf(page, "Speichern")).toBeEnabled();
  await expect(page.locator("body")).toBeFocused(); // „Speichern“ holt sich den Fokus nicht — die nächste Eingabetaste speicherte sonst erneut

  api.stub(LIST, { json: [adminTopic(), aus(NETZ)] });
  patch.release({ json: aus(NETZ) });
  await expectToast(page, "„Netzwerk“ deaktiviert");
  await expect(umschalter(page, "Netzwerk")).toBeFocused(); // er geht an die Zeile, deren Knopf jetzt „Aktivieren“ heißt
});
