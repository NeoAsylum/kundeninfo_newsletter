/* Testdaten in der Form der API (backend/app/api/schemas.py). Jede Funktion liefert einen
   vollständigen Datensatz mit unauffälligen Vorgaben; der Test überschreibt nur, worauf es
   ihm ankommt. Ändert sich ein Schema, wird es HIER nachgezogen — nicht in jeder Testdatei. */

"use strict";

/** MeOut — `employee` trägt jeder angemeldete Nutzer, Admins zusätzlich `admin` (api/me.py) */
const me = (felder = {}) => ({ email: "erika@example.org", roles: ["employee"], ...felder });
const admin = (felder = {}) => me({ email: "admin@example.org", roles: ["employee", "admin"], ...felder });

/** TopicOut — GET /api/v1/topics */
const topic = (felder = {}) => ({
  id: "sap", name: "SAP Produktion", description: "Störungen im SAP",
  is_mandatory: false, subscribed: false, ...felder,
});

/** AdminTopicOut — GET /api/v1/admin/topics */
const adminTopic = (felder = {}) => ({
  id: "sap", name: "SAP Produktion", description: "Störungen im SAP",
  is_mandatory: false, is_active: true, subscriber_count: 0, dispatch_count: 0,
  has_open_dispatch: false, ...felder,
});

/** AdminUserOut — Zeile in GET /api/v1/admin/users */
const user = (felder = {}) => ({
  id: 1, email: "max@example.org", is_active: true, is_admin: false,
  subscribed_topic_ids: [], ...felder,
});

/** DispatchOut — Zeile in GET /api/v1/admin/dispatches (Zeiten: naive UTC ohne "Z") */
const dispatch = (felder = {}) => ({
  id: 7, topic_id: "sap", topic_name: "SAP Produktion", severity: "stoerung",
  subject: "[STÖRUNG] SAP Produktion: Login gestört", status: "completed",
  recipient_count: 10, sent_count: 10, failed_count: 0, open_count: 0,
  created_at: "2026-01-15T07:00:00", finished_at: "2026-01-15T07:01:00", ...felder,
});

/** MeldungOut — Zeile in GET /api/v1/dispatches */
const meldung = (felder = {}) => ({
  id: 7, topic_id: "sap", topic_name: "SAP Produktion", severity: "stoerung",
  subject: "[STÖRUNG] SAP Produktion: Login gestört", body: "Bitte nicht neu anmelden.",
  created_at: "2026-01-15T07:00:00", ...felder,
});

/** Listenumschlag der blätterbaren Endpunkte (AdminUserListOut, MeldungListOut) */
const liste = (items, total = items.length, limit = 50, offset = 0) => ({ items, total, limit, offset });

/** Fehlerantwort der API: { detail, code } (backend/app/api/errors.py). Wo ein Test nur
 *  zeigt, dass die Seite `detail` ausgibt, sind Status und Code teils erfunden (etwa
 *  500/INTERNAL) — maßgeblich ist dort allein der Text. */
const fehler = (status, code, detail) => ({ status, json: { detail, code } });
const NICHT_ANGEMELDET = fehler(401, "UNAUTHENTICATED", "Nicht angemeldet");
const KEIN_ADMIN = fehler(403, "NOT_ADMIN", "Keine Berechtigung für diese Funktion");

/** Zielseite der Weiterleitung zum Login (GET /auth/login) */
const LOGIN_STUB = { html: "<!DOCTYPE html><title>Login (Stub)</title>" };

/** So antwortet NGINX, wenn das Backend weg ist: kein JSON, die Seite meldet „Fehler (HTTP 502)“.
 *  Unter /api/ gibt es kein JSON-5xx: ApiError und Validierung antworten mit 4xx, ein
 *  unbehandelter Fehler ist Klartext. */
const GATEWAY = { status: 502, html: "<h1>502 Bad Gateway</h1>" };

/** Statt der API antwortet etwas davor, etwa die Anmeldeseite eines Proxys: 200, aber kein
 *  JSON. app.js meldet dann KEINE_API_ANTWORT. */
const ANMELDESEITE = { status: 200, html: "<h1>Bitte anmelden</h1>" };
const KEINE_API_ANTWORT = "Unerwartete Antwort vom Server — bitte erneut versuchen.";
/** So meldet app.js einen Netzfehler (Stub: { abort: true }). */
const KEINE_VERBINDUNG = "Keine Verbindung zum Server — bitte Netzverbindung prüfen und erneut versuchen.";

/** Angriffstext für XSS-Prüfungen: darf nirgends zu einem Element werden. */
const XSS = '<img src=x onerror=alert(1)>"\'';

module.exports = {
  me, admin, topic, adminTopic, user, dispatch, meldung, liste, fehler,
  NICHT_ANGEMELDET, KEIN_ADMIN, LOGIN_STUB, GATEWAY, ANMELDESEITE, KEINE_API_ANTWORT, KEINE_VERBINDUNG, XSS,
};
