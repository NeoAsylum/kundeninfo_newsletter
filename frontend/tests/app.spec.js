/* app.js: die gemeinsame Schicht aller Seiten — fetch-Wrapper (CSRF-Header, Netzfehler, 401,
   Schleifenschutz), Abmelden, Kopfzeile, mobiles Menü, Toast, escapeHtml, formatDateTime.
   Wirt ist abos.html; versand.html dort, wo es ein Eingabefeld oder den nachträglich
   erzeugten Abmelden-Link braucht, meldungen.html einmal als zweite Adresse.
   Was keine Seite erreicht, ruft der Test direkt (App.…). */

"use strict";

const { test, expect, hold, expectToast } = require("./harness");
const {
  me, admin, topic, adminTopic, fehler, NICHT_ANGEMELDET, KEIN_ADMIN, LOGIN_STUB, GATEWAY, ANMELDESEITE, KEINE_API_ANTWORT,
  KEINE_VERBINDUNG, XSS,
} = require("./daten");

const ME = "GET /api/v1/me";
const TOPICS = "GET /api/v1/topics";
const ABONNIEREN = "PUT /api/v1/me/subscriptions/sap";
const ABBESTELLEN = "DELETE /api/v1/me/subscriptions/sap";
const ABONNIEREN_KAP = "PUT /api/v1/me/subscriptions/kap";
const HISTORIE = "GET /api/v1/admin/dispatches";
const VORSCHAU = "POST /api/v1/admin/dispatches/preview";
const ADMIN_VERTEILER = "GET /api/v1/admin/topics";
const ADMIN_NUTZER = "GET /api/v1/admin/users";
const VERTEILER_AENDERN = "PATCH /api/v1/admin/topics/sap";
const LOGIN = "GET /auth/login";
const LOGOUT = "POST /auth/logout";
const IDP = "GET https://idp.example/realms/portal/protocol/openid-connect/logout";
const ABGEMELDET = "GET /auth/abgemeldet"; // Abmeldeziel der eigenen Herkunft: dort geht api.sync() noch

const ABGEMELDET_SEITE = { html: "<!DOCTYPE html><title>Abgemeldet (Stub)</title>" };
const NACH_LOGIN = "/auth/login?next=%2Fabos.html";
const ABMELDE_URL = "https://idp.example/realms/portal/protocol/openid-connect/logout?client_id=portal";
const COOKIE_HINWEIS = "Anmeldung fehlgeschlagen — bitte Cookies zulassen und die Seite neu laden.";
const WEITERLEITUNG = "Nicht angemeldet — Weiterleitung zum Login";
const ABMELDEN_GESCHEITERT = "Abmelden fehlgeschlagen — bitte erneut versuchen.";
const MITARBEITER = me();
const ADMIN = admin();
const ALLE_LINKS = ["Meine Abos", "Meldungen", "Versand", "Empfänger", "Verteiler", "Rollen"];
const LINKS_OHNE_ADMIN = ["Meine Abos", "Meldungen"];
const SCHMAL = { width: 600, height: 800 }; // bis 860 px Breite liegt die Navigation hinter dem Menüknopf
const ROT = "rgb(192, 57, 43)"; // Grund einer Fehlermeldung (--danger in app.css)
const DUNKEL = "rgb(26, 35, 51)"; // Grund jeder anderen Meldung

test.beforeEach(async ({ api }) => {
  api.stub({
    [ME]: { json: MITARBEITER },
    [TOPICS]: { json: [topic()] },
    [ABONNIEREN]: { status: 204 },
    [ABBESTELLEN]: { status: 204 },
  });
});

const schalter = (page) => page.getByRole("checkbox", { name: "Abonnement SAP Produktion" });
const navLinks = (page) => page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link");

/** Der mittlere der drei Balken des Menüknopfs: Er verschwindet, wenn aus dem Symbol ein Kreuz wird.
 *  Die Balken haben weder Rolle noch id — deshalb dieser eine Griff in die Struktur. */
const mittlererBalken = (page) => page.locator("#nav-toggle .nav-toggle-bar").nth(1);

/** Seite öffnen und abwarten, was init() als Letztes zeichnet: den Schalter des Verteilers. */
async function oeffne(page) {
  await page.goto("/abos.html");
  await expect(schalter(page)).toBeVisible();
}

/** Zweiter Wirt: die Versand-Maske zeichnet zuletzt ihre Historie. */
async function oeffneVersand(page, historie) {
  await page.goto("/versand.html");
  await expect(page.locator("#history-body")).toHaveText(historie);
}

/** Erster Aufruf ohne Sitzung: endet auf dem Login, der Zeitpunkt des Versuchs ist gemerkt. */
async function scheitereAmLogin(page, api) {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/abos.html");
  await expect(page).toHaveURL(NACH_LOGIN);
}

/** Wie der Server: Mit der Antwort auf das Abmelden ist die Sitzung beendet, /me liefert 401. */
const beendetSitzung = (api, antwort) => () => {
  api.stub(ME, NICHT_ANGEMELDET);
  return antwort;
};

/** Jeder Pfad, den das Hauptfenster lädt. Die Startseite „/“ leitet sofort nach /abos.html
 *  weiter — toHaveURL("/") wäre ein Wettlauf, dieses Protokoll ist es nicht. */
function wege(page) {
  const pfade = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) pfade.push(new URL(frame.url()).pathname);
  });
  return pfade;
}

/** App.requestJson direkt rufen; ein Fehler kommt so zurück, wie ihn eine Seite im catch sähe. */
const rufe = (page, pfad, optionen = {}) => page.evaluate(
  ([p, o]) => App.requestJson(p, o).then(
    (daten) => ({ daten }),
    (error) => ({ message: error.message, code: error.code, status: error.status })),
  [pfad, optionen]);

/** Gegenstück zu expectToast: Der Hinweis ist ausgeblendet. */
async function expectKeinToast(page) {
  await expect(page.locator("#toast")).not.toContainClass("show");
  await expect(page.locator("#toast")).toHaveCSS("opacity", "0");
}

/** Gesperrte Cookies, nachgestellt: Edge verweigert dann schon den Zugriff auf sessionStorage
 *  (so beobachtet). Als Init-Skript steht die Sperre in jedem Dokument, bevor app.js läuft. */
const sperreSpeicher = (page) => page.addInitScript(() => Object.defineProperty(window, "sessionStorage", {
  get() {
    throw new DOMException(
      "Failed to read the 'sessionStorage' property from 'Window': Access is denied for this document.", "SecurityError");
  },
}));

// ---------- fetch-Wrapper ----------

test("jede Anfrage trägt den CSRF-Header X-Requested-With: fetch", async ({ page, api }) => {
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Abonniert: SAP Produktion");
  await schalter(page).click();
  await expectToast(page, "Abbestellt: SAP Produktion");

  await api.sync();
  expect(api.calls().map((call) => [call.key, call.headers["x-requested-with"]])).toEqual([
    [ME, "fetch"], [TOPICS, "fetch"], [ABONNIEREN, "fetch"], [ABBESTELLEN, "fetch"],
  ]);
});

test("ohne Body trägt keine Anfrage einen Content-Type — auch PUT und POST nicht", async ({ page, api }) => {
  api.stub(LOGOUT, hold().answer); // bleibt unbeantwortet: Die Seite meldet ab, navigiert aber noch nicht
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Abonniert: SAP Produktion");
  await page.getByRole("link", { name: "Abmelden" }).click();
  await expect.poll(() => api.calls(LOGOUT)).toHaveLength(1);

  for (const key of [ME, TOPICS, ABONNIEREN, LOGOUT]) {
    expect(api.calls(key)[0].headers, key).not.toHaveProperty("content-type");
  }
});

test("mit Body kommt Content-Type application/json dazu — bei POST wie bei PATCH", async ({ page, api }) => {
  api.stub({ [VORSCHAU]: { json: { subject: "s", html: "<p>h</p>" } }, [VERTEILER_AENDERN]: { json: adminTopic() } });
  await oeffne(page);

  await rufe(page, "/api/v1/admin/dispatches/preview", { method: "POST", body: JSON.stringify({ title: "Login gestört" }) });
  await rufe(page, "/api/v1/admin/topics/sap", { method: "PATCH", body: JSON.stringify({ is_active: false }) });

  for (const [key, body] of [[VORSCHAU, { title: "Login gestört" }], [VERTEILER_AENDERN, { is_active: false }]]) {
    const [call] = api.calls(key);
    expect(call.headers["content-type"], key).toBe("application/json");
    expect(call.json, key).toEqual(body);
  }
});

test("Header des Aufrufers bleiben erhalten — neben CSRF-Header und Content-Type", async ({ page, api }) => {
  api.stub(VORSCHAU, { json: { subject: "s", html: "<p>h</p>" } });
  await oeffne(page);

  await rufe(page, "/api/v1/admin/dispatches/preview", {
    method: "POST", body: JSON.stringify({ title: "Login gestört" }), headers: { "X-Request-Id": "abc-123" },
  });

  expect(api.calls(VORSCHAU)[0].headers).toMatchObject({
    "x-request-id": "abc-123", "x-requested-with": "fetch", "content-type": "application/json",
  });
});

test("204 ohne Inhalt ist ein Erfolg: requestJson liefert null", async ({ page }) => {
  await oeffne(page);
  expect(await rufe(page, "/api/v1/me/subscriptions/sap", { method: "PUT" })).toEqual({ daten: null });
});

test("API-Fehler: die Seite zeigt den Text der API", async ({ page, api }) => {
  api.stub(TOPICS, fehler(500, "INTERNAL", "Die Datenbank ist nicht erreichbar."));
  await page.goto("/abos.html");

  await expect(page.locator("#topic-list").getByText("Die Datenbank ist nicht erreichbar.", { exact: true })).toBeVisible();
  await expectToast(page, "Die Datenbank ist nicht erreichbar.", { error: true });
});

test("Fehlerseite ohne JSON (der Proxy antwortet mit HTML): „Fehler (HTTP 502)“ statt eines Parserfehlers", async ({ page, api }) => {
  api.stub(TOPICS, GATEWAY);
  await page.goto("/abos.html");

  await expect(page.locator("#topic-list").getByText("Fehler (HTTP 502)", { exact: true })).toBeVisible();
  await expectToast(page, "Fehler (HTTP 502)", { error: true });
});

test("das Fehlerobjekt trägt code und status der API — daran erkennen die Seiten NOT_ADMIN", async ({ page, api }) => {
  api.stub({ [ADMIN_VERTEILER]: KEIN_ADMIN, [ADMIN_NUTZER]: { status: 500, json: { fehler: "ohne detail" } } });
  await oeffne(page);

  expect(await rufe(page, "/api/v1/admin/topics")).toEqual({
    message: "Keine Berechtigung für diese Funktion", code: "NOT_ADMIN", status: 403,
  });
  expect(await rufe(page, "/api/v1/admin/users")).toEqual({ message: "Fehler (HTTP 500)", status: 500 });
});

test("fällt das Netz aus, liest der Nutzer „Keine Verbindung zum Server …“ in Seite und Toast — nichts von der englischen Meldung des Browsers", async ({ page, api }) => {
  api.stub(TOPICS, { abort: true });
  await page.goto("/abos.html");

  await expect(page.locator("#topic-list").getByText(KEINE_VERBINDUNG, { exact: true })).toBeVisible();
  await expectToast(page, KEINE_VERBINDUNG, { error: true });
  await expect(page.locator("body")).not.toContainText("Failed to fetch"); // so heißt der Fehler in Edge und Chrome
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, TOPICS]); // ein Versuch, kein stilles Wiederholen
});

test("ein Netzfehler kommt beim Aufrufer als deutsche Meldung an, ohne status und code — auch bei einer Hintergrund-Anfrage", async ({ page, api }) => {
  await oeffne(page);
  api.stub(ME, { abort: true });

  expect(await rufe(page, "/api/v1/me")).toEqual({ message: KEINE_VERBINDUNG });
  expect(await rufe(page, "/api/v1/me", { background: true })).toEqual({ message: KEINE_VERBINDUNG });
});

// ---------- 401 und Schleifenschutz ----------

test("ohne Sitzung: Weiterleitung zum Login mit next=<Pfad, URL-kodiert>, danach keine weitere Anfrage", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/abos.html");

  await expect(page).toHaveURL(NACH_LOGIN);
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGIN]); // /topics wurde nie angefragt
  expect(api.calls(LOGIN)[0].query).toEqual({ next: "/abos.html" });
});

test("ohne Sitzung: next nennt die Seite, auf der man war — nicht immer die Abo-Seite", async ({ page, api }) => {
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB });
  await page.goto("/meldungen.html");

  await expect(page).toHaveURL("/auth/login?next=%2Fmeldungen.html");
});

test("ohne Sitzung: bis der Login da ist, zeigt die Seite ihren Fehlerzustand statt ewig „Lade …“", async ({ page, api }) => {
  // 204 lässt den Browser auf der Seite stehen. Eine nur zurückgehaltene Antwort ginge nicht:
  // Solange eine Navigation läuft, wartet Playwright mit jeder Locator-Prüfung auf ihr Ende.
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } });
  await page.goto("/abos.html");

  await expect(page.getByRole("heading", { name: "Laden fehlgeschlagen" })).toBeVisible();
  await expect(page.locator("#topic-list").getByText(WEITERLEITUNG, { exact: true })).toBeVisible();
  await expect(page.getByText("Lade deine Abonnements …")).toBeHidden();
  await expectToast(page, WEITERLEITUNG, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("Schleifenschutz: ein zweites 401 nach 29 999 ms leitet nicht noch einmal zum Login", async ({ page, api }) => {
  await scheitereAmLogin(page, api);
  await page.clock.runFor(29999);
  api.stub(LOGIN, { status: 204 }); // käme es doch zu einem zweiten Versuch, bliebe die Seite stehen — und er wäre gezählt

  await page.goto("/abos.html"); // zurück vom Login — das Sitzungs-Cookie fehlt weiterhin
  await expect(page.getByRole("heading", { name: "Laden fehlgeschlagen" })).toBeVisible();
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("Schleifenschutz: nach 30 000 ms wird wieder zum Login geleitet", async ({ page, api }) => {
  await scheitereAmLogin(page, api);
  await page.clock.runFor(30000);

  await page.goto("/abos.html");
  await expect(page).toHaveURL(NACH_LOGIN);
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(2);
});

test("Schleifenschutz: die 30 s zählen ab dem Login-Versuch — ein 401 dazwischen verlängert sie nicht", async ({ page, api }) => {
  await scheitereAmLogin(page, api);
  await page.clock.runFor(20000);
  await page.goto("/abos.html"); // nach 20 s zurück, das Sitzungs-Cookie fehlt weiterhin: Cookie-Hinweis
  await expect(page.locator("#topic-list").getByText(COOKIE_HINWEIS, { exact: true })).toBeVisible();
  await page.clock.runFor(10000); // 30 s nach dem Versuch — aber erst 10 s nach dem letzten 401

  await page.goto("/abos.html"); // „Seite neu laden“, wie es der Hinweis verlangt
  await expect(page).toHaveURL(NACH_LOGIN);
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(2);
});

test("Schleifenschutz: der Nutzer liest den Cookie-Hinweis — die Seite überschreibt ihn nicht", async ({ page, api }) => {
  await scheitereAmLogin(page, api);
  await page.goto("/abos.html");

  // abos.js zeichnet die Fehlerkarte unmittelbar vor seinem eigenen Toast: Steht sie, ist er gesetzt.
  await expect(page.locator("#topic-list").getByText(COOKIE_HINWEIS, { exact: true })).toBeVisible();
  await expectToast(page, COOKIE_HINWEIS, { error: true });
});

test("Schleifenschutz: den Cookie-Hinweis zeigt app.js selbst, als Fehlermeldung — auch einem Aufrufer, der nichts meldet", async ({ page, api }) => {
  await scheitereAmLogin(page, api);
  await page.goto("/abos.html"); // zweites 401: Hier meldet (auch) die Seite den Hinweis …
  await expectToast(page, COOKIE_HINWEIS, { error: true });
  await page.clock.runFor(5000); // … deshalb abwarten, bis ihre Meldung ausgeblendet ist
  await expectKeinToast(page);

  expect(await rufe(page, "/api/v1/me")).toEqual({ message: COOKIE_HINWEIS }); // dieser Aufrufer zeigt nichts an

  await expectToast(page, COOKIE_HINWEIS, { error: true });
});

test("eine funktionierende Sitzung hebt den Schleifenschutz auf: das nächste 401 leitet sofort wieder um", async ({ page, api }) => {
  await scheitereAmLogin(page, api);
  api.stub(ME, { json: MITARBEITER }); // die Anmeldung hat geklappt
  await oeffne(page);

  api.stub(ME, NICHT_ANGEMELDET); // … und die Sitzung endet, noch keine 30 s nach dem ersten Versuch
  await page.goto("/abos.html");
  await expect(page).toHaveURL(NACH_LOGIN);
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(2);
});

test("enden zwei laufende Anfragen mit 401, wird einmal zum Login geleitet — die zweite meldet dieselbe Weiterleitung, nicht „Cookies zulassen“", async ({ page, api }) => {
  // Zwei Schalter kurz nacheinander umgelegt — beide Anfragen sind unterwegs, als die Sitzung endet.
  const erste = hold();
  const zweite = hold();
  api.stub({
    [TOPICS]: { json: [topic(), topic({ id: "kap", name: "KAP" })] },
    [ABONNIEREN]: erste.answer,
    [ABONNIEREN_KAP]: zweite.answer,
    [LOGIN]: { status: 204 }, // der Login lädt noch: der Browser steht weiter auf der Seite
  });
  await oeffne(page);
  const kap = page.getByRole("checkbox", { name: "Abonnement KAP" });
  await schalter(page).click();
  await kap.click();

  // Die Antworten kommen nacheinander an: Träfen beide im selben Augenblick ein, zählte das Harness auch
  // für zwei Navigationen nur EINE Anfrage (so beobachtet) — die letzte Zeile könnte dann nie scheitern.
  erste.release(NICHT_ANGEMELDET);
  await expect(schalter(page)).toBeEnabled();
  await expect.poll(() => api.calls(LOGIN)).toHaveLength(1); // die erste hat zum Login geleitet
  zweite.release(NICHT_ANGEMELDET);

  await expect(kap).toBeEnabled(); // auch die zweite Antwort ist verarbeitet …
  await expectToast(page, WEITERLEITUNG, { error: true }); // … und das steht am Ende da
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1); // … eine zweite Navigation hat sie nicht angestoßen
});

test("läuft die Weiterleitung zum Login schon, meldet auch die nächste Anfrage nur diese Weiterleitung — kein Cookie-Hinweis, keine zweite Navigation", async ({ page, api }) => {
  await oeffne(page);
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } }); // die Sitzung endet; der Login lädt noch

  expect(await rufe(page, "/api/v1/me")).toEqual({ message: WEITERLEITUNG }); // das erste 401 leitet weiter …
  expect(await rufe(page, "/api/v1/me")).toEqual({ message: WEITERLEITUNG }); // … das zweite trifft die laufende Weiterleitung

  await expect(page.locator("#toast")).toHaveCount(0); // dieser Aufrufer zeigt nichts an — und app.js meldet nichts von Cookies
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("bleibt die Seite nach der Weiterleitung zum Login stehen, meldet ein 401 bis 29 999 ms danach weiter nur die Weiterleitung — keine zweite Navigation, kein Cookie-Hinweis", async ({ page, api }) => {
  // So steht die Seite da, wenn das Laden des Logins abgebrochen wird (Stopp, Esc): Sie bleibt, ohne jedes
  // Ereignis (so beobachtet) — von einer Weiterleitung, die noch läuft, nicht zu unterscheiden. Nachgestellt mit 204.
  await oeffne(page);
  api.stub({ [ABONNIEREN]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } }); // die Sitzung endet
  await schalter(page).click();
  await expectToast(page, WEITERLEITUNG, { error: true });
  await page.clock.runFor(29999);
  await expectKeinToast(page);

  await schalter(page).click();

  await expectToast(page, WEITERLEITUNG, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("bleibt die Seite nach der Weiterleitung zum Login stehen, leitet ein 401 nach 30 000 ms wieder dorthin", async ({ page, api }) => {
  await oeffne(page);
  api.stub({ [ABONNIEREN]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } }); // die Sitzung endet; der Login kommt nicht (204)
  await schalter(page).click();
  await expectToast(page, WEITERLEITUNG, { error: true });
  await page.clock.runFor(30000);
  await expectKeinToast(page);

  await schalter(page).click();

  await expectToast(page, WEITERLEITUNG, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(2);
});

test("nach „Zurück“ vom Login greift der Schleifenschutz: bis 29 999 ms nach dem Versuch liest der Nutzer den Cookie-Hinweis — keine angekündigte Weiterleitung, die ausbleibt", async ({ page, api }) => {
  // Edge holt die Seite nach der Zurück-Taste samt Zustand aus dem Back/Forward-Cache (so beobachtet).
  // Playwright schaltet diesen Cache ab — deshalb nachgestellt: Die Seite bleibt stehen (204) und
  // bekommt das Ereignis, mit dem der Browser die Rückkehr meldet. Die Sitzung lässt sich dabei nicht
  // prüfen (Netz weg) — sonst führte schon die Rückkehr wieder zum Login (eigene Tests unten).
  await oeffne(page);
  api.stub({ [ABONNIEREN]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 }, [ME]: { abort: true } }); // die Sitzung endet
  await schalter(page).click();
  await expectToast(page, WEITERLEITUNG, { error: true });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.clock.runFor(29999);
  await expectKeinToast(page);

  await schalter(page).click();

  await expectToast(page, COOKIE_HINWEIS, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("nach „Zurück“ vom Login leitet ein 401 nach 30 000 ms wieder dorthin", async ({ page, api }) => {
  // Nachgestellt wie im Test davor: 204, das Ereignis pageshow, Sitzung nicht prüfbar.
  await oeffne(page);
  api.stub({ [ABONNIEREN]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 }, [ME]: { abort: true } }); // die Sitzung endet
  await schalter(page).click();
  await expectToast(page, WEITERLEITUNG, { error: true });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.clock.runFor(30000);
  await expectKeinToast(page);

  await schalter(page).click();

  await expectToast(page, WEITERLEITUNG, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(2);
});

test("„Zurück“ nach dem Abmelden: Die aus dem Cache zurückgeholte Seite geht zum Login — an ihrer eigenen Stelle im Verlauf", async ({ page, api }) => {
  // Der Browser zeigt die Seite dann mit den Daten der beendeten Sitzung, ohne eine Anfrage zu stellen.
  // Nachgestellt über das Ereignis pageshow (siehe Kopf von harness.js).
  await oeffne(page);
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: LOGIN_STUB }); // inzwischen abgemeldet

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

  await expect(page).toHaveURL(NACH_LOGIN);
  await page.goBack(); // der Eintrag der Seite ist ersetzt: „Zurück“ landet nicht wieder auf dem alten Stand
  expect(page.url()).toBe("about:blank");
});

test("aus dem Cache zurückgeholt mit gültiger Sitzung: eine Abfrage der Sitzung, die Seite bleibt mit ihrem Stand stehen", async ({ page, api }) => {
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Abonniert: SAP Produktion");

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

  await api.sync();
  expect(api.calls(ME)).toHaveLength(2);
  await expect(page).toHaveURL("/abos.html");
  await expect(schalter(page)).toBeChecked(); // nichts wurde neu geladen
  expect(api.calls(TOPICS)).toHaveLength(1);
});

test("aus dem Cache zurückgeholt, die Sitzung lässt sich nicht prüfen (Netz weg): Die Seite bleibt stehen, ohne Meldung", async ({ page, api }) => {
  await oeffne(page);
  api.stub(ME, { abort: true });

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

  await api.sync();
  expect(api.calls(ME)).toHaveLength(2);
  await expect(page).toHaveURL("/abos.html");
  await expect(page.locator("#toast")).toHaveCount(0);
});

for (const [fall, antwort] of [["502 vom Proxy", GATEWAY], ["403", KEIN_ADMIN]]) {
  test(`aus dem Cache zurückgeholt, die Sitzungsprüfung scheitert anders als mit 401 (${fall}): Die Seite bleibt stehen — die Sitzung kann noch gelten`, async ({ page, api }) => {
    // Sonst kostete ein Neustart des Backends die getippte Meldung der Versand-Maske.
    await oeffne(page);
    api.stub(ME, antwort);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));

    await api.sync();
    expect(api.calls(ME)).toHaveLength(2);
    await expect(page).toHaveURL("/abos.html");
    await expect(page.locator("#toast")).toHaveCount(0);
  });
}

test("ein gewöhnlicher Seitenaufruf (pageshow nicht aus dem Cache) prüft die Sitzung kein zweites Mal", async ({ page, api }) => {
  await oeffne(page);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));

  await api.sync();
  expect(api.calls(ME)).toHaveLength(1);
});

test("das pageshow eines gewöhnlichen Seitenaufrufs (nicht aus dem Cache) hebt eine laufende Weiterleitung nicht auf", async ({ page, api }) => {
  await oeffne(page);
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } }); // die Sitzung endet; der Login lädt noch

  expect(await rufe(page, "/api/v1/me")).toEqual({ message: WEITERLEITUNG });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  expect(await rufe(page, "/api/v1/me")).toEqual({ message: WEITERLEITUNG });

  await expect(page.locator("#toast")).toHaveCount(0); // kein Cookie-Hinweis
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("sind im Browser Cookies gesperrt, liest der Nutzer den Cookie-Hinweis — kein SecurityError, kein Sprung zum Login", async ({ page, api }) => {
  await sperreSpeicher(page);
  api.stub(ME, NICHT_ANGEMELDET);
  await page.goto("/abos.html");

  await expect(page.locator("#topic-list").getByText(COOKIE_HINWEIS, { exact: true })).toBeVisible();
  await expectToast(page, COOKIE_HINWEIS, { error: true });
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]); // ohne Merker liefe der Login im Kreis: Er wird gar nicht erst versucht
  await expect(page).toHaveURL("/abos.html");
});

test("gesperrter Speicher stört eine gültige Sitzung nicht: die Seite lädt vollständig", async ({ page }) => {
  await sperreSpeicher(page);
  await oeffne(page);

  await expect(page.locator("#user-chip")).toHaveText(MITARBEITER.email);
  // Gegenprobe: Griffe die Sperre nicht, bewiese dieser Test nichts.
  expect(await page.evaluate(() => { try { return typeof sessionStorage.length; } catch (error) { return error.name; } }))
    .toBe("SecurityError");
});

test("gesperrter Speicher: den Cookie-Hinweis zeigt app.js selbst, als Fehlermeldung — auch einem Aufrufer, der nichts meldet", async ({ page, api }) => {
  await sperreSpeicher(page);
  await oeffne(page);
  api.stub(ME, NICHT_ANGEMELDET); // die Sitzung endet

  expect(await rufe(page, "/api/v1/me")).toEqual({ message: COOKIE_HINWEIS }); // dieser Aufrufer zeigt nichts an

  await expectToast(page, COOKIE_HINWEIS, { error: true });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
});

test("lässt sich der Merker nicht speichern, wird nicht zum Login geleitet — der Nutzer liest den Cookie-Hinweis, nicht die Meldung des Browsers", async ({ page, api }) => {
  // Die andere Art, Speicher zu verweigern, die der HTML-Standard zulässt: Lesen geht, setItem wirft
  // (Speicher abgeschaltet oder voll). In Edge nicht beobachtet — dort wirft schon der Zugriff (sperreSpeicher).
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Failed to execute 'setItem' on 'Storage': Setting the value of 'login_redirect_at' exceeded the quota.", "QuotaExceededError");
    };
  });
  api.stub(ME, NICHT_ANGEMELDET);
  await page.goto("/abos.html");

  await expect(page.locator("#topic-list").getByText(COOKIE_HINWEIS, { exact: true })).toBeVisible();
  await expectToast(page, COOKIE_HINWEIS, { error: true });
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME]); // ohne Merker liefe der Login im Kreis: Er wird nicht versucht
  await expect(page).toHaveURL("/abos.html");
});

test("ein 401 ohne `background` geht über App.loginRequired — denselben Weg nimmt die Verteiler-Verwaltung, wenn erst die Antwort entscheidet", async ({ page, api }) => {
  // Die beiden Wege sollen nicht auseinanderlaufen. Dass request() die Funktion ruft, zeigt sich nur, wenn der Test
  // sie ersetzt: Baute request() den Weg nach, käme ihr Text nicht zurück — und der Sprung zum Login wäre gezählt.
  await oeffne(page);
  api.stub({ [ME]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } });
  await page.evaluate(() => { App.loginRequired = () => "Text aus loginRequired"; });

  expect(await rufe(page, "/api/v1/me")).toEqual({ message: "Text aus loginRequired" });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
});

test("Hintergrund-Anfrage mit 401: Fehler „Sitzung abgelaufen“ mit status 401 statt Sprung zum Login — Getipptes bleibt", async ({ page, api }) => {
  api.stub({ [ME]: { json: ADMIN }, [HISTORIE]: { json: [] } });
  await oeffneVersand(page, "Noch keine Versände.");
  await page.locator("#body").fill("Lange getippte Störungsmeldung");
  // Die Sitzung läuft ab. Spränge die Seite doch zum Login, bliebe sie bei 204 stehen — und der Sprung wäre gezählt.
  api.stub({ [HISTORIE]: NICHT_ANGEMELDET, [LOGIN]: { status: 204 } });

  expect(await rufe(page, "/api/v1/admin/dispatches?limit=20", { background: true })).toEqual({
    message: "Sitzung abgelaufen — bitte Seite neu laden und anmelden.", status: 401,
  });
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(0);
  await expect(page).toHaveURL("/versand.html");
  await expect(page.locator("#body")).toHaveValue("Lange getippte Störungsmeldung");
});

// ---------- Abmelden ----------

test("Abmelden sendet genau einen POST /auth/logout mit CSRF-Header", async ({ page, api }) => {
  api.stub({ [LOGOUT]: { json: { logout_url: "/auth/abgemeldet" } }, [ABGEMELDET]: ABGEMELDET_SEITE });
  await oeffne(page);

  await page.getByRole("link", { name: "Abmelden" }).click();

  // Erst abwarten, DASS der POST da ist — bliebe er aus, soll das diese Zeile sagen und nicht erst die Adresse.
  await expect.poll(() => api.calls(LOGOUT).map((call) => call.headers["x-requested-with"])).toEqual(["fetch"]);
  await expect(page).toHaveURL("/auth/abgemeldet"); // abgemeldet: Die alte Seite sendet nichts mehr
  await api.sync();
  expect(api.calls(LOGOUT)).toHaveLength(1);
});

test("Abmelden wartet die Antwort des Servers ab und folgt dann der logout_url — nicht dem href des Links", async ({ page, api }) => {
  const post = hold();
  api.stub({ [LOGOUT]: post.answer, [IDP]: ABGEMELDET_SEITE });
  await oeffne(page);

  await page.getByRole("link", { name: "Abmelden" }).click();
  await expect.poll(() => api.calls(LOGOUT)).toHaveLength(1);
  await expect(page).toHaveURL("/abos.html"); // weder dem href="#" des Links gefolgt noch vorab navigiert

  post.release({ json: { logout_url: ABMELDE_URL } });
  await expect(page).toHaveURL(ABMELDE_URL);
  expect(api.calls(IDP)[0].query).toEqual({ client_id: "portal" });
});

test("Abmelden ohne logout_url in der Antwort führt zur Startseite", async ({ page, api }) => {
  api.stub({ [LOGOUT]: beendetSitzung(api, { json: {} }), [LOGIN]: LOGIN_STUB });
  const pfade = wege(page);
  await oeffne(page);

  await page.getByRole("link", { name: "Abmelden" }).click();

  // Startseite → abos.html → dort ist die Sitzung weg → Login
  await expect(page).toHaveURL(NACH_LOGIN);
  await expect.poll(() => pfade).toEqual(["/abos.html", "/", "/abos.html", "/auth/login"]);
});

test("Abmelden mit abgelaufener Sitzung (401) führt zur Startseite — der Schleifenschutz springt danach nicht an", async ({ page, api }) => {
  api.stub({ [LOGOUT]: beendetSitzung(api, NICHT_ANGEMELDET), [LOGIN]: LOGIN_STUB });
  const pfade = wege(page);
  await oeffne(page);

  await page.getByRole("link", { name: "Abmelden" }).click();

  // Hätte schon das Abmelden zum Login umgeleitet, bliebe abos.html jetzt mit dem Cookie-Hinweis stehen.
  await expect(page).toHaveURL(NACH_LOGIN);
  await expect.poll(() => pfade).toEqual(["/abos.html", "/", "/abos.html", "/auth/login"]);
  await api.sync();
  expect(api.calls(LOGIN)).toHaveLength(1);
});

test("Abmelden mit abgelaufener Sitzung (401): die Seite meldet dabei keinen Fehler — abgemeldet ist man ohnehin", async ({ page, api }) => {
  // Eine Meldung unmittelbar vor dem Verlassen der Seite sähe kein Locator mehr. Deshalb schreibt die Seite
  // selbst mit, was sie anzeigt — bis sie ersetzt wird; die folgenden Seiten schreiben nicht mit.
  const gemeldet = [];
  await page.exposeFunction("meldungGezeigt", (text) => { gemeldet.push(text); });
  api.stub({ [LOGOUT]: beendetSitzung(api, NICHT_ANGEMELDET), [LOGIN]: LOGIN_STUB });
  await oeffne(page);
  await page.evaluate(() => new MutationObserver(() => {
    const toast = document.getElementById("toast");
    if (toast) window.meldungGezeigt(toast.textContent);
  }).observe(document.body, { childList: true, subtree: true }));
  await schalter(page).click(); // Gegenprobe: Eine Meldung dieser Seite kommt beim Test an.
  await expect.poll(() => gemeldet).toEqual(["Abonniert: SAP Produktion"]);

  await page.getByRole("link", { name: "Abmelden" }).click();

  await expect(page).toHaveURL(NACH_LOGIN); // Startseite → abos.html → Login: Die erste Seite ist längst verlassen
  expect(gemeldet).toEqual(["Abonniert: SAP Produktion"]); // … und hat bis dahin nichts weiter gemeldet
});

test("scheitert das Abmelden am Server, bleibt die Seite stehen und sagt es — statt wortlos neu zu laden", async ({ page, api }) => {
  api.stub(LOGOUT, GATEWAY);
  const pfade = wege(page);
  await oeffne(page);

  await page.getByRole("link", { name: "Abmelden" }).click();

  await expectToast(page, ABMELDEN_GESCHEITERT, { error: true });
  await api.sync();
  expect(pfade).toEqual(["/abos.html"]); // nichts wurde geladen — auch nicht die Startseite, die auf dieselbe Adresse zurückführt
  expect(api.calls(LOGOUT)).toHaveLength(1);
});

test("scheitert das Abmelden am Netz, bleibt die Seite ebenso stehen und sagt es", async ({ page, api }) => {
  api.stub(LOGOUT, { abort: true });
  const pfade = wege(page);
  await oeffne(page);

  await page.getByRole("link", { name: "Abmelden" }).click();

  await expectToast(page, ABMELDEN_GESCHEITERT, { error: true });
  await api.sync();
  expect(pfade).toEqual(["/abos.html"]);
  expect(api.calls(LOGOUT)).toHaveLength(1);
});

test("nach einem gescheiterten Abmelden gelingt der nächste Versuch", async ({ page, api }) => {
  api.stub(LOGOUT, GATEWAY);
  await oeffne(page);
  await page.getByRole("link", { name: "Abmelden" }).click();
  await expectToast(page, ABMELDEN_GESCHEITERT, { error: true });

  api.stub({ [LOGOUT]: { json: { logout_url: "/auth/abgemeldet" } }, [ABGEMELDET]: ABGEMELDET_SEITE });
  await page.getByRole("link", { name: "Abmelden" }).click();

  await expect(page).toHaveURL("/auth/abgemeldet");
  await api.sync();
  expect(api.calls(LOGOUT)).toHaveLength(2);
});

test("auch der nachträglich erzeugte Abmelden-Link der Versand-Maske meldet ab", async ({ page, api }) => {
  api.stub({ [LOGOUT]: { json: { logout_url: "/auth/abgemeldet" } }, [ABGEMELDET]: ABGEMELDET_SEITE });
  await oeffneVersand(page, "Keine Berechtigung.");

  await page.getByRole("main").getByRole("link", { name: "Abmelden" }).click();

  await expect(page).toHaveURL("/auth/abgemeldet");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGOUT, ABGEMELDET]); // genau ein POST — und sonst nichts
});

// ---------- Kopfzeile ----------

test("die Kopfzeile zeigt die E-Mail als Text — HTML darin wird nicht zum Element", async ({ page, api }) => {
  api.stub(ME, { json: me({ email: XSS }) });
  await oeffne(page);

  await expect(page.locator("#user-chip")).toHaveText(XSS);
  await expect(page.getByRole("banner").locator("img, [onerror]")).toHaveCount(0);
});

test("initTopbar gibt die Antwort von /me zurück — daran prüfen die Seiten ihr Adminrecht", async ({ page }) => {
  await oeffne(page);
  expect(await page.evaluate(() => App.initTopbar("abos"))).toEqual(MITARBEITER);
});

test("die Navigation hebt die aktuelle Seite hervor — und nur sie", async ({ page, api }) => {
  api.stub({ [ME]: { json: ADMIN }, [HISTORIE]: { json: [] } });
  // Hervorgehoben heißt: fett (.topbar-nav a.active); alle anderen Links stehen normal.
  const nurFett = async (aktiv) => {
    for (const name of ALLE_LINKS) {
      await expect(navLinks(page).filter({ hasText: name })).toHaveCSS("font-weight", name === aktiv ? "600" : "400");
    }
  };

  await oeffne(page);
  await nurFett("Meine Abos");
  await oeffneVersand(page, "Noch keine Versände.");
  await nurFett("Versand");
});

test("ohne Adminrecht zeigt die Navigation nur „Meine Abos“ und „Meldungen“", async ({ page }) => {
  await oeffne(page);
  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);
});

test("mit Adminrecht kommen Versand, Empfänger, Verteiler und Rollen dazu", async ({ page, api }) => {
  api.stub(ME, { json: ADMIN });
  await oeffne(page);
  await expect(navLinks(page)).toHaveText(ALLE_LINKS);
});

test("Adminrecht zählt auch als einziger Eintrag der Rollenliste", async ({ page, api }) => {
  api.stub(ME, { json: admin({ roles: ["admin"] }) });
  await oeffne(page);
  await expect(navLinks(page)).toHaveText(ALLE_LINKS);
});

test("Adminrecht zählt auch, wenn es vor anderen Rollen steht", async ({ page, api }) => {
  api.stub(ME, { json: admin({ roles: ["admin", "employee"] }) });
  await oeffne(page);
  await expect(navLinks(page)).toHaveText(ALLE_LINKS);
});

test("eine Rolle, die „admin“ nur im Namen trägt, ist kein Adminrecht", async ({ page, api }) => {
  api.stub(ME, { json: me({ roles: ["employee", "sysadmin", "admin-lesend"] }) });
  await oeffne(page);
  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);
});

// ---------- mobiles Menü ----------

test("Umbruch der Navigation: bis 860 px Breite liegt sie hinter dem Menüknopf, ab 861 px steht sie als Leiste da", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 800 });
  await oeffne(page);
  await expect(page.locator("#nav-toggle")).toBeVisible();
  await expect(page.locator("#topbar-menu")).toBeHidden();

  await page.setViewportSize({ width: 861, height: 800 });
  await expect(page.locator("#nav-toggle")).toBeHidden();
  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);
});

test("schmales Fenster: der Menüknopf klappt die Navigation auf und wieder zu, aria-expanded und Beschriftung folgen", async ({ page, api }) => {
  api.stub(ME, { json: ADMIN });
  await page.setViewportSize(SCHMAL);
  await oeffne(page);
  const knopf = page.locator("#nav-toggle");
  await expect(page.locator("#topbar-menu")).toBeHidden();
  await expect(knopf).toHaveAccessibleName("Menü öffnen");
  await expect(knopf).toHaveAttribute("aria-expanded", "false");

  await knopf.click();
  await expect(navLinks(page)).toHaveText(ALLE_LINKS);
  await expect(knopf).toHaveAccessibleName("Menü schließen");
  await expect(knopf).toHaveAttribute("aria-expanded", "true");

  await knopf.click();
  await expect(page.locator("#topbar-menu")).toBeHidden();
  await expect(knopf).toHaveAccessibleName("Menü öffnen");
  await expect(knopf).toHaveAttribute("aria-expanded", "false");
});

test("schmales Fenster: der Menüknopf zeigt ein Kreuz, solange das Menü offen ist", async ({ page }) => {
  await page.setViewportSize(SCHMAL);
  await oeffne(page);
  const knopf = page.locator("#nav-toggle");
  await expect(mittlererBalken(page)).toHaveCSS("opacity", "1");

  await knopf.click();
  await expect(mittlererBalken(page)).toHaveCSS("opacity", "0");

  await knopf.click();
  await expect(mittlererBalken(page)).toHaveCSS("opacity", "1");
});

test("schmales Fenster: ein Klick neben das Menü schließt es", async ({ page }) => {
  await page.setViewportSize(SCHMAL);
  await oeffne(page);
  const knopf = page.locator("#nav-toggle");
  await knopf.click();
  await expect(page.locator("#topbar-menu")).toBeVisible();

  await page.getByRole("heading", { name: "E-Mail-Verteiler & Benachrichtigungen" }).click();

  await expect(page.locator("#topbar-menu")).toBeHidden();
  await expect(knopf).toHaveAccessibleName("Menü öffnen");
  await expect(knopf).toHaveAttribute("aria-expanded", "false");
});

test("schmales Fenster: nach einem Klick neben das Menü zeigt der Knopf wieder das Menüsymbol statt des Kreuzes", async ({ page }) => {
  await page.setViewportSize(SCHMAL);
  await oeffne(page);
  await page.locator("#nav-toggle").click();
  await expect(mittlererBalken(page)).toHaveCSS("opacity", "0");

  await page.getByRole("heading", { name: "E-Mail-Verteiler & Benachrichtigungen" }).click();

  await expect(page.locator("#topbar-menu")).toBeHidden();
  await expect(mittlererBalken(page)).toHaveCSS("opacity", "1");
});

test("schmales Fenster: ein Klick ins Menü lässt es offen", async ({ page }) => {
  await page.setViewportSize(SCHMAL);
  await oeffne(page);
  const knopf = page.locator("#nav-toggle");
  await knopf.click();

  await page.locator("#user-chip").click();

  await expect(page.locator("#topbar-menu")).toBeVisible();
  await expect(knopf).toHaveAttribute("aria-expanded", "true");
});

test("schmales Fenster: ohne Adminrecht zeigt auch das aufgeklappte Menü keine Admin-Links", async ({ page }) => {
  await page.setViewportSize(SCHMAL);
  await oeffne(page);

  await page.locator("#nav-toggle").click();

  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);
  await expect(page.getByRole("link", { name: "Abmelden" })).toBeVisible();
});

test("schmales Fenster: der Menüknopf öffnet schon, während /me noch aussteht — Navigation und „Abmelden“ sind erreichbar", async ({ page, api }) => {
  api.stub(ME, hold().answer); // bleibt unbeantwortet
  await page.setViewportSize(SCHMAL);
  await page.goto("/abos.html");
  const knopf = page.locator("#nav-toggle");

  await knopf.click();

  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);
  await expect(page.getByRole("link", { name: "Abmelden" })).toBeVisible();
  await expect(knopf).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#user-chip")).toHaveText("…"); // Gegenprobe: /me hat wirklich noch nicht geantwortet
});

test("schmales Fenster: auch solange /me noch aussteht, meldet „Abmelden“ aus dem Menü ab", async ({ page, api }) => {
  api.stub({ [ME]: hold().answer, [LOGOUT]: { json: { logout_url: "/auth/abgemeldet" } }, [ABGEMELDET]: ABGEMELDET_SEITE });
  await page.setViewportSize(SCHMAL);
  await page.goto("/abos.html");
  await page.locator("#nav-toggle").click();
  const abmelden = page.getByRole("link", { name: "Abmelden" });
  await expect(abmelden).toBeVisible(); // erst prüfen: Ein Klick auf einen verborgenen Link wartete bis zum Zeitlimit

  await abmelden.click();

  await expect(page).toHaveURL("/auth/abgemeldet");
  await api.sync();
  expect(api.calls().map((call) => call.key)).toEqual([ME, LOGOUT, ABGEMELDET]); // genau ein POST — und /me blieb bis zuletzt offen
});

test("schmales Fenster: trifft /me bei offenem Menü ein, bleibt es offen — E-Mail und Admin-Links kommen dazu", async ({ page, api }) => {
  const antwort = hold();
  api.stub(ME, antwort.answer);
  await page.setViewportSize(SCHMAL);
  await page.goto("/abos.html");
  await page.locator("#nav-toggle").click();
  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);

  antwort.release({ json: ADMIN });

  await expect(navLinks(page)).toHaveText(ALLE_LINKS);
  await expect(page.locator("#user-chip")).toHaveText(ADMIN.email);
  await expect(page.locator("#nav-toggle")).toHaveAttribute("aria-expanded", "true");
});

test("schmales Fenster: scheitert /me, öffnet der Menüknopf trotzdem — Navigation und „Abmelden“ bleiben erreichbar", async ({ page, api }) => {
  api.stub(ME, GATEWAY);
  await page.setViewportSize(SCHMAL);
  await page.goto("/abos.html");
  await expect(page.getByRole("heading", { name: "Laden fehlgeschlagen" })).toBeVisible();
  const knopf = page.locator("#nav-toggle");

  await knopf.click();

  await expect(navLinks(page)).toHaveText(LINKS_OHNE_ADMIN);
  await expect(page.getByRole("link", { name: "Abmelden" })).toBeVisible();
  await expect(knopf).toHaveAttribute("aria-expanded", "true");
});

test("schmales Fenster: auch nach gescheitertem /me meldet „Abmelden“ aus dem Menü ab", async ({ page, api }) => {
  api.stub({ [ME]: GATEWAY, [LOGOUT]: { json: { logout_url: "/auth/abgemeldet" } }, [ABGEMELDET]: ABGEMELDET_SEITE });
  await page.setViewportSize(SCHMAL);
  await page.goto("/abos.html");
  await expect(page.getByRole("heading", { name: "Laden fehlgeschlagen" })).toBeVisible();
  await page.locator("#nav-toggle").click();
  const abmelden = page.getByRole("link", { name: "Abmelden" });
  await expect(abmelden).toBeVisible(); // erst prüfen: Ein Klick auf einen verborgenen Link wartete bis zum Zeitlimit

  await abmelden.click();

  await expect(page).toHaveURL("/auth/abgemeldet");
  await api.sync();
  expect(api.calls(LOGOUT)).toHaveLength(1);
});

// ---------- Toast ----------

test("eine Erfolgsmeldung bleibt 2,2 s stehen und blendet dann aus", async ({ page }) => {
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Abonniert: SAP Produktion");

  await page.clock.runFor(2199);
  await expectToast(page, "Abonniert: SAP Produktion");
  await page.clock.runFor(1);
  await expectKeinToast(page);
});

test("eine Fehlermeldung bleibt 5 s stehen und blendet dann aus", async ({ page, api }) => {
  api.stub(ABONNIEREN, fehler(409, "TOPIC_INACTIVE", "Der Verteiler ist nicht mehr aktiv."));
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Der Verteiler ist nicht mehr aktiv.", { error: true });

  await page.clock.runFor(4999);
  await expectToast(page, "Der Verteiler ist nicht mehr aktiv.", { error: true });
  await page.clock.runFor(1);
  await expectKeinToast(page);
});

test("ein Fehler kurz vor Ablauf der vorigen Meldung bleibt seine vollen 5 s lesbar", async ({ page, api }) => {
  api.stub(ABBESTELLEN, fehler(500, "INTERNAL", "Abbestellen fehlgeschlagen."));
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Abonniert: SAP Produktion");
  await page.clock.runFor(2199); // 1 ms, bevor die Erfolgsmeldung ausblendet …

  await schalter(page).click(); // … kommt der Fehler
  await expectToast(page, "Abbestellen fehlgeschlagen.", { error: true });
  await page.clock.runFor(1); // hier liefe der Timer der ersten Meldung ab
  await expectToast(page, "Abbestellen fehlgeschlagen.", { error: true });
  await page.clock.runFor(4998);
  await expectToast(page, "Abbestellen fehlgeschlagen.", { error: true });
  await page.clock.runFor(1);
  await expectKeinToast(page);
});

test("eine Fehlermeldung ist rot hinterlegt — daran sieht der Nutzer, dass etwas nicht geklappt hat", async ({ page, api }) => {
  api.stub(ABONNIEREN, fehler(409, "TOPIC_INACTIVE", "Der Verteiler ist nicht mehr aktiv."));
  await oeffne(page);
  await schalter(page).click();

  await expectToast(page, "Der Verteiler ist nicht mehr aktiv.", { error: true });
  await expect(page.locator("#toast")).toHaveCSS("background-color", ROT);
});

test("nach einem Fehler ist die nächste Erfolgsmeldung nicht mehr rot", async ({ page, api }) => {
  api.stub(ABONNIEREN, fehler(409, "TOPIC_INACTIVE", "Der Verteiler ist nicht mehr aktiv."));
  await oeffne(page);
  await schalter(page).click();
  await expectToast(page, "Der Verteiler ist nicht mehr aktiv.", { error: true });

  api.stub(ABONNIEREN, { status: 204 });
  await schalter(page).click();

  await expectToast(page, "Abonniert: SAP Produktion"); // prüft: nicht mehr als Fehler ausgezeichnet
  await expect(page.locator("#toast")).toHaveCSS("background-color", DUNKEL);
});

test("der Toast ist für Screenreader eine Statusmeldung", async ({ page }) => {
  await oeffne(page);
  await schalter(page).click();

  await expectToast(page, "Abonniert: SAP Produktion");
  await expect(page.getByRole("status")).toHaveText("Abonniert: SAP Produktion");
});

test("der Toast zeigt den Text der API als Text — HTML darin wird nicht zum Element", async ({ page, api }) => {
  api.stub(ABONNIEREN, fehler(409, "TOPIC_INACTIVE", XSS));
  await oeffne(page);
  await schalter(page).click();

  await expectToast(page, XSS, { error: true });
  await expect(page.locator("#toast").locator("img, [onerror]")).toHaveCount(0);
});

// ---------- escapeHtml und formatDateTime ----------

test("escapeHtml macht aus <, > und & Text", async ({ page }) => {
  await oeffne(page);
  expect(await page.evaluate(() => App.escapeHtml("<b>Müller & Söhne</b>"))).toBe("&lt;b&gt;Müller &amp; Söhne&lt;/b&gt;");
});

test("escapeHtml: null und undefined werden zum leeren Text — eine 0 bleibt stehen", async ({ page }) => {
  await oeffne(page);
  expect(await page.evaluate(() => [null, undefined, 0].map((wert) => App.escapeHtml(wert)))).toEqual(["", "", "0"]);
});

test("escapeHtml maskiert jedes Anführungszeichen, nicht nur das erste", async ({ page }) => {
  await oeffne(page);
  expect(await page.evaluate(() => App.escapeHtml("\"a\" 'b' \"c\" 'd'")))
    .toBe("&quot;a&quot; &#39;b&#39; &quot;c&quot; &#39;d&#39;");
});

test("escapeHtml: auch ein Wert mit mehreren Anführungszeichen bricht aus keinem Attribut aus", async ({ page }) => {
  await oeffne(page);
  // Gegenprobe im Parser des Browsers: derselbe Wert in beiden Attribut-Schreibweisen und als Text.
  // Bliebe ein Anführungszeichen stehen, endete das Attribut dort und der Rest legte eigene an.
  const baue = (wert) => page.evaluate((roh) => {
    const kiste = document.createElement("div");
    const sicher = App.escapeHtml(roh);
    kiste.innerHTML = '<span title="' + sicher + "\" data-wert='" + sicher + "'>" + sicher + "</span>";
    const span = kiste.firstElementChild;
    return {
      title: span.title, wert: span.dataset.wert, text: span.textContent,
      attribute: span.getAttributeNames(), elemente: kiste.querySelectorAll("*").length,
    };
  }, wert);

  for (const wert of [XSS, "x\" onmouseover=\"alert(1)\" y' onfocus='alert(2)' z"]) {
    expect(await baue(wert), wert).toEqual({ title: wert, wert, text: wert, attribute: ["title", "data-wert"], elemente: 1 });
  }
});

test("formatDateTime rechnet die naive UTC-Zeit der API in Berliner Ortszeit um — Winter- wie Sommerzeit", async ({ page }) => {
  await oeffne(page);
  const zeiten = await page.evaluate(() => [
    "2026-01-15T07:00:00", // Winterzeit, UTC+1
    "2026-07-15T07:00:00", // Sommerzeit, UTC+2
    "2026-03-29T00:59:59", // letzte Minute vor der Umstellung …
    "2026-03-29T01:00:00", // … 02:00 Uhr gibt es an diesem Tag nicht
    "2026-12-31T23:30:00", // Tages- und Jahreswechsel
    "2026-01-15T07:00:00.123456", // mit Mikrosekunden (sechs Nachkommastellen)
  ].map((iso) => App.formatDateTime(iso)));

  expect(zeiten).toEqual([
    "15.01.2026, 08:00", "15.07.2026, 09:00", "29.03.2026, 01:59", "29.03.2026, 03:00",
    "01.01.2027, 00:30", "15.01.2026, 08:00",
  ]);
});

test("formatDateTime schreibt das deutsche Format — auch in einem englisch eingestellten Browser", async ({ page }) => {
  await oeffne(page);
  // Gegenprobe: Von sich aus schreibt dieser Browser den Monat vor den Tag (playwright.config.js).
  // Schriebe er ohnehin deutsch, bewiese die zweite Zeile nichts.
  expect(await page.evaluate(() => new Date(2026, 6, 15).toLocaleDateString())).toBe("7/15/2026");
  expect(await page.evaluate(() => App.formatDateTime("2026-07-15T07:00:00"))).toBe("15.07.2026, 09:00");
});

test("formatDateTime: ein mitgeliefertes Z wird nicht verdoppelt", async ({ page }) => {
  await oeffne(page);
  expect(await page.evaluate(() => App.formatDateTime("2026-01-15T07:00:00Z"))).toBe("15.01.2026, 08:00");
});

test("formatDateTime: ohne Zeitpunkt steht „–“", async ({ page }) => {
  await oeffne(page);
  expect(await page.evaluate(() => [null, undefined, ""].map((iso) => App.formatDateTime(iso)))).toEqual(["–", "–", "–"]);
});

test("antwortet statt der API ein Proxy mit 200 und einer HTML-Seite, meldet die Seite den Fehler — nicht „Abonniert“, obwohl nichts gespeichert ist", async ({ page, api }) => {
  api.stub(ABONNIEREN, ANMELDESEITE);
  await oeffne(page);

  await schalter(page).click();

  await expectToast(page, KEINE_API_ANTWORT, { error: true });
  await expect(schalter(page)).not.toBeChecked();
});

test("requestJson: eine Erfolgsantwort ohne Rumpf (204) ist null, eine mit dem JSON-Wert null ebenfalls — nur KEIN JSON ist ein Fehler", async ({ page, api }) => {
  await oeffne(page);
  api.stub({
    "GET /api/v1/leer": { status: 204 },
    "GET /api/v1/null": { json: null },
    "GET /api/v1/html": ANMELDESEITE,
  });

  expect(await rufe(page, "/api/v1/leer")).toEqual({ daten: null });
  expect(await rufe(page, "/api/v1/null")).toEqual({ daten: null });
  expect(await rufe(page, "/api/v1/html")).toEqual({ message: KEINE_API_ANTWORT });
});
