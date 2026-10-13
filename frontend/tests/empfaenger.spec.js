/* empfaenger.html + empfaenger.js: Admin pflegt je Verteiler die Abos der aktiven Empfänger. */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const { me, admin, topic, user, liste, fehler, NICHT_ANGEMELDET, KEIN_ADMIN, KEINE_VERBINDUNG, XSS } = require("./daten");

const ME = "GET /api/v1/me";
const TOPICS = "GET /api/v1/topics";
const USERS = "GET /api/v1/admin/users";
const ABONNIEREN = "PUT /api/v1/admin/users/17/subscriptions/sap"; // Max: Zeile ohne Abo
const ABBESTELLEN = "DELETE /api/v1/admin/users/4/subscriptions/sap"; // Anna: Zeile mit Abo
const LOGIN = "GET /auth/login";
const LOGIN_STUB = { html: "<!DOCTYPE html><title>Login (Stub)</title>" };
const GATEWAY = { status: 502, html: "<h1>502 Bad Gateway</h1>" }; // NGINX, während das Backend neu startet
const ERSTE_SEITE = { is_active: "true", query: "", limit: "50", offset: "0" };
// „Mehr laden“ fragt mit einer Zeile Überlappung: ab der letzten geladenen Zeile, eine Zeile mehr als die Seite.
const ZWEITE_SEITE = { ...ERSTE_SEITE, limit: "51", offset: "49" };
// Rollen, wie die API sie liefert (backend/app/api/me.py): „employee“ hat jeder Angemeldete, ein Admin
// zusätzlich „admin“. Mit einer leeren Liste bliebe „hat irgendeine Rolle“ statt „ist Admin“ unbemerkt.
const ADMIN = admin({ roles: ["employee", "admin"] });
const OHNE_ADMINRECHT = me({ roles: ["employee"] });
// Die IDs haben bewusst nichts mit der Zeilenposition zu tun: Eine Anfrage für „die zweite Zeile“ statt
// für den Empfänger darf nicht zufällig stimmen.
const MAX = user({ id: 17 });
const ANNA = user({ id: 4, email: "anna@example.org", subscribed_topic_ids: ["sap"] });
const AARON = user({ id: 7, email: "aaron@example.org" }); // sortiert sich vor allen „nutzer…“ ein
const ZORA = user({ id: 9, email: "zora@example.org" }); // … und hinter allen

/** Empfänger mit fortlaufender Adresse — `anzahl` Stück ab der laufenden Nummer `ab`; die ID ist 1000 + Nummer. */
const seite = (ab, anzahl = 50) => Array.from({ length: anzahl }, (_, i) =>
  user({ id: 1000 + ab + i, email: "nutzer" + String(ab + i).padStart(3, "0") + "@example.org" }));
const adressen = (nutzer) => nutzer.map((eintrag) => eintrag.email);
/** Antwortet wie die API auf den Bestand `alle`: `limit` Zeilen ab dem angefragten offset, die Gesamtzahl ist seine
 *  AKTUELLE Länge — der Test darf den Bestand zwischen zwei Anfragen ändern (erster SSO-Login, Deaktivierung). */
const ausBestand = (alle) => (call) => {
  const offset = Number(call.query.offset);
  const limit = Number(call.query.limit);
  return { json: liste(alle.slice(offset, offset + limit), alle.length, limit, offset) };
};
/** … auf eine Liste mit `gesamt` fortlaufenden Empfängern. */
const blaettern = (gesamt) => ausBestand(seite(1, gesamt));
/** Die Antwort auf ZWEITE_SEITE bei `gesamt` (mindestens 100) fortlaufenden Empfängern: nutzer050, die
 *  Anschlusszeile, bis nutzer100. */
const zweiteSeite = (gesamt) => ({ json: liste(seite(50, 51), gesamt, 51, 49) });
/** Antwortet wie die API, wenn nur Anna zum Suchtext passt: ohne Suchtext kommen Max und Anna. */
const nurAnnaPasst = (call) => ({ json: liste(call.query.query ? [ANNA] : [MAX, ANNA]) });
/** … wenn nur Max zum Suchtext passt. */
const nurMaxPasst = (call) => ({ json: liste(call.query.query ? [MAX] : [MAX, ANNA]) });
/** Beantwortet die Anfragen der Reihe nach, die letzte Antwort gilt auch für alle weiteren — für Abläufe,
 *  in denen DIESELBE Anfrage erst so und dann anders ausgeht (an der Query nicht zu unterscheiden). */
const nacheinander = (...antworten) => {
  let nummer = 0;
  return (call) => {
    const antwort = antworten[Math.min(nummer, antworten.length - 1)];
    nummer += 1;
    return typeof antwort === "function" ? antwort(call) : antwort;
  };
};

// Was der Admin bedient und abliest
const auswahl = (page) => page.getByRole("combobox", { name: "Verteiler wählen" });
const suche = (page) => page.getByRole("textbox", { name: "Nach E-Mail filtern" });
const haken = (page, email) => page.getByRole("checkbox", { name: "Abonniert: " + email, exact: true });
const mehr = (page) => page.getByRole("button", { name: "Mehr laden" });
const navigation = (page) => page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link");
const zeilen = (page) => page.locator("#users-body tr");
const zaehler = (page) => page.locator("#result-count");
/** Die Zeilen, deren Haken gesetzt ist — in der Reihenfolge der Tabelle. */
const mitAbo = (page) => zeilen(page).filter({ has: page.getByRole("checkbox", { checked: true }) });
/** Was die Seite geschrieben hat (alles außer GET), in Reihenfolge. */
const geschrieben = (api) => api.calls().map((call) => call.key).filter((key) => !key.startsWith("GET "));

test.beforeEach(async ({ api }) => {
  api.stub({
    [ME]: { json: ADMIN },
    [TOPICS]: { json: [topic(), topic({ id: "notfall", name: "Notfall-Info", is_mandatory: true })] },
    [USERS]: { json: liste([MAX, ANNA]) },
  });
});

/** Seite öffnen und abwarten, was init() als Letztes zeichnet: die Verteiler in der Auswahl. */
async function oeffne(page, verteiler = ["SAP Produktion", "Notfall-Info (Pflicht)"]) {
  await page.goto("/empfaenger.html");
  await expect(page.locator("#topic-filter option")).toHaveText(["Verteiler auswählen …", ...verteiler]);
}

/** Verteiler wählen wie ein Admin und abwarten, bis seine Liste steht. */
async function waehle(page, verteiler, erwartet = [MAX.email, ANNA.email]) {
  await auswahl(page).selectOption({ label: verteiler });
  await expect(zeilen(page)).toHaveText(erwartet);
}

test("vor der Verteilerwahl: Aufforderung statt Liste, Filter gesperrt, keine Empfänger-Anfrage", async ({ page, api }) => {
  await oeffne(page);

  await expect(auswahl(page)).toHaveValue(""); // der Platzhalter „Verteiler auswählen …“: noch ist keiner gewählt
  // Später ist er nicht wieder wählbar — sonst bliebe eine Liste mit Haken stehen, zu der kein Verteiler gehört.
  await expect(auswahl(page).getByRole("option", { name: "Verteiler auswählen …" })).toBeDisabled();
  await expect(page.locator("#users-body")).toHaveText("Bitte zuerst einen Verteiler auswählen.");
  await expect(suche(page)).toBeDisabled();
  await expect(zaehler(page)).toBeEmpty();
  await expect(page.locator("#load-more")).toBeHidden();
  await expect(page.locator("#mandatory-hint")).toBeHidden();
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS]);
});

test("die Navigation zeigt dem Admin alle Verwaltungsseiten und hebt nur „Empfänger“ als aktuelle hervor", async ({ page }) => {
  const seiten = ["Meine Abos", "Meldungen", "Versand", "Empfänger", "Verteiler", "Rollen"];
  await oeffne(page);

  await expect(navigation(page)).toHaveText(seiten);
  for (const name of seiten) { // hervorgehoben heißt für den Nutzer: fett gesetzt
    await expect(navigation(page).filter({ hasText: name }))
      .toHaveCSS("font-weight", name === "Empfänger" ? "600" : "400");
  }
});

test("die Verteilerwahl lädt die erste Seite der AKTIVEN Empfänger und gibt den Filter frei", async ({ page, api }) => {
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await expect(zaehler(page)).toHaveText("2 von 2");
  await expect(suche(page)).toBeEnabled();
  await expect(page.locator("#load-more")).toBeHidden(); // alles geladen — nichts nachzuladen
  await expect(page.locator("#mandatory-hint")).toBeHidden();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE]);
  expect(api.calls(USERS)[0].headers["x-requested-with"]).toBe("fetch");
});

test("solange die Liste lädt, steht „Lade Empfänger …“ in der Tabelle", async ({ page, api }) => {
  const get = hold();
  api.stub(USERS, get.answer);
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  get.release({ json: liste([MAX, ANNA]) });

  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
});

test("beim Verteilerwechsel verschwinden die Haken des alten Verteilers sofort, nicht erst mit der neuen Liste", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, nacheinander({ json: liste([MAX, ANNA]) }, zweite.answer)); // die Liste des Wechsels hängt
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await auswahl(page).selectOption({ label: "Notfall-Info (Pflicht)" });

  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  await expect(page.getByRole("checkbox")).toHaveCount(0); // ein Klick träfe sonst schon den NEUEN Verteiler
  zweite.release({ json: liste([MAX, ANNA]) });
  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
});

test("der Haken zeigt das Abo des GEWÄHLTEN Verteilers — ein Abo woanders zählt nicht", async ({ page, api }) => {
  const nutzer = [
    user({ id: 1, email: "nur-sap@example.org", subscribed_topic_ids: ["sap"] }),
    user({ id: 2, email: "nur-kap@example.org", subscribed_topic_ids: ["kap"] }),
    user({ id: 3, email: "beide@example.org", subscribed_topic_ids: ["kap", "sap"] }),
    user({ id: 4, email: "keins@example.org" }),
  ];
  api.stub({ [TOPICS]: { json: [topic(), topic({ id: "kap", name: "KAP" })] }, [USERS]: { json: liste(nutzer) } });
  await oeffne(page, ["SAP Produktion", "KAP"]);

  await waehle(page, "SAP Produktion", adressen(nutzer));
  await expect(mitAbo(page)).toHaveText(["nur-sap@example.org", "beide@example.org"]);
  await waehle(page, "KAP", adressen(nutzer));
  await expect(mitAbo(page)).toHaveText(["nur-kap@example.org", "beide@example.org"]);
  await expect(haken(page, "keins@example.org")).toBeEnabled();
});

test("die Adresse steht in der Spalte „E-Mail“, der Haken mittig in der Spalte „Abonniert“", async ({ page }) => {
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await expect(page.getByRole("columnheader")).toHaveText(["E-Mail", "Abonniert"]);
  const zellen = page.getByRole("row").filter({ hasText: MAX.email }).getByRole("cell");
  await expect(zellen).toHaveText([MAX.email, ""]);
  await expect(zellen.last().getByRole("checkbox", { name: "Abonniert: " + MAX.email })).toBeVisible();
  await expect(zellen.last()).toHaveCSS("text-align", "center");
});

test("eine Meldung in der Tabelle steht mittig über beiden Spalten", async ({ page, api }) => {
  api.stub(USERS, { json: liste([]) });
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });

  const meldung = page.getByRole("cell", { name: "Noch keine aktiven Empfänger — sie entstehen beim ersten SSO-Login." });
  await expect(meldung).toHaveAttribute("colspan", "2"); // sonst steckte sie gequetscht unter „E-Mail“
  await expect(meldung).toHaveCSS("text-align", "center");
});

test("Pflicht-Verteiler: jeder Haken ist gesetzt und gesperrt — ein Klick darauf ändert und sendet nichts", async ({ page, api }) => {
  await oeffne(page);
  await waehle(page, "Notfall-Info (Pflicht)");

  await expect(page.locator("#mandatory-hint")).toContainText("die Abonnements sind hier deshalb gesperrt");
  await expect(page.locator("#mandatory-hint")).toBeVisible();
  for (const email of [MAX.email, ANNA.email]) { // „notfall“ steht bei keinem von beiden in den Abos
    await expect(haken(page, email)).toBeChecked();
    await expect(haken(page, email)).toBeDisabled();
    await expect(haken(page, email))
      .toHaveAttribute("title", "Pflicht-Verteiler — gilt automatisch für alle aktiven Empfänger");
  }
  // toBeDisabled() gilt auch für ein bloß als gesperrt AUSGEZEICHNETES Feld (aria-disabled) — der Klick zeigt,
  // dass der Browser ihn wirklich nicht annimmt.
  await haken(page, MAX.email).click({ force: true });
  await api.sync();
  await expect(haken(page, MAX.email)).toBeChecked();
  expect(geschrieben(api)).toEqual([]);
});

test("zurück auf einem abonnierbaren Verteiler verschwindet der Pflicht-Hinweis, die Haken sind frei", async ({ page }) => {
  await oeffne(page);
  await waehle(page, "Notfall-Info (Pflicht)");
  await expect(page.locator("#mandatory-hint")).toBeVisible();

  await waehle(page, "SAP Produktion");

  await expect(page.locator("#mandatory-hint")).toBeHidden();
  await expect(mitAbo(page)).toHaveText([ANNA.email]);
  await expect(haken(page, MAX.email)).toBeEnabled();
  await expect(haken(page, ANNA.email)).toBeEnabled();
});

test("Haken setzen sendet PUT ohne Body für den Empfänger dieser Zeile; der Toast nennt Verteiler und Adresse", async ({ page, api }) => {
  api.stub(ABONNIEREN, { status: 204 });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click();

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await expect(mitAbo(page)).toHaveText([MAX.email, ANNA.email]);
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN]); // genau EINE Schreibanfrage — und kein DELETE
  expect(api.calls(ABONNIEREN)[0].json).toBeNull();
  expect(api.calls(ABONNIEREN)[0].headers["x-requested-with"]).toBe("fetch"); // CSRF-Schutz der API
});

test("Haken entfernen sendet DELETE ohne Body für den Empfänger dieser Zeile; der Toast meldet die Abbestellung", async ({ page, api }) => {
  api.stub(ABBESTELLEN, { status: 204 });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, ANNA.email).click();

  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org");
  await expect(haken(page, ANNA.email)).not.toBeChecked();
  await api.sync();
  expect(geschrieben(api)).toEqual([ABBESTELLEN]);
  expect(api.calls(ABBESTELLEN)[0].json).toBeNull(); // wie beim PUT: kein Body — und kein Content-Type dafür
  expect(api.calls(ABBESTELLEN)[0].headers["content-type"]).toBeUndefined();
  expect(api.calls(ABBESTELLEN)[0].headers["x-requested-with"]).toBe("fetch");
});

test("hin und zurück: derselbe Haken sendet erst PUT, dann DELETE", async ({ page, api }) => {
  const zurueck = "DELETE /api/v1/admin/users/17/subscriptions/sap";
  api.stub({ [ABONNIEREN]: { status: 204 }, [zurueck]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await max.click();
  await expectToast(page, "Abbestellt: SAP Produktion für max@example.org");

  await expect(max).not.toBeChecked();
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN, zurueck]);
});

test("die Verteiler-ID steht URL-kodiert im Pfad der Anfrage", async ({ page, api }) => {
  const kodiert = "PUT /api/v1/admin/users/17/subscriptions/netz%2Fwlan%3Fa%3D1%26b";
  api.stub({ [TOPICS]: { json: [topic(), topic({ id: "netz/wlan?a=1&b", name: "Netz" })] }, [kodiert]: { status: 204 } });
  await oeffne(page, ["SAP Produktion", "Netz"]);
  await waehle(page, "Netz");

  await haken(page, MAX.email).click();

  await expectToast(page, "Abonniert: Netz für max@example.org");
  await api.sync();
  expect(geschrieben(api)).toEqual([kodiert]);
  expect(api.calls(kodiert)[0].query).toEqual({}); // „?a=1&b“ ist Teil der ID, keine Query
});

test("während die Anfrage läuft, ist der Haken gesperrt — ein zweiter Klick geht nicht durch", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await expect(max).toBeDisabled();
  await expect(max).toBeChecked(); // der Klick ist sofort zu sehen
  await max.click({ force: true }); // ungeduldiger zweiter Klick
  put.release({ status: 204 });

  await expect(max).toBeEnabled();
  await expect(max).toBeChecked();
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN]);
});

test("Abonnieren scheitert (409): der Haken springt zurück, der Text der API steht im Toast", async ({ page, api }) => {
  const absage = "„SAP Produktion“ ist ein Pflicht-Verteiler — er gilt automatisch für alle aktiven Empfänger " +
    "und wird nicht als Abo gepflegt";
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await expect(max).toBeChecked(); // gesetzt, solange die Anfrage läuft
  put.release(fehler(409, "TOPIC_MANDATORY", absage));

  await expectToast(page, absage, { error: true });
  await expect(max).not.toBeChecked();
  await expect(max).toBeEnabled(); // nach dem Fehler wieder bedienbar
});

test("Abbestellen scheitert (404): der Haken ist wieder gesetzt, der Text der API steht im Toast", async ({ page, api }) => {
  const del = hold();
  api.stub(ABBESTELLEN, del.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const anna = haken(page, ANNA.email);

  await anna.click();
  await expect(anna).not.toBeChecked(); // entfernt, solange die Anfrage läuft
  del.release(fehler(404, "USER_NOT_FOUND", "Empfänger 4 existiert nicht"));

  await expectToast(page, "Empfänger 4 existiert nicht", { error: true });
  await expect(anna).toBeChecked();
  await expect(anna).toBeEnabled();
});

test("wechselt der Admin während der Anfrage den Verteiler, nennt der Toast den Verteiler des Klicks", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click();
  await waehle(page, "Notfall-Info (Pflicht)");
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await api.sync();
  await expect(haken(page, MAX.email)).toBeDisabled(); // die späte Antwort gibt nicht den Pflicht-Haken frei
  expect(geschrieben(api)).toEqual([ABONNIEREN]);
});

test("auf einem anderen Verteiler zeigt die Zeile des Empfängers dessen Stand und ist frei — die Antwort ändert daran nichts", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: [topic(), topic({ id: "kap", name: "KAP" })] }, [ABONNIEREN]: put.answer });
  await oeffne(page, ["SAP Produktion", "KAP"]);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click(); // das Abonnieren von „SAP Produktion“ läuft noch …
  await waehle(page, "KAP"); // … da wechselt der Admin den Verteiler
  await expect(haken(page, MAX.email)).not.toBeChecked(); // „KAP“ hat Max nicht abonniert
  await expect(haken(page, MAX.email)).toBeEnabled();
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await api.sync();
  await expect(haken(page, MAX.email)).not.toBeChecked();
});

test("zurück auf dem Verteiler des Klicks zeigt die Zeile wieder den angefragten Zustand und ist gesperrt, bis die Antwort da ist", async ({ page, api }) => {
  const put = hold();
  api.stub({ [TOPICS]: { json: [topic(), topic({ id: "kap", name: "KAP" })] }, [ABONNIEREN]: put.answer });
  await oeffne(page, ["SAP Produktion", "KAP"]);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await waehle(page, "KAP");
  await waehle(page, "SAP Produktion"); // die Liste nennt für Max noch kein Abo
  await expect(max).toBeChecked();
  await expect(max).toBeDisabled();
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await expect(max).toBeEnabled();
  await expect(max).toBeChecked();
});

test("lädt die Liste während eines Umschaltens neu, zeigt die neue Zeile den angefragten Zustand und bleibt gesperrt", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurMaxPasst, [ABONNIEREN]: put.answer }); // die Liste kommt mit dem Stand VOR dem Schreiben: Max ohne Abo
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click(); // das Abonnieren läuft noch …
  await suche(page).fill("max");
  await page.clock.runFor(300); // … da lädt die Suche die Liste neu
  await expect(zeilen(page)).toHaveText([MAX.email]); // die neue Zeile für Max

  await expect(max).toBeChecked(); // nicht leer, wie die Liste ihn liefert
  await expect(max).toBeDisabled();
  await max.click({ force: true }); // gesperrt heißt: ein Klick sendet nichts …
  await max.focus();
  await expect(max).not.toBeFocused(); // … und die Tastatur erreicht den Haken nicht
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN]);
});

test("lädt die Liste während eines Umschaltens neu, zeigt die Zeile nach der Antwort, was gespeichert wurde — wie der Toast", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurMaxPasst, [ABONNIEREN]: put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click();
  await suche(page).fill("max");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([MAX.email]);
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await expect(haken(page, MAX.email)).toBeChecked();
  await expect(haken(page, MAX.email)).toBeEnabled(); // und wieder bedienbar
});

test("scheitert die Umschaltung nach einem Neuladen der Liste, springt der Haken der neuen Zeile zurück — wie der Toast", async ({ page, api }) => {
  const del = hold();
  api.stub({ [USERS]: nurAnnaPasst, [ABBESTELLEN]: del.answer }); // die Liste nennt Annas Abo weiter
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const anna = haken(page, ANNA.email);

  await anna.click(); // das Abbestellen läuft noch …
  await suche(page).fill("anna");
  await page.clock.runFor(300); // … da lädt die Suche die Liste neu
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(anna).not.toBeChecked(); // angefragt ist „abbestellt“
  del.release(fehler(404, "USER_NOT_FOUND", "Empfänger 4 existiert nicht"));

  await expectToast(page, "Empfänger 4 existiert nicht", { error: true });
  await expect(anna).toBeChecked();
  await expect(anna).toBeEnabled();
});

test("scheitert die Umschaltung, nachdem die neu geladene Liste das Abo schon gemeldet hat, bleibt der Haken auf dem Stand der Liste", async ({ page, api }) => {
  const put = hold();
  // Die neu geladene Liste nennt das Abo schon — etwa weil das Schreiben ankam und nur die Antwort verloren ging.
  const mitAboGemeldet = { ...MAX, subscribed_topic_ids: ["sap"] };
  api.stub({
    [USERS]: (call) => ({ json: liste(call.query.query ? [mitAboGemeldet] : [MAX, ANNA]) }),
    [ABONNIEREN]: put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await suche(page).fill("max");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([MAX.email]);
  put.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(max).toBeChecked(); // nicht zurück auf den Zustand vor dem Klick: Die Liste ist jünger
  await expect(max).toBeEnabled();
});

test("lädt die Liste während eines Umschaltens zweimal neu, bleibt die Zeile gesperrt — die Antwort gilt der Zeile, die dann dasteht", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurMaxPasst, [ABONNIEREN]: put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await suche(page).fill("max");
  await page.clock.runFor(300); // erstes Neuladen
  await expect(zeilen(page)).toHaveText([MAX.email]);
  await suche(page).fill("");
  await page.clock.runFor(300); // zweites Neuladen
  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
  await expect(max).toBeChecked();
  await expect(max).toBeDisabled();
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await expect(max).toBeEnabled();
  await expect(max).toBeChecked();
});

test("scheitert die Umschaltung nach zweimaligem Neuladen, springt der Haken der Zeile zurück, die dann dasteht", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurMaxPasst, [ABONNIEREN]: put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.click();
  await suche(page).fill("max");
  await page.clock.runFor(300); // erstes Neuladen
  await expect(zeilen(page)).toHaveText([MAX.email]);
  await suche(page).fill("");
  await page.clock.runFor(300); // zweites Neuladen
  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
  await expect(max).toBeChecked();
  put.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(max).not.toBeChecked();
  await expect(max).toBeEnabled();
});

test("laufen zwei Umschaltungen, während die Liste neu lädt, gilt jede Antwort der Zeile ihres Empfängers", async ({ page, api }) => {
  const put = hold();
  const del = hold();
  api.stub({
    [USERS]: (call) => ({ json: liste(call.query.query ? [ANNA, MAX] : [MAX, ANNA]) }), // die Suche liefert beide in anderer Reihenfolge
    [ABONNIEREN]: put.answer,
    [ABBESTELLEN]: del.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);
  const anna = haken(page, ANNA.email);

  await max.click(); // Max wird abonniert …
  await anna.click(); // … Anna abbestellt
  await suche(page).fill("example");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email, MAX.email]); // neu gezeichnet
  await expect(mitAbo(page)).toHaveText([MAX.email]); // beide zeigen, was angefragt ist
  del.release(fehler(404, "USER_NOT_FOUND", "Empfänger 4 existiert nicht"));
  await expectToast(page, "Empfänger 4 existiert nicht", { error: true });
  await expect(anna).toBeChecked();
  await expect(anna).toBeEnabled();
  await expect(max).toBeDisabled(); // seine Anfrage läuft noch
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await expect(max).toBeEnabled();
  await expect(mitAbo(page)).toHaveText([ANNA.email, MAX.email]);
});

test("lädt „Mehr laden“ während eines Umschaltens von vorn, bleibt die Umschaltung beim Empfänger — nicht bei der Zeile an seiner alten Stelle", async ({ page, api }) => {
  const put = hold();
  const bestand = seite(1, 120); // die Liste kommt weiter mit dem Stand VOR dem Schreiben: nutzer001 ohne Abo
  api.stub({ [USERS]: ausBestand(bestand), "PUT /api/v1/admin/users/1001/subscriptions/sap": put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  const erster = haken(page, "nutzer001@example.org");

  await erster.click(); // das Abonnieren läuft noch …
  bestand.unshift(AARON); // … da meldet sich jemand zum ersten Mal an
  await mehr(page).click(); // 121 statt 120: „Mehr laden“ lädt von vorn — nutzer001 steht jetzt in der zweiten Zeile
  await expect(zaehler(page)).toHaveText("50 von 121");
  await expect(mitAbo(page)).toHaveText(["nutzer001@example.org"]); // nicht Aaron, der jetzt an seiner Stelle steht
  await expect(erster).toBeDisabled();
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  await expect(erster).toBeEnabled();
  await expect(mitAbo(page)).toHaveText(["nutzer001@example.org"]);
  await expect(haken(page, AARON.email)).toBeEnabled();
});

test("steht der Empfänger nicht mehr in der Liste, wenn die Antwort kommt, meldet der Toast das Gespeicherte — die übrigen Zeilen bleiben, wie sie sind", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurAnnaPasst, [ABONNIEREN]: put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click(); // das Abonnieren läuft noch …
  await suche(page).fill("anna");
  await page.clock.runFor(300); // … da nimmt der Filter Max aus der Liste
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  put.release({ status: 204 });

  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await api.sync();
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(haken(page, ANNA.email)).toBeChecked();
  await expect(haken(page, ANNA.email)).toBeEnabled();
});

test("steht der Empfänger nicht mehr in der Liste, wenn die Umschaltung scheitert, steht der Fehler im Toast — die Zeile an seiner alten Stelle bleibt unberührt", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurAnnaPasst, [ABONNIEREN]: put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click(); // Max steht in der ersten Zeile …
  await suche(page).fill("anna");
  await page.clock.runFor(300); // … nach dem Filtern steht dort Anna
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  put.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await api.sync();
  await expect(haken(page, ANNA.email)).toBeChecked(); // der Rücksprung für Max nimmt Anna nicht den Haken
  await expect(haken(page, ANNA.email)).toBeEnabled();
});

test("kehrt der Empfänger nach der Antwort in die Liste zurück, zeigt seine Zeile den Stand der Liste und ist frei", async ({ page, api }) => {
  const put = hold();
  api.stub({ [USERS]: nurAnnaPasst, [ABONNIEREN]: put.answer });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  await haken(page, MAX.email).click();
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  put.release(GATEWAY); // gescheitert: Max bleibt ohne Abo
  await expectToast(page, "Fehler (HTTP 502)", { error: true });

  await suche(page).fill("");
  await page.clock.runFor(300);

  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
  await expect(haken(page, MAX.email)).not.toBeChecked(); // nicht mehr der angefragte Zustand
  await expect(haken(page, MAX.email)).toBeEnabled();
});

test("kommt die Antwort, während die Liste noch lädt, zeigt die Liste danach das Gespeicherte — auch wenn sie selbst noch den Stand davor trägt", async ({ page, api }) => {
  const put = hold();
  const suchantwort = hold();
  api.stub({
    [USERS]: (call) => (call.query.query ? suchantwort.answer() : { json: liste([MAX, ANNA]) }),
    [ABONNIEREN]: put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click(); // das Abonnieren läuft …
  await suche(page).fill("max");
  await page.clock.runFor(300); // … und die Suche ist unterwegs
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  suchantwort.release({ json: liste([MAX]) }); // vor dem Schreiben gelesen: Max ohne Abo

  await expect(zeilen(page)).toHaveText([MAX.email]);
  await expect(haken(page, MAX.email)).toBeChecked();
  await expect(haken(page, MAX.email)).toBeEnabled();
});

test("kommt die Antwort auf ein Abbestellen, während die Liste noch lädt, bleibt der Haken danach leer — auch wenn die Liste das Abo noch nennt", async ({ page, api }) => {
  const del = hold();
  const suchantwort = hold();
  api.stub({
    [USERS]: (call) => (call.query.query ? suchantwort.answer() : { json: liste([MAX, ANNA]) }),
    [ABBESTELLEN]: del.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, ANNA.email).click(); // das Abbestellen läuft …
  await suche(page).fill("anna");
  await page.clock.runFor(300); // … und die Suche ist unterwegs
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  del.release({ status: 204 });
  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org");
  suchantwort.release({ json: liste([ANNA]) }); // vor dem Schreiben gelesen: Anna mit Abo

  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(haken(page, ANNA.email)).not.toBeChecked(); // gemerkt ist „abbestellt“ — das ist nicht „nichts gemerkt“
  await expect(haken(page, ANNA.email)).toBeEnabled();
});

test("was für einen Verteiler gespeichert wurde, gilt nur für ihn — die Liste eines anderen Verteilers, die dabei noch lädt, zeigt dessen Stand", async ({ page, api }) => {
  const put = hold();
  const kapListe = hold();
  api.stub({
    [TOPICS]: { json: [topic(), topic({ id: "kap", name: "KAP" })] },
    [USERS]: nacheinander({ json: liste([MAX, ANNA]) }, kapListe.answer),
    [ABONNIEREN]: put.answer,
  });
  await oeffne(page, ["SAP Produktion", "KAP"]);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click(); // das Abonnieren von „SAP Produktion“ läuft …
  await auswahl(page).selectOption({ label: "KAP" }); // … und die Liste von „KAP“ ist unterwegs
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  kapListe.release({ json: liste([MAX, ANNA]) });

  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
  await expect(haken(page, MAX.email)).not.toBeChecked(); // „KAP“ hat Max nicht abonniert
  await expect(haken(page, MAX.email)).toBeEnabled();
});

test("eine Liste, die erst nach der Antwort angefragt wird, gilt wieder ganz", async ({ page, api }) => {
  const put = hold();
  const suchantwort = hold();
  api.stub({
    [USERS]: (call) => (call.query.query ? suchantwort.answer() : { json: liste([MAX, ANNA]) }),
    [ABONNIEREN]: put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  await haken(page, MAX.email).click();
  await suche(page).fill("max");
  await page.clock.runFor(300);
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  suchantwort.release({ json: liste([MAX]) });
  await expect(haken(page, MAX.email)).toBeChecked(); // die überholte Liste hat das Gespeicherte nicht verdrängt

  await suche(page).fill("");
  await page.clock.runFor(300); // diese Liste wird nach dem Schreiben gelesen

  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
  await expect(haken(page, MAX.email)).not.toBeChecked(); // … und nennt kein Abo: ein anderer Admin hat es wieder entfernt
});

test("auch eine Seite, die „Mehr laden“ erst nach der Antwort anfragt, gilt wieder ganz", async ({ page, api }) => {
  const put = hold();
  const [spaeter] = seite(60, 1); // nutzer060: ungefiltert erst auf der zweiten Seite
  api.stub({
    [USERS]: (call) => (call.query.query ? { json: liste([spaeter]) } : blaettern(120)(call)),
    "PUT /api/v1/admin/users/1060/subscriptions/sap": put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await suche(page).fill("nutzer060");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([spaeter.email]);

  await haken(page, spaeter.email).click(); // das Abonnieren läuft …
  await suche(page).fill("");
  await page.clock.runFor(300); // … da zeigt die Liste wieder alle: Seine Zeile steht nicht mehr da
  await expect(zaehler(page)).toHaveText("50 von 120");
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für nutzer060@example.org");
  await mehr(page).click(); // diese Seite wird nach dem Schreiben gelesen …

  await expect(zaehler(page)).toHaveText("100 von 120");
  await expect(haken(page, spaeter.email)).not.toBeChecked(); // … und nennt kein Abo: ein anderer Admin hat es wieder entfernt
  await expect(haken(page, spaeter.email)).toBeEnabled();
});

test("auch die Liste, die „Mehr laden“ erst nach der Antwort von vorn anfragt, gilt wieder ganz", async ({ page, api }) => {
  const zweite = hold();
  const vorn = hold();
  api.stub({
    [USERS]: nacheinander(blaettern(120), zweite.answer, vorn.answer),
    "PUT /api/v1/admin/users/1001/subscriptions/sap": { status: 204 },
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  const erster = haken(page, "nutzer001@example.org");

  await mehr(page).click(); // die zweite Seite ist unterwegs …
  await expect(mehr(page)).toBeDisabled();
  await erster.click(); // … da wird das Abo gespeichert
  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  zweite.release(zweiteSeite(121)); // 121 statt 120: Erst jetzt fragt die Seite die Liste von vorn an
  await expect.poll(() => api.calls(USERS)).toHaveLength(3);
  vorn.release({ json: liste(seite(1), 121) }); // nach dem Schreiben gelesen — und nennt kein Abo

  await expect(zaehler(page)).toHaveText("50 von 121");
  await expect(erster).not.toBeChecked(); // ein anderer Admin hat es wieder entfernt
  await expect(erster).toBeEnabled();
});

test("scheitert eine zweite Umschaltung, nachdem „Mehr laden“ von vorn geladen hat, gilt der Stand dieser Liste — nicht das zuvor Gespeicherte", async ({ page, api }) => {
  const del = hold();
  const zweite = hold();
  const vorn = hold();
  api.stub({
    [USERS]: nacheinander(blaettern(120), zweite.answer, vorn.answer),
    "PUT /api/v1/admin/users/1001/subscriptions/sap": { status: 204 },
    "DELETE /api/v1/admin/users/1001/subscriptions/sap": del.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  const erster = haken(page, "nutzer001@example.org");

  await mehr(page).click(); // die zweite Seite ist unterwegs …
  await expect(mehr(page)).toBeDisabled();
  await erster.click(); // … da wird das Abo gespeichert …
  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  await erster.click(); // … und gleich wieder abbestellt: Diese Anfrage läuft noch
  await expect(erster).toBeDisabled();
  zweite.release(zweiteSeite(121)); // 121 statt 120: Erst jetzt fragt die Seite die Liste von vorn an
  await expect.poll(() => api.calls(USERS)).toHaveLength(3);
  vorn.release({ json: liste(seite(1), 121) }); // sie nennt kein Abo: Das Abbestellen ist angekommen …
  await expect(zaehler(page)).toHaveText("50 von 121");
  await expect(erster).not.toBeChecked(); // der angefragte Zustand
  await expect(erster).toBeDisabled();
  del.release(GATEWAY); // … nur seine Antwort ging verloren

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(erster).not.toBeChecked(); // nicht zurück auf „abonniert“: Die Liste ist jünger als das Gespeicherte
  await expect(erster).toBeEnabled();
});

test("scheitert die Umschaltung, während die Liste noch lädt, zeigt die Liste danach ihren eigenen Stand", async ({ page, api }) => {
  const put = hold();
  const suchantwort = hold();
  api.stub({
    [USERS]: (call) => (call.query.query ? suchantwort.answer() : { json: liste([MAX, ANNA]) }),
    [ABONNIEREN]: put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click();
  await suche(page).fill("max");
  await page.clock.runFor(300);
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  put.release(GATEWAY);
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  suchantwort.release({ json: liste([MAX]) });

  await expect(zeilen(page)).toHaveText([MAX.email]);
  await expect(haken(page, MAX.email)).not.toBeChecked();
  await expect(haken(page, MAX.email)).toBeEnabled();
});

test("Tastatur: nach dem Umschalten mit der Leertaste liegt der Fokus wieder auf dem Haken", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.focus();
  await page.keyboard.press("Space");
  await expect(max).toBeDisabled();
  await expect(max).not.toBeFocused(); // einem gesperrten Feld nimmt der Browser den Fokus
  put.release({ status: 204 });

  await expect(max).toBeFocused();
  await expect(max).toBeChecked();
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN]); // die Leertaste sendet dasselbe wie der Klick
});

test("Tastatur: auch nach einem gescheiterten Umschalten liegt der Fokus wieder auf dem Haken", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  const max = haken(page, MAX.email);

  await max.focus();
  await page.keyboard.press("Space");
  await expect(max).toBeDisabled();
  await expect(max).not.toBeFocused();
  put.release(GATEWAY);

  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(max).toBeFocused(); // der nächste Versuch mit der Leertaste braucht keinen Weg zurück
  await expect(max).not.toBeChecked();
});

test("ein Haken, der beim Umschalten den Fokus gar nicht hatte, bekommt ihn danach auch nicht", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  await expect(page.locator("body")).toBeFocused();

  await haken(page, MAX.email).dispatchEvent("click"); // wie ein Tipp in Safari: schaltet um, fokussiert aber nicht
  await expect(haken(page, MAX.email)).toBeDisabled();
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await api.sync();

  await expect(page.locator("body")).toBeFocused(); // kein Sprung zu einem Feld, das der Admin nie fokussiert hatte
});

test("wer während der Anfrage ins Filterfeld wechselt, tippt dort weiter — ein Leerzeichen schaltet kein Abo um", async ({ page, api }) => {
  const put = hold();
  api.stub(ABONNIEREN, put.answer);
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).focus();
  await page.keyboard.press("Space");
  await suche(page).click();
  await page.keyboard.type("anna");
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");

  await expect(suche(page)).toBeFocused();
  await page.keyboard.type(" b");
  await expect(suche(page)).toHaveValue("anna b");
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN]);
});

test("wer während der Anfrage zum nächsten Haken weitergeht, bleibt dort — die Leertaste schaltet DIESEN Empfänger", async ({ page, api }) => {
  const put = hold();
  api.stub({ [ABONNIEREN]: put.answer, [ABBESTELLEN]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).focus();
  await page.keyboard.press("Space");
  await expect(haken(page, MAX.email)).toBeDisabled();
  await haken(page, ANNA.email).focus(); // weiter zur nächsten Zeile, während Max noch gespeichert wird
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");

  await expect(haken(page, ANNA.email)).toBeFocused(); // nicht zurück auf Max gesprungen
  await page.keyboard.press("Space");
  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org");
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN, ABBESTELLEN]);
});

test("laufen zwei Umschaltungen zugleich, kommt der Fokus auf den ZULETZT bedienten Haken zurück — die Leertaste trifft diese Zeile", async ({ page, api }) => {
  const erste = hold();
  const zweite = hold();
  const wieder = "PUT /api/v1/admin/users/4/subscriptions/sap";
  api.stub({ [ABONNIEREN]: erste.answer, [ABBESTELLEN]: zweite.answer, [wieder]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).focus();
  await page.keyboard.press("Space"); // Max wird gespeichert …
  await haken(page, ANNA.email).focus();
  await page.keyboard.press("Space"); // … und Anna gleich hinterher
  await expect(haken(page, ANNA.email)).toBeDisabled();
  erste.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für max@example.org");
  await api.sync();
  await expect(page.locator("body")).toBeFocused(); // nicht auf Max: die nächste Leertaste nähme ihm das Abo wieder
  zweite.release({ status: 204 });

  await expect(haken(page, ANNA.email)).toBeFocused();
  await page.keyboard.press("Space");
  await expectToast(page, "Abonniert: SAP Produktion für anna@example.org");
  await api.sync();
  expect(geschrieben(api)).toEqual([ABONNIEREN, ABBESTELLEN, wieder]);
});

test("wer nach dem Umschalten „Mehr laden“ drückt, behält den Fokus dort — die Antwort auf die Umschaltung holt ihn nicht in die Zeile", async ({ page, api }) => {
  const put = hold();
  const zweite = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(120)(call)),
    "PUT /api/v1/admin/users/1001/subscriptions/sap": put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await haken(page, "nutzer001@example.org").focus();
  await page.keyboard.press("Space"); // die Umschaltung läuft …
  await mehr(page).focus();
  await page.keyboard.press("Enter"); // … das Nachladen ebenfalls
  await expect(mehr(page)).toBeDisabled();
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  await api.sync();
  await expect(page.locator("body")).toBeFocused(); // nicht in der Zeile: Leertaste hieße dort „wieder abbestellen“
  zweite.release(zweiteSeite(120));

  await expect(mehr(page)).toBeFocused();
});

test("wer während des Nachladens einen Haken umschaltet, behält den Fokus in der Zeile — „Mehr laden“ holt ihn nicht zu sich", async ({ page, api }) => {
  const put = hold();
  const zweite = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(120)(call)),
    "PUT /api/v1/admin/users/1050/subscriptions/sap": put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter"); // das Nachladen läuft …
  await haken(page, "nutzer050@example.org").focus(); // … zurück in die letzte Zeile (Umschalt+Tab)
  await page.keyboard.press("Space"); // … und dort umgeschaltet
  await expect(haken(page, "nutzer050@example.org")).toBeDisabled();
  zweite.release(zweiteSeite(120));
  await expect(zaehler(page)).toHaveText("100 von 120");
  await expect(page.locator("body")).toBeFocused(); // nicht auf dem Knopf: zuletzt bedient wurde die Zeile
  put.release({ status: 204 });

  await expect(haken(page, "nutzer050@example.org")).toBeFocused();
});

test("auch ein Haken ohne Fokus ist der zuletzt bediente — das laufende „Mehr laden“ holt den Fokus danach nicht auf den Knopf", async ({ page, api }) => {
  const zweite = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(120)(call)),
    "PUT /api/v1/admin/users/1001/subscriptions/sap": { status: 204 },
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter"); // das Nachladen läuft …
  await expect(mehr(page)).toBeDisabled();
  await haken(page, "nutzer001@example.org").dispatchEvent("click"); // … da ein Tipp wie in Safari: schaltet um, fokussiert nicht
  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  zweite.release(zweiteSeite(120));
  await expect(zaehler(page)).toHaveText("100 von 120");

  await expect(page.locator("body")).toBeFocused(); // der Knopf war nicht mehr das zuletzt Bediente
});

test("Filter: erst 300 ms nach dem letzten Tastendruck geht genau EINE Anfrage raus", async ({ page, api }) => {
  api.stub(USERS, nurAnnaPasst);
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await suche(page).pressSequentially("ann"); // drei input-Ereignisse
  await page.clock.runFor(299);
  await suche(page).pressSequentially("a"); // ein weiterer Tastendruck startet die Frist neu
  await page.clock.runFor(299);
  await api.sync();
  expect(api.calls(USERS)).toHaveLength(1); // bisher nur die Abfrage der Verteilerwahl
  await page.clock.runFor(1);

  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(zaehler(page)).toHaveText("1 von 1");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.query)).toEqual(["", "anna"]);
});

test("Filter: der Suchtext geht getrimmt und URL-kodiert raus, die Liste beginnt wieder bei offset 0", async ({ page, api }) => {
  api.stub(USERS, (call) => (call.query.query ? { json: liste([ANNA]) } : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1))); // 50 von 120 geladen

  await suche(page).fill("  a+b&c=d#e% ");
  await page.clock.runFor(300);

  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, { ...ERSTE_SEITE, query: "a+b&c=d#e%" }]);
});

test("Filter leeren: nach 300 ms steht wieder die ganze Liste da", async ({ page, api }) => {
  api.stub(USERS, nurAnnaPasst);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email]);

  await suche(page).fill("");
  await page.clock.runFor(300);

  await expect(zeilen(page)).toHaveText([MAX.email, ANNA.email]);
  await expect(zaehler(page)).toHaveText("2 von 2");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.query)).toEqual(["", "anna", ""]);
});

test("das Filterfeld nimmt höchstens 200 Zeichen an — längere Suchtexte lehnt die API ab", async ({ page }) => {
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await suche(page).fill("a".repeat(199));
  await suche(page).pressSequentially("bc");

  await expect(suche(page)).toHaveValue("a".repeat(199) + "b");
});

test("beim Verteilerwechsel gilt der sichtbare Filter weiter", async ({ page, api }) => {
  api.stub(USERS, nurAnnaPasst);
  await oeffne(page);
  await waehle(page, "SAP Produktion");
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email]);

  await waehle(page, "Notfall-Info (Pflicht)", [ANNA.email]);

  await expect(suche(page)).toHaveValue("anna");
  await api.sync();
  const gefiltert = { ...ERSTE_SEITE, query: "anna" };
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, gefiltert, gefiltert]);
});

test("kein Treffer zum Filter: Hinweis statt Liste, „0 von 0“ — und „Mehr laden“ der alten Liste verschwindet", async ({ page, api }) => {
  api.stub(USERS, (call) => (call.query.query ? { json: liste([]) } : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeVisible(); // 70 fehlen noch

  await suche(page).fill("gibt-es-nicht");
  await page.clock.runFor(300);

  await expect(page.locator("#users-body")).toHaveText("Keine aktiven Empfänger zu diesem E-Mail-Filter.");
  await expect(zaehler(page)).toHaveText("0 von 0");
  await expect(page.locator("#load-more")).toBeHidden();
});

test("noch gar kein Empfänger: der Text erklärt, dass sie beim ersten SSO-Login entstehen", async ({ page, api }) => {
  api.stub(USERS, { json: liste([]) });
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });

  await expect(page.locator("#users-body"))
    .toHaveText("Noch keine aktiven Empfänger — sie entstehen beim ersten SSO-Login.");
  await expect(zaehler(page)).toHaveText("0 von 0");
  await expect(page.locator("#load-more")).toBeHidden(); // 0 von 0 ist „alles geladen“
});

test("Race: die verspätete Antwort auf eine ältere Suche ersetzt das neuere Ergebnis nicht", async ({ page, api }) => {
  const alt = hold();
  const neu = user({ id: 3, email: "neu@example.org" });
  api.stub(USERS, (call) => (call.query.query === "alt" ? alt.answer()
    : { json: liste(call.query.query === "neu" ? [neu] : [MAX, ANNA]) }));
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await suche(page).fill("alt");
  await page.clock.runFor(300); // erste Suche unterwegs (zurückgehalten)
  await suche(page).fill("neu");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([neu.email]);
  alt.release({ json: liste(seite(1), 120) });
  await api.sync();

  await expect(zeilen(page)).toHaveText([neu.email]);
  await expect(zaehler(page)).toHaveText("1 von 1");
  await expect(page.locator("#load-more")).toBeHidden();
});

test("Race: der verspätete FEHLER einer älteren Suche lässt Liste und Toast in Ruhe", async ({ page, api }) => {
  const alt = hold();
  api.stub({
    [USERS]: (call) => (call.query.query === "alt" ? alt.answer() : nurAnnaPasst(call)),
    [ABBESTELLEN]: { status: 204 },
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await suche(page).fill("alt");
  await page.clock.runFor(300); // erste Suche unterwegs (zurückgehalten)
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await haken(page, ANNA.email).click(); // im neueren Ergebnis weitergearbeitet: diesen Toast liest der Admin gerade
  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org");
  alt.release(GATEWAY);
  await api.sync();

  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org"); // nicht „Fehler (HTTP 502)“
  await expect(zeilen(page)).toHaveText([ANNA.email]); // nicht „Laden fehlgeschlagen: …“
});

test("Race: eine verspätete zweite Seite wird nicht an das inzwischen gefilterte Ergebnis gehängt", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer()
    : call.query.query ? { json: liste([ANNA]) } : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // zweite Seite unterwegs (zurückgehalten)
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  zweite.release(zweiteSeite(120));
  await api.sync();

  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(zaehler(page)).toHaveText("1 von 1");
  await expect(page.locator("#load-more")).toBeHidden();
});

test("Race: eine überholte Antwort gibt „Mehr laden“ nicht frei, solange die neuere Anfrage läuft", async ({ page, api }) => {
  const zweite = hold();
  const suchantwort = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer()
    : call.query.query ? suchantwort.answer() : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // zweite Seite unterwegs
  await suche(page).fill("nutzer");
  await page.clock.runFor(300); // die Suche überholt sie und läuft ebenfalls noch
  zweite.release(zweiteSeite(120));
  await api.sync();

  await expect(mehr(page)).toBeDisabled(); // ein Klick jetzt finge dieselbe Suche noch einmal von vorn an
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  suchantwort.release({ json: liste(seite(1), 120) });
  await expect(mehr(page)).toBeEnabled();
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
});

test("Race: wer zwischen zwei Verteilern hin- und herschaltet, bekommt die verspätete erste Liste nicht doppelt gezählt", async ({ page, api }) => {
  const erste = hold();
  api.stub(USERS, nacheinander(erste.answer, blaettern(120))); // nur die ERSTE Anfrage hängt
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  await waehle(page, "Notfall-Info (Pflicht)", adressen(seite(1)));
  await auswahl(page).selectOption({ label: "SAP Produktion" }); // wieder dieselbe Anfrage wie die hängende
  await expect(haken(page, "nutzer001@example.org")).toBeEnabled(); // die Liste des dritten Wechsels steht
  erste.release({ json: liste(seite(1), 120) });
  await api.sync();

  await expect(zaehler(page)).toHaveText("50 von 120"); // „100 von 120“ hieße: die verspätete Liste wurde mitgezählt
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
  await mehr(page).click();
  await expect(zaehler(page)).toHaveText("100 von 120");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "0", "0", "49"]);
});

test("„Mehr laden“ fragt mit einer Zeile Überlappung an: ab der letzten geladenen Zeile, eine Zeile mehr als die Seite", async ({ page, api }) => {
  api.stub(USERS, blaettern(170));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeEnabled(); // 120 fehlen noch: der Knopf ist da und bedienbar

  await mehr(page).click();
  await expect(zaehler(page)).toHaveText("100 von 170");
  await mehr(page).click();
  await expect(zaehler(page)).toHaveText("150 von 170");

  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, ZWEITE_SEITE, { ...ZWEITE_SEITE, offset: "99" }]);
});

test("hat sich die Liste nicht verändert, hängt „Mehr laden“ nur die neuen Zeilen an — keiner steht doppelt, keiner fehlt", async ({ page, api }) => {
  api.stub(USERS, blaettern(120));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(zaehler(page)).toHaveText("50 von 120");

  await mehr(page).click();
  await expect(zeilen(page)).toHaveText(adressen(seite(1, 100))); // nutzer050, die Anschlusszeile, steht einmal da
  await expect(zaehler(page)).toHaveText("100 von 120");
  await expect(mehr(page)).toBeVisible(); // 20 fehlen noch
  await mehr(page).click();

  await expect(zeilen(page)).toHaveText(adressen(seite(1, 120)));
  await expect(zaehler(page)).toHaveText("120 von 120");
  await expect(page.locator("#load-more")).toBeHidden();
});

test("„Mehr laden“ behält den Filter bei", async ({ page, api }) => {
  api.stub(USERS, (call) => blaettern(call.query.query ? 70 : 120)(call)); // zum Filter passen 70 der 120
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await suche(page).fill("nutzer");
  await page.clock.runFor(300);
  await expect(zaehler(page)).toHaveText("50 von 70"); // die gefilterte Liste steht

  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("70 von 70");
  await api.sync();
  const gefiltert = { ...ERSTE_SEITE, query: "nutzer" };
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, gefiltert, { ...ZWEITE_SEITE, query: "nutzer" }]);
});

test("„Mehr laden“ ist gesperrt, solange die nächste Seite lädt — die Liste bleibt dabei stehen", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click();
  await expect(mehr(page)).toBeDisabled();
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
  zweite.release(zweiteSeite(120));

  await expect(mehr(page)).toBeEnabled();
  await expect(zaehler(page)).toHaveText("100 von 120");
  await api.sync();
  expect(api.calls(USERS)).toHaveLength(2);
});

test("„Mehr laden“ ist auch gesperrt, solange eine neue Suche lädt", async ({ page, api }) => {
  const suchantwort = hold();
  api.stub(USERS, (call) => (call.query.query ? suchantwort.answer() : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeEnabled(); // 70 fehlen noch: der Knopf ist da und bedienbar

  await suche(page).fill("nutzer");
  await page.clock.runFor(300); // die Suche ist unterwegs (zurückgehalten)

  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  await expect(mehr(page)).toBeDisabled(); // ein Klick jetzt finge dieselbe Suche noch einmal von vorn an
  suchantwort.release({ json: liste(seite(1), 120) });
  await expect(mehr(page)).toBeEnabled();
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
});

test("„Mehr laden“ verschwindet, sobald alles geladen ist — auch wenn die letzte Seite voll war", async ({ page, api }) => {
  api.stub(USERS, blaettern(100));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeVisible();

  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("100 von 100");
  await expect(zeilen(page)).toHaveText(adressen(seite(1, 100)));
  await expect(page.locator("#load-more")).toBeHidden();
});

test("auch eine nachgeladene Zeile schaltet ihren eigenen Empfänger", async ({ page, api }) => {
  const abo75 = "PUT /api/v1/admin/users/1075/subscriptions/sap"; // die ID aus den Daten, nicht die Zeilennummer
  api.stub({ [USERS]: blaettern(120), [abo75]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await mehr(page).click();
  await expect(zaehler(page)).toHaveText("100 von 120");

  await haken(page, "nutzer075@example.org").click();

  await expectToast(page, "Abonniert: SAP Produktion für nutzer075@example.org");
  await api.sync();
  expect(geschrieben(api)).toEqual([abo75]);
});

test("Tastatur: nach „Mehr laden“ liegt der Fokus wieder auf dem Knopf — das nächste Enter lädt die nächste Seite", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(170)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter");
  await expect(mehr(page)).toBeDisabled();
  await expect(mehr(page)).not.toBeFocused(); // einem gesperrten Knopf nimmt der Browser den Fokus
  zweite.release(zweiteSeite(170));
  await expect(mehr(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(zaehler(page)).toHaveText("150 von 170");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "99"]);
});

test("Tastatur: auch nach einem gescheiterten Nachladen liegt der Fokus wieder auf dem Knopf — Enter versucht es erneut", async ({ page, api }) => {
  api.stub(USERS, nacheinander(blaettern(120), GATEWAY, blaettern(120))); // nur der erste Versuch scheitert
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter");
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(mehr(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(zaehler(page)).toHaveText("100 von 120");
});

test("nach „Mehr laden“ per Maus springt die Seite nicht: die neuen Zeilen schließen dort an, wo der Knopf war", async ({ page, api }) => {
  api.stub(USERS, blaettern(120));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // auch der Klick setzt den Fokus auf den Knopf

  await expect(zaehler(page)).toHaveText("100 von 120");
  await expect(mehr(page)).toBeFocused();
  await expect(mehr(page)).not.toBeInViewport(); // er ist mit den 50 neuen Zeilen nach unten gewandert …
  // … und die Seite ist ihm nicht gefolgt: Der Admin liest dort weiter, wo die neuen Zeilen beginnen.
  await expect(page.getByRole("cell", { name: "nutzer051@example.org", exact: true })).toBeInViewport();
});

test("wer während des Nachladens ins Filterfeld wechselt, tippt dort weiter — „Mehr laden“ holt den Fokus nicht zu sich", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter");
  await suche(page).click();
  await page.keyboard.type("nu");
  zweite.release(zweiteSeite(120));
  await expect(zaehler(page)).toHaveText("100 von 120");

  await expect(suche(page)).toBeFocused();
  await page.keyboard.type("tzer");
  await expect(suche(page)).toHaveValue("nutzer");
});

test("wer während des Nachladens ins Filterfeld gewechselt ist, bekommt den Fokus auch später nicht auf den Knopf gezogen", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(170)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await mehr(page).focus();
  await page.keyboard.press("Enter");
  await suche(page).click(); // weitergegangen, während die zweite Seite lädt
  zweite.release(zweiteSeite(170));
  await expect(zaehler(page)).toHaveText("100 von 170");
  await expect(suche(page)).toBeFocused(); // der Knopf hat verzichtet — und dabei bleibt es

  await suche(page).fill("nutzer");
  await page.getByRole("heading", { name: "Empfänger verwalten" }).click(); // neben das Feld geklickt: Fokus auf der Seite
  await page.clock.runFor(300);
  await expect(zaehler(page)).toHaveText("50 von 170"); // die gefilterte Liste steht, „Mehr laden“ ist wieder da

  await expect(mehr(page)).toBeEnabled();
  await expect(page.locator("body")).toBeFocused();
});

test("ein früheres „Mehr laden“ zieht den Fokus später nicht mehr an sich", async ({ page, api }) => {
  api.stub(USERS, blaettern(170));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await mehr(page).focus();
  await page.keyboard.press("Enter");
  await expect(zaehler(page)).toHaveText("100 von 170");
  await expect(mehr(page)).toBeFocused(); // nachgeladen, der Fokus ist zurück — damit ist die Sache erledigt

  await suche(page).fill("nutzer");
  await page.getByRole("heading", { name: "Empfänger verwalten" }).click(); // neben das Feld geklickt: Fokus auf der Seite
  await page.clock.runFor(300);
  await expect(zaehler(page)).toHaveText("50 von 170"); // die gefilterte Liste steht, „Mehr laden“ ist wieder da

  await expect(mehr(page)).toBeEnabled();
  await expect(page.locator("body")).toBeFocused();
});

test("Race: ein von der Suche überholtes „Mehr laden“ zieht den Fokus nicht mehr auf den Knopf — auch nicht mit seiner verspäteten Antwort", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(170)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter"); // die zweite Seite hängt
  await expect(mehr(page)).toBeDisabled();
  await suche(page).fill("nutzer");
  await page.getByRole("heading", { name: "Empfänger verwalten" }).click(); // neben das Feld geklickt: Fokus auf der Seite
  await page.clock.runFor(300); // die Suche überholt das Nachladen
  await expect(mehr(page)).toBeEnabled(); // die gefilterte Liste steht, der Knopf ist wieder bedienbar
  await expect(page.locator("body")).toBeFocused(); // gedrückt wurde er für die alte Liste — seitdem hat der Admin gefiltert
  zweite.release(zweiteSeite(170));
  await api.sync();

  await expect(page.locator("body")).toBeFocused();
  await expect(zaehler(page)).toHaveText("50 von 170");
});

test("kommt zwischen zwei Seiten ein Empfänger hinzu, lädt „Mehr laden“ von vorn — keiner steht doppelt, der Neue ist da", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, ausBestand(bestand));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  bestand.unshift(AARON); // erster SSO-Login: alle anderen rutschen eine Stelle nach hinten
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 121");
  // Angehängt stünde nutzer050 zweimal da — zwei Haken für dasselbe Abo —, und Aaron fehlte.
  await expect(zeilen(page)).toHaveText([AARON.email, ...adressen(seite(1, 49))]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("fällt zwischen zwei Seiten ein Empfänger weg, lädt „Mehr laden“ von vorn — er steht nicht mehr da, keiner wird übersprungen", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, ausBestand(bestand));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  bestand.splice(9, 1); // nutzer010 wurde deaktiviert: alle dahinter rücken eine Stelle auf
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 119");
  // Angehängt bliebe nutzer010 mit freiem Haken stehen, und nutzer051 erschiene nie.
  await expect(zeilen(page)).toHaveText([...adressen(seite(1, 9)), ...adressen(seite(11, 41))]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("kommt ein Empfänger hinzu, während ein anderer wegfällt, lädt „Mehr laden“ ebenfalls von vorn — die Gesamtzahl bleibt gleich, die Anschlusszeile verrät die Verschiebung", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, ausBestand(bestand));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  bestand.unshift(AARON); // erster SSO-Login …
  bestand.pop(); // … und nutzer120 wurde deaktiviert: wieder 120, aber alle stehen eine Stelle weiter hinten
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 120");
  // Angehängt stünde nutzer050 zweimal da — zwei Haken für dasselbe Abo —, und Aaron fehlte.
  await expect(zeilen(page)).toHaveText([AARON.email, ...adressen(seite(1, 49))]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("fällt ein Empfänger weg, während dahinter einer hinzukommt, lädt „Mehr laden“ ebenfalls von vorn — keiner wird übersprungen", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, ausBestand(bestand));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  bestand.splice(9, 1); // nutzer010 wurde deaktiviert …
  bestand.push(ZORA); // … und Zora hat sich zum ersten Mal angemeldet: wieder 120, aber ab nutzer011 stehen alle eine Stelle weiter vorn
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 120");
  // Angehängt bliebe nutzer010 mit freiem Haken stehen, und nutzer051 erschiene nie.
  await expect(zeilen(page)).toHaveText([...adressen(seite(1, 9)), ...adressen(seite(11, 41))]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("ist die letzte geladene Zeile inzwischen weggefallen, lädt „Mehr laden“ von vorn — sie steht nicht mehr da", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, ausBestand(bestand));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  bestand.splice(49, 1); // nutzer050, die letzte geladene Zeile, wurde deaktiviert …
  bestand.push(ZORA); // … und Zora ist hinzugekommen: die Gesamtzahl bleibt 120
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 120");
  // Angehängt bliebe nutzer050 mit freiem Haken stehen, und nutzer051 erschiene nie.
  await expect(zeilen(page)).toHaveText([...adressen(seite(1, 49)), "nutzer051@example.org"]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("schrumpft die Liste unter das schon Geladene, zeigt sie nach „Mehr laden“ nur noch die Verbliebenen — der Knopf verschwindet", async ({ page, api }) => {
  // Drei wurden nach der ersten Seite deaktiviert: Es gibt nur noch 49, ab offset 49 kommt nichts mehr.
  api.stub(USERS, nacheinander(blaettern(52), blaettern(49)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeVisible();

  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("49 von 49"); // nicht „50 von 49“
  await expect(zeilen(page)).toHaveText(adressen(seite(1, 49)));
  await expect(page.locator("#load-more")).toBeHidden();
});

test("das Neuladen von vorn behält den Filter — danach blättert „Mehr laden“ normal weiter", async ({ page, api }) => {
  const treffer = seite(1, 70); // zum Filter passen 70 der 120
  api.stub(USERS, (call) => (call.query.query ? ausBestand(treffer) : blaettern(120))(call));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await suche(page).fill("nutzer");
  await page.clock.runFor(300);
  await expect(zaehler(page)).toHaveText("50 von 70");

  treffer.unshift(user({ id: 8, email: "benutzer@example.org" })); // erster SSO-Login, passt zum Filter
  await mehr(page).click();
  await expect(zaehler(page)).toHaveText("50 von 71");
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("71 von 71");
  await expect(zeilen(page)).toHaveText(["benutzer@example.org", ...adressen(seite(1, 70))]);
  await api.sync();
  const gefiltert = { ...ERSTE_SEITE, query: "nutzer" };
  const weiter = { ...ZWEITE_SEITE, query: "nutzer" };
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, gefiltert, weiter, gefiltert, weiter]);
});

test("ändert sich die Gesamtzahl bei jeder Anfrage, lädt ein Klick trotzdem nur EINMAL von vorn", async ({ page, api }) => {
  let gesamt = 120;
  api.stub(USERS, (call) => blaettern(gesamt++)(call)); // jede Antwort meldet einen Empfänger mehr
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // Seite 2 meldet 121 → von vorn; die Antwort darauf meldet schon 122

  await expect(zaehler(page)).toHaveText("50 von 122");
  await expect(mehr(page)).toBeEnabled(); // keine Schleife: der nächste Schritt ist wieder Sache des Admins
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("Tastatur: lädt „Mehr laden“ von vorn, liegt der Fokus danach wieder auf dem Knopf — das nächste Enter blättert weiter", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, ausBestand(bestand));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  bestand.unshift(AARON); // erster SSO-Login: Seite 2 meldet 121 statt 120

  await mehr(page).focus();
  await page.keyboard.press("Enter");
  await expect(zaehler(page)).toHaveText("50 von 121");
  await expect(mehr(page)).toBeFocused(); // beide Anfragen gehören zu diesem einen Tastendruck
  await page.keyboard.press("Enter");

  await expect(zaehler(page)).toHaveText("100 von 121");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49"]);
});

test("scheitert das Neuladen von vorn, bleibt die Liste stehen — der nächste Klick lädt wieder von vorn, statt anzuhängen", async ({ page, api }) => {
  const bestand = seite(1, 120);
  api.stub(USERS, nacheinander(ausBestand(bestand), ausBestand(bestand), GATEWAY, ausBestand(bestand)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  bestand.unshift(AARON); // erster SSO-Login: Seite 2 meldet 121 statt 120

  await mehr(page).click(); // … und das Neuladen von vorn scheitert
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
  await expect(zaehler(page)).toHaveText("50 von 120");
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 121");
  await expect(zeilen(page)).toHaveText([AARON.email, ...adressen(seite(1, 49))]);
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "49", "0"]);
});

test("scheitert das Neuladen von vorn, nehmen die stehengebliebenen Zeilen wieder Umschaltungen an", async ({ page, api }) => {
  const bestand = seite(1, 120);
  const abo = "PUT /api/v1/admin/users/1001/subscriptions/sap";
  api.stub({ [USERS]: nacheinander(ausBestand(bestand), ausBestand(bestand), GATEWAY), [abo]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  bestand.unshift(AARON); // erster SSO-Login: Seite 2 meldet 121 statt 120

  await mehr(page).click(); // … und das Neuladen von vorn scheitert
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await haken(page, "nutzer001@example.org").click(); // gesperrt waren die Zeilen nur, solange die Anfrage lief

  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  await api.sync();
  expect(geschrieben(api)).toEqual([abo]);
});

test("während von vorn geladen wird, nimmt die alte Liste keine Umschaltung an — die neue danach schon", async ({ page, api }) => {
  const vorn = hold();
  const bestand = seite(1, 120);
  const abo = "PUT /api/v1/admin/users/1001/subscriptions/sap";
  api.stub({ [USERS]: nacheinander(ausBestand(bestand), ausBestand(bestand), vorn.answer), [abo]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  bestand.unshift(AARON);

  await mehr(page).click(); // Seite 2 meldet 121 statt 120 — das Neuladen von vorn hängt
  await expect.poll(() => api.calls(USERS)).toHaveLength(3);
  await haken(page, "nutzer001@example.org").click({ force: true }); // stünde in der neuen Liste womöglich noch nicht drin
  await api.sync();
  expect(geschrieben(api)).toEqual([]);
  await expect(haken(page, "nutzer001@example.org")).not.toBeChecked();
  vorn.release({ json: liste([AARON, ...seite(1, 49)], 121) });
  await expect(zaehler(page)).toHaveText("50 von 121");

  await haken(page, "nutzer001@example.org").click();
  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
});

test("während von vorn geladen wird, schaltet auch die Leertaste nichts um — der Fokus liegt nicht mehr in der Zeile", async ({ page, api }) => {
  const zweite = hold();
  const vorn = hold();
  api.stub(USERS, nacheinander(blaettern(120), zweite.answer, vorn.answer));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter"); // die zweite Seite lädt …
  await haken(page, "nutzer050@example.org").focus(); // … zurück in die letzte Zeile (Umschalt+Tab)
  zweite.release(zweiteSeite(121)); // 121 statt 120 — das Neuladen von vorn hängt
  await expect.poll(() => api.calls(USERS)).toHaveLength(3);
  await expect(page.locator("body")).toBeFocused(); // gesperrt heißt auch für die Tastatur gesperrt
  await page.keyboard.press("Space");
  await api.sync();

  expect(geschrieben(api)).toEqual([]);
  await expect(haken(page, "nutzer050@example.org")).not.toBeChecked();
  vorn.release({ json: liste([AARON, ...seite(1, 49)], 121) });
  await expect(zaehler(page)).toHaveText("50 von 121");
});

test("Race: eine überholte ältere Antwort gibt die Zeilen nicht frei, solange von vorn geladen wird", async ({ page, api }) => {
  const erste = hold(); // die allererste Liste hängt und wird überholt
  const vorn = hold();
  const bestand = seite(1, 120);
  api.stub(USERS, nacheinander(erste.answer, ausBestand(bestand), ausBestand(bestand), ausBestand(bestand), vorn.answer));
  await oeffne(page);
  await auswahl(page).selectOption({ label: "SAP Produktion" });
  await expect(page.locator("#users-body")).toHaveText("Lade Empfänger …");
  await waehle(page, "Notfall-Info (Pflicht)", adressen(seite(1)));
  await auswahl(page).selectOption({ label: "SAP Produktion" });
  await expect(haken(page, "nutzer001@example.org")).toBeEnabled(); // die Liste des dritten Wechsels steht
  bestand.unshift(AARON);

  await mehr(page).click(); // Seite 2 meldet 121 statt 120 — das Neuladen von vorn hängt
  await expect.poll(() => api.calls(USERS)).toHaveLength(5);
  erste.release({ json: liste(seite(1), 120) }); // jetzt erst kommt die Antwort auf die allererste Anfrage
  await api.sync();
  await haken(page, "nutzer001@example.org").click({ force: true });
  await api.sync();

  expect(geschrieben(api)).toEqual([]);
  await expect(haken(page, "nutzer001@example.org")).not.toBeChecked();
  vorn.release({ json: liste([AARON, ...seite(1, 49)], 121) });
  await expect(zaehler(page)).toHaveText("50 von 121");
});

test("Race: wer während des Neuladens von vorn filtert, bekommt sein Filterergebnis — die verspätete erste Seite ersetzt es nicht", async ({ page, api }) => {
  const vorn = hold();
  api.stub({
    [USERS]: nacheinander(blaettern(120), blaettern(121), vorn.answer, { json: liste([ANNA]) }),
    [ABBESTELLEN]: { status: 204 },
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // Seite 2 meldet 121 statt 120 — das Neuladen von vorn hängt
  await expect.poll(() => api.calls(USERS)).toHaveLength(3);
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  vorn.release({ json: liste(seite(1), 121) });
  await api.sync();

  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(zaehler(page)).toHaveText("1 von 1");
  await haken(page, ANNA.email).click(); // … und es ist bedienbar
  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org");
});

test("Race: die verspätete erste Seite verstellt auch den Blätterstand des Filterergebnisses nicht — „Mehr laden“ holt dessen zweite Seite", async ({ page, api }) => {
  const vorn = hold();
  api.stub(USERS, nacheinander(blaettern(120), blaettern(121), vorn.answer, blaettern(70))); // zum Filter passen 70
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // Seite 2 meldet 121 statt 120 — das Neuladen von vorn hängt
  await expect.poll(() => api.calls(USERS)).toHaveLength(3);
  await suche(page).fill("nutzer");
  await page.clock.runFor(300);
  await expect(zaehler(page)).toHaveText("50 von 70");
  vorn.release({ json: liste(seite(1), 121) });
  await api.sync();
  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("70 von 70"); // „50 von 70“ hieße: statt der zweiten Seite kam noch einmal die erste
  await expect(zeilen(page)).toHaveText(adressen(seite(1, 70)));
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0", "0", "49"]);
});

test("Race: eine überholte zweite Seite mit anderer Gesamtzahl lädt nichts von vorn — das Filterergebnis bleibt bedienbar", async ({ page, api }) => {
  const zweite = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? zweite.answer()
      : call.query.query ? { json: liste([ANNA]) } : blaettern(120)(call)),
    [ABBESTELLEN]: { status: 204 },
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click(); // zweite Seite unterwegs (zurückgehalten)
  await suche(page).fill("anna");
  await page.clock.runFor(300);
  await expect(zeilen(page)).toHaveText([ANNA.email]);
  zweite.release(zweiteSeite(121)); // inzwischen 121 statt 120
  await api.sync();

  await haken(page, ANNA.email).click();
  await expectToast(page, "Abbestellt: SAP Produktion für anna@example.org");
  await api.sync();
  expect(api.calls(USERS)).toHaveLength(3); // erste Seite, zweite Seite, Suche — kein Neuladen für eine Liste, die es nicht mehr gibt
});

test("liefert das Nachladen bei unveränderter Gesamtzahl nur die Anschlusszeile, bleibt die Liste stehen", async ({ page, api }) => {
  const zweite = hold();
  api.stub(USERS, (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(51)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await mehr(page).click();
  await expect(mehr(page)).toBeDisabled();

  // Widersprüchlich, aber möglich — Gesamtzahl und Zeilen kommen aus zwei Abfragen: 51 gemeldet, hinter nutzer050 nichts.
  zweite.release({ json: liste(seite(50, 1), 51, 51, 49) });
  await expect(mehr(page)).toBeEnabled(); // die Antwort ist verarbeitet
  await expect(zeilen(page)).toHaveText(adressen(seite(1))); // nutzer050 steht weiter genau einmal da
  await expect(zaehler(page)).toHaveText("50 von 51");
  await api.sync();
  expect(api.calls(USERS)).toHaveLength(2); // die Antwort schließt an — kein Neuladen von vorn
});

test("liefert das Nachladen bei unveränderter Gesamtzahl gar keine Zeile, lädt „Mehr laden“ von vorn", async ({ page, api }) => {
  // Ebenso widersprüchlich: 51 gemeldet, aber nicht einmal die Anschlusszeile kommt — die Liste hat sich bewegt.
  api.stub(USERS, nacheinander(blaettern(51), { json: liste([], 51, 51, 49) }, blaettern(50)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click();

  await expect(zaehler(page)).toHaveText("50 von 50");
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
  await expect(page.locator("#load-more")).toBeHidden();
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "0"]);
});

test("nennt die API eine kleinere Gesamtzahl, als sie Zeilen liefert, bleibt trotzdem kein „Mehr laden“ stehen", async ({ page, api }) => {
  api.stub(USERS, { json: liste(seite(1), 49) }); // widersprüchlich wie oben: 50 Zeilen, aber „49“ gemeldet
  await oeffne(page);

  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await expect(zaehler(page)).toHaveText("50 von 49");
  await expect(page.locator("#load-more")).toBeHidden(); // sonst bliebe ein Knopf, der nichts mehr zu laden hat
});

test("meldet die API Empfänger, liefert aber keine Zeile, lädt „Mehr laden“ von vorn — ohne Anschlusszeile gibt es keine Überlappung", async ({ page, api }) => {
  api.stub(USERS, nacheinander({ json: liste([], 1) }, { json: liste([MAX]) })); // widersprüchlich wie oben: „1“ gemeldet, keine Zeile
  await oeffne(page);
  await auswahl(page).selectOption({ label: "SAP Produktion" });
  await expect(zaehler(page)).toHaveText("0 von 1");

  await mehr(page).click();

  await expect(zeilen(page)).toHaveText([MAX.email]);
  await expect(zaehler(page)).toHaveText("1 von 1");
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query)).toEqual([ERSTE_SEITE, ERSTE_SEITE]); // nicht offset −1: das lehnte die API ab
});

test("ohne Adminrecht: Erklärung statt Liste, Auswahl und Filter gesperrt, keine Admin-Anfrage", async ({ page, api }) => {
  api.stub(ME, { json: OHNE_ADMINRECHT });
  await page.goto("/empfaenger.html");

  await expect(page.locator("#users-body")).toHaveText(
    "Für die Empfänger-Verwaltung fehlt dir die Berechtigung (im Portal vergebenes Adminrecht).");
  await expect(auswahl(page)).toBeDisabled();
  await expect(suche(page)).toBeDisabled();
  await expect(page.locator("#load-more")).toBeHidden();
  await expect(navigation(page)).toHaveText(["Meine Abos", "Meldungen"]);
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]);
});

test("die Verteiler lassen sich nicht laden: Meldung in der Tabelle und als Toast, nichts ist wählbar", async ({ page, api }) => {
  api.stub(TOPICS, GATEWAY);
  await page.goto("/empfaenger.html");

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 502)");
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(page.locator("#topic-filter option")).toHaveText(["Verteiler auswählen …"]);
  await expect(suche(page)).toBeDisabled();
});

test("die Empfängerliste lässt sich nicht laden: „Laden fehlgeschlagen: …“ in der Tabelle plus Toast", async ({ page, api }) => {
  api.stub(USERS, KEIN_ADMIN); // z. B. Adminrecht zwischen /me und der Liste entzogen
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Keine Berechtigung für diese Funktion");
  await expectToast(page, "Keine Berechtigung für diese Funktion", { error: true });
  await expect(zaehler(page)).toBeEmpty();
  await expect(page.locator("#load-more")).toBeHidden();
});

test("nach einem Ladefehler ist die Seite nicht festgefahren: die nächste Suche bringt die Liste", async ({ page, api }) => {
  api.stub(USERS, (call) => (call.query.query ? { json: liste([ANNA]) } : GATEWAY));
  await oeffne(page);
  await auswahl(page).selectOption({ label: "SAP Produktion" });
  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 502)");

  await suche(page).fill("anna");
  await page.clock.runFor(300);

  await expect(zeilen(page)).toHaveText([ANNA.email]);
  await expect(zaehler(page)).toHaveText("1 von 1");
});

test("Nachladen scheitert: die Liste bleibt stehen, nur ein Toast — der nächste Klick holt die Seite nach", async ({ page, api }) => {
  api.stub(USERS, nacheinander(blaettern(120), GATEWAY, blaettern(120))); // nur der erste Versuch scheitert
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).click();
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zeilen(page)).toHaveText(adressen(seite(1)));
  await expect(zaehler(page)).toHaveText("50 von 120");
  await expect(mehr(page)).toBeEnabled(); // nach dem Fehler wieder bedienbar
  await mehr(page).click();

  await expect(zeilen(page)).toHaveText(adressen(seite(1, 100)));
  await api.sync();
  expect(api.calls(USERS).map((call) => call.query.offset)).toEqual(["0", "49", "49"]);
});

test("die Suche scheitert: Fehlermeldung statt Liste — Zähler und „Mehr laden“ der alten Liste verschwinden", async ({ page, api }) => {
  api.stub(USERS, (call) => (call.query.query ? GATEWAY : blaettern(120)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeVisible(); // 50 von 120

  await suche(page).fill("anna");
  await page.clock.runFor(300);

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: Fehler (HTTP 502)");
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
  await expect(zaehler(page)).toBeEmpty(); // die Liste dazu gibt es nicht mehr
  await expect(page.locator("#load-more")).toBeHidden(); // zur Fehlermeldung gibt es nichts nachzuladen
});

test("der Verteilerwechsel scheitert: Fehlermeldung statt Liste — Zähler und „Mehr laden“ der alten Liste verschwinden", async ({ page, api }) => {
  api.stub(USERS, nacheinander(blaettern(120), { abort: true })); // beim Wechsel ist die Verbindung weg
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));
  await expect(mehr(page)).toBeVisible();

  await auswahl(page).selectOption({ label: "Notfall-Info (Pflicht)" });

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: " + KEINE_VERBINDUNG);
  await expectToast(page, KEINE_VERBINDUNG, { error: true });
  await expect(zaehler(page)).toBeEmpty();
  await expect(page.locator("#load-more")).toBeHidden();
});

test("Race: die verspätete Antwort eines überholten „Mehr laden“ zieht den Fokus auch dann nicht auf den Knopf, wenn inzwischen ein späteres „Mehr laden“ fertig ist", async ({ page, api }) => {
  const alt = hold(); // die zweite Seite der UNGEFILTERTEN Liste hängt
  api.stub(USERS, (call) => (call.query.offset === "49" && !call.query.query ? alt.answer() : blaettern(170)(call)));
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await mehr(page).focus();
  await page.keyboard.press("Enter"); // hängt
  await expect(mehr(page)).toBeDisabled();
  await suche(page).fill("nutzer");
  await page.clock.runFor(300); // die Suche überholt das Nachladen
  await expect(zaehler(page)).toHaveText("50 von 170");
  await mehr(page).focus();
  await page.keyboard.press("Enter"); // „Mehr laden“ für die gefilterte Liste
  await expect(zaehler(page)).toHaveText("100 von 170");
  await expect(mehr(page)).toBeFocused(); // erledigt: der Fokus ist zurück
  await page.getByRole("heading", { name: "Empfänger verwalten" }).click(); // neben das Feld geklickt: Fokus auf der Seite
  alt.release(zweiteSeite(170)); // erst jetzt kommt die Antwort auf das erste „Mehr laden“
  await api.sync();

  await expect(page.locator("body")).toBeFocused();
  await expect(zaehler(page)).toHaveText("100 von 170");
});

test("auch ein „Mehr laden“ ohne Fokus ist das zuletzt Bediente — die Antwort auf die laufende Umschaltung holt den Fokus danach nicht in die Zeile", async ({ page, api }) => {
  const put = hold();
  const zweite = hold();
  api.stub({
    [USERS]: (call) => (call.query.offset === "49" ? zweite.answer() : blaettern(120)(call)),
    "PUT /api/v1/admin/users/1001/subscriptions/sap": put.answer,
  });
  await oeffne(page);
  await waehle(page, "SAP Produktion", adressen(seite(1)));

  await haken(page, "nutzer001@example.org").focus();
  await page.keyboard.press("Space"); // die Umschaltung läuft …
  await expect(haken(page, "nutzer001@example.org")).toBeDisabled();
  await mehr(page).dispatchEvent("click"); // … da ein Klick wie in Safari: lädt nach, fokussiert den Knopf nicht
  await expect(mehr(page)).toBeDisabled();
  put.release({ status: 204 });
  await expectToast(page, "Abonniert: SAP Produktion für nutzer001@example.org");
  await api.sync();
  await expect(page.locator("body")).toBeFocused(); // zuletzt bedient wurde der Knopf
  zweite.release(zweiteSeite(120));
  await expect(zaehler(page)).toHaveText("100 von 120");

  await expect(page.locator("body")).toBeFocused();
});

test("XSS: eine E-Mail-Adresse mit HTML bleibt Text — in der Zeile, am Haken und im Toast", async ({ page, api }) => {
  api.stub({ [USERS]: { json: liste([{ ...MAX, email: XSS }]) }, [ABONNIEREN]: { status: 204 } });
  await oeffne(page);
  await waehle(page, "SAP Produktion", [XSS]);

  await haken(page, XSS).click(); // der zugängliche Name ist „Abonniert: “ plus die Adresse, wörtlich

  await expectToast(page, "Abonniert: SAP Produktion für " + XSS);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: ein Verteilername mit HTML bleibt Text — in der Auswahl und im Toast", async ({ page, api }) => {
  api.stub(TOPICS, { json: [topic({ name: XSS }), topic({ id: "notfall", name: XSS, is_mandatory: true })] });
  api.stub(ABONNIEREN, { status: 204 });
  await oeffne(page, [XSS, XSS + " (Pflicht)"]);
  await auswahl(page).selectOption("sap");

  await haken(page, MAX.email).click();

  await expectToast(page, "Abonniert: " + XSS + " für max@example.org");
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: auch die Gesamtzahl aus der API steht nur als Text im Zähler", async ({ page, api }) => {
  api.stub(USERS, { json: liste([MAX], XSS) });
  await oeffne(page);
  await waehle(page, "SAP Produktion", [MAX.email]);

  await expect(zaehler(page)).toHaveText("1 von " + XSS);
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("XSS: ein Fehlertext der API mit HTML bleibt Text — in der Tabelle und im Toast", async ({ page, api }) => {
  api.stub(USERS, fehler(500, "INTERNAL", XSS));
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });

  await expect(page.locator("#users-body")).toHaveText("Laden fehlgeschlagen: " + XSS);
  await expectToast(page, XSS, { error: true });
  await expect(page.locator("img, [onerror]")).toHaveCount(0);
});

test("ohne Sitzung: Weiterleitung zum Login mit next=/empfaenger.html, sonst keine Anfrage", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/empfaenger.html");

  await expect(page).toHaveURL("/auth/login?next=%2Fempfaenger.html");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]);
  expect(api.calls(LOGIN)[0].query).toEqual({ next: "/empfaenger.html" });
});

test("Sitzung läuft beim Umschalten ab: Weiterleitung zum Login, von dort zurück auf diese Seite", async ({ page, api }) => {
  api.stub({ [ABONNIEREN]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await waehle(page, "SAP Produktion");

  await haken(page, MAX.email).click();

  await expect(page).toHaveURL("/auth/login?next=%2Fempfaenger.html");
  await api.sync();
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/empfaenger.html" }]);
});

test("Sitzung läuft beim Laden der Liste ab: Weiterleitung zum Login, von dort zurück auf diese Seite", async ({ page, api }) => {
  api.stub({ [USERS]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await oeffne(page);

  await auswahl(page).selectOption({ label: "SAP Produktion" });

  await expect(page).toHaveURL("/auth/login?next=%2Fempfaenger.html");
  await api.sync();
  expect(api.calls(LOGIN).map((call) => call.query)).toEqual([{ next: "/empfaenger.html" }]);
});
