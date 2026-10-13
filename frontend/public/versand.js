/* Versand-Maske — ausgelagert aus versand.html, damit die CSP strikt bleiben kann
   (script-src 'self', keine Inline-Skripte). */

"use strict";

const PREFIX = { stoerung: "STÖRUNG", einschraenkung: "EINSCHRÄNKUNG", entwarnung: "ENTWARNUNG" };
const SITZUNG_ABGELAUFEN =
  "Sitzung abgelaufen — die Meldung bleibt stehen. Bitte in einem zweiten Tab neu anmelden " +
  "und erneut senden.";
const VERSAND_UNGEWISS =
  "Keine Bestätigung vom Server — unklar, ob der Versand angelegt wurde. Unverändert erneut " +
  "senden verschickt nichts doppelt; die Historie unten zeigt den Stand.";
const KEINE_BERECHTIGUNG = '<tr><td colspan="6" class="empty-state">Keine Berechtigung.</td></tr>';
const HISTORIE_LAEDT =
  '<tr><td colspan="6" class="loading-state">Lade Versandhistorie …</td></tr>';
const NACHFASSEN_MS = 120000;
const OFFEN_HOECHSTENS_MS = 900000; // Obergrenze für das Nachfassen bei nicht lesbarer Historie
const topicNames = {};
let previewTimer = null;
let previewSeq = 0; // Schutz gegen überholende Vorschau-Antworten
let historyTimer = null;
let historySeq = 0; // … und gegen überholende Historien-Antworten (Polling vs. Neuladen)
let sending = false; // der Versand-Aufruf läuft
let perTastatur = false; // der Senden-Knopf wurde zuletzt mit der Tastatur ausgelöst
// Der Versand mit offenem Ausgang: sein Idempotenz-Schlüssel und die Meldung, die er trug
// (null = keiner). EIN Zustand für dreierlei — solange er gemerkt ist, steht der Hinweis
// #history-notice, fragt die Historie weiter, und dieselbe Meldung geht mit demselben
// Schlüssel erneut raus (die API antwortet dann mit dem vorhandenen Versand, statt einen
// zweiten anzulegen). So verspricht der Hinweis genau das, was der nächste Versand tut.
let offenerVersand = null;
let nachfassenBis = 0; // … und bis wann er ohne Bestätigung gemerkt bleibt
let offenBis = 0; // … und über welchen Zeitpunkt hinaus diese Frist nicht neu beginnt
let recipientCount = null; // Zahl zum gewählten Verteiler, wie angezeigt; null = steht nicht fest
let countSeq = 0; // Schutz gegen überholende Antworten zur Empfängerzahl

const el = (id) => document.getElementById(id);
const form = {
  topic: () => el("topic").value,
  severity: () => document.querySelector('input[name="severity"]:checked').value,
  title: () => el("title").value.trim(),
  body: () => el("body").value,
};
/** Die Meldung, wie Vorschau und Versand sie senden. */
const entwurf = () => ({
  topic_id: form.topic(), severity: form.severity(), title: form.title(), body: form.body(),
});

/** UUID Version 4. Nicht crypto.randomUUID: Das gibt es nur im sicheren Kontext (https,
 *  localhost), und das Portal kann im Intranet auch über http laufen. */
function neuerSchluessel() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variante nach RFC 4122
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join("-");
}

/** Merkt den Versand mit offenem Ausgang — oder vergisst ihn (null); der Hinweis folgt.
 *  Mit jedem gemerkten Versand beginnen die Frist zum Nachfassen und ihre Obergrenze neu,
 *  auch mit der unveränderten Wiederholung. */
function merkeOffenenVersand(versand) {
  offenerVersand = versand;
  nachfassenBis = versand ? Date.now() + NACHFASSEN_MS : 0;
  offenBis = versand ? Date.now() + OFFEN_HOECHSTENS_MS : 0;
  el("history-notice").hidden = !versand;
}

/** Solange der Versand-Aufruf läuft, nehmen Titel und Text keine Eingabe an: Was dann noch
 *  getippt würde, wäre nicht gesendet und nach dem Leeren der Maske weg. readOnly statt
 *  disabled — ein gesperrtes Feld verlöre den Tastaturfokus. */
function sperreMeldung(gesperrt) {
  el("title").readOnly = gesperrt;
  el("body").readOnly = gesperrt;
}

function updateSubjectPreview() {
  const topicName = topicNames[form.topic()] || "<Verteiler>";
  const title = form.title() || "<Titel>";
  el("subject-preview").textContent = `[${PREFIX[form.severity()]}] ${topicName}: ${title}`;
}

function updateSendButton() {
  // Jede Eingabe landet hier — sie darf den Knopf nicht mitten im Versand-Aufruf freigeben.
  el("send-button").disabled =
    sending || !(form.topic() && form.title() && form.body().trim());
}

function schedulePreview() {
  updateSubjectPreview();
  updateSendButton();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 350);
}

async function refreshPreview() {
  if (!form.topic() || !form.title() || !form.body().trim()) return;
  const seq = ++previewSeq;
  try {
    const data = await App.requestJson("/api/v1/admin/dispatches/preview", {
      method: "POST",
      background: true, // 401 darf die gerade getippte Meldung nicht wegnavigieren
      body: JSON.stringify(entwurf()),
    });
    if (seq !== previewSeq) return; // veraltete Antwort: eine neuere Vorschau ist unterwegs
    el("preview-frame").srcdoc = data.html;
  } catch (error) {
    // Vorschau-Fehler nicht als Toast spammen — Validierung meldet beim Senden. Die bisherige
    // Vorschau aber nicht stehen lassen: Sie zeigte nicht mehr, was gesendet würde.
    if (seq === previewSeq) el("preview-frame").srcdoc = "";
  }
}

async function refreshRecipientCount() {
  const topicId = form.topic();
  if (!topicId) return;
  const seq = ++countSeq;
  recipientCount = null; // die Zahl des vorherigen Verteilers gilt nicht mehr
  el("recipient-hint").hidden = false;
  el("recipient-count").textContent = "–";
  try {
    const data = await App.requestJson(
      "/api/v1/admin/topics/" + encodeURIComponent(topicId) + "/recipient-count",
      { background: true });
    // Veraltete Antwort: Es gibt eine neuere Abfrage — für einen anderen Verteiler oder, nach
    // Hin- und Zurückwechseln, für denselben.
    if (seq !== countSeq) return;
    recipientCount = data.count.toLocaleString("de-DE");
    el("recipient-count").textContent = recipientCount;
  } catch (error) {
    if (seq !== countSeq) return;
    el("recipient-count").textContent = "?"; // recipientCount ist seit dem Start null
  }
}

async function loadHistory() {
  const seq = ++historySeq;
  // Für die Frist zum Nachfassen zählt, wann die Abfrage begann, nicht wann ihre Antwort
  // kommt: Eine Abfrage, die nur lange unterwegs war, ist kein zugeklappter Rechner.
  const begonnen = Date.now();
  // Der noch ausstehende Poll ist mit dieser Abfrage abgelöst. Feuerte er, während sie läuft,
  // würde ausgerechnet die Antwort verworfen, die den gerade angelegten Versand zeigt.
  clearTimeout(historyTimer);
  try {
    const items = await App.requestJson("/api/v1/admin/dispatches?limit=20", { background: true });
    if (seq !== historySeq) return; // veraltete Antwort: eine neuere Abfrage ist unterwegs
    // Auch Enum-Felder (severity/status) escapen — kein stilles Vertrauen darauf,
    // dass die eigene API nie andere Werte liefert (Review-Befund).
    const zeilen = items.map((d) => `
      <tr>
        <td>${App.formatDateTime(d.created_at)}</td>
        <td><span class="sev-chip"><span class="dot dot-${App.escapeHtml(d.severity)}"></span>${App.escapeHtml(d.subject)}</span></td>
        <td>${App.escapeHtml(d.topic_name)}</td>
        <td><span class="status-badge status-${App.escapeHtml(d.status)}">${App.escapeHtml(statusLabel(d))}</span></td>
        <td class="num">${App.escapeHtml(d.sent_count)}/${App.escapeHtml(d.recipient_count)}</td>
        <td class="num">${App.escapeHtml(d.failed_count)}</td>
      </tr>`).join("");
    // Nach einem Versand mit offenem Ausgang kann der Eintrag noch kommen: Der Server legt
    // ihn womöglich erst an, nachdem hier schon gefragt wurde. Solange weiterfragen — der
    // Hinweis sagt es dazu, sonst läse sich die Liste wie „nicht angelegt“. Begann die
    // Abfrage erst nach der Frist, endet der offene Ausgang.
    if (offenerVersand && begonnen >= nachfassenBis) merkeOffenenVersand(null);
    el("history-body").innerHTML = zeilen ||
      '<tr><td colspan="6" class="empty-state">Noch keine Versände.</td></tr>';
    const anyOpen = items.some((d) => d.status === "pending" || d.status === "sending");
    if (anyOpen || offenerVersand) historyTimer = setTimeout(loadHistory, 4000);
  } catch (error) {
    if (seq !== historySeq) return;
    if (error.code === "NOT_ADMIN") {
      // Adminrecht inzwischen entzogen (ADR-0022): Jede weitere Abfrage endete genauso.
      merkeOffenenVersand(null);
      el("history-body").innerHTML = KEINE_BERECHTIGUNG;
      return;
    }
    // Solange die Historie nicht lesbar ist, beginnt die Frist zum Nachfassen mit jeder
    // gescheiterten Abfrage neu: Die erste lesbare Antwort käme sonst ohne Hinweis und
    // bliebe die einzige. Aber nie über offenBis hinaus — eine abgelaufene Sitzung heilt
    // nicht von selbst, und Stunden später wäre derselbe Text eine neue Meldung, keine
    // Wiederholung. Begann die Abfrage erst nach der Frist (Rechner zugeklappt, Obergrenze
    // erreicht), endet der offene Ausgang.
    if (offenerVersand) {
      if (begonnen < nachfassenBis) nachfassenBis = Math.min(Date.now() + NACHFASSEN_MS, offenBis);
      else merkeOffenenVersand(null);
    }
    // Ein transienter Fehler darf die Statusverfolgung nicht dauerhaft beenden
    // (Review-Befund): weiter pollen, mit gestrecktem Intervall.
    historyTimer = setTimeout(loadHistory, 10000);
  }
}

function statusLabel(d) {
  return {
    pending: "Wartet", sending: "Versand läuft …", completed: "Zugestellt",
    completed_with_errors: "Mit Fehlern", failed: "Fehlgeschlagen",
  }[d.status] || d.status;
}

async function onSubmit(event) {
  event.preventDefault();
  if (sending) return; // der gesperrte Knopf hält Klick und Enter auf, nicht jedes Absenden
  const topicName = topicNames[form.topic()] || form.topic();
  // Steht die Zahl nicht fest (lädt noch, Abfrage gescheitert), sagt die Rückfrage genau das.
  const question = recipientCount === null
    ? `Störungsmeldung an "${topicName}" jetzt versenden? (Empfängerzahl unbekannt)`
    : `Störungsmeldung an "${topicName}" (ca. ${recipientCount} Empfänger) jetzt versenden?`;
  if (!window.confirm(question)) return;
  const hatteFokus = document.activeElement === el("send-button");
  // Die Meldung, wie sie jetzt rausgeht — Verteiler und Schweregrad bleiben während des
  // Aufrufs bedienbar. Trug der Versand mit offenem Ausgang genau diese, geht sie mit seinem
  // Schlüssel raus; jede andere Meldung bekommt einen neuen. Gemerkt ist er nur, solange
  // der Hinweis über der Historie steht (merkeOffenenVersand): Später gesendet, wäre
  // derselbe Text eine neue Meldung, und die API antwortete sonst mit der alten.
  const meldung = entwurf();
  const wiederholung = offenerVersand !== null &&
    Object.keys(meldung).every((feld) => meldung[feld] === offenerVersand.meldung[feld]);
  const schluessel = wiederholung ? offenerVersand.schluessel : neuerSchluessel();
  sending = true;
  el("send-button").disabled = true;
  sperreMeldung(true);
  try {
    const angelegt = await App.requestJson("/api/v1/admin/dispatches", {
      method: "POST",
      // Bei abgelaufener Sitzung NICHT zum Login navigieren: Die getippte Meldung wäre
      // weg — ausgerechnet im Störungsfall. Sie bleibt stehen, der Hinweis sagt wie weiter.
      background: true,
      body: JSON.stringify({ ...meldung, idempotency_key: schluessel }),
    });
    // Nur ein Versand-Objekt bestätigt den Versand; 204 oder fremdes JSON lässt ihn offen.
    if (!angelegt || angelegt.id === undefined) throw new Error("Antwort ohne Versand");
    // Dieser Versand ist bestätigt — neu angelegt (201) oder, als Wiederholung, der schon
    // vorhandene (200). Dieselbe Meldung ein weiteres Mal wäre eine neue.
    merkeOffenenVersand(null);
    App.toast("Versand angelegt — läuft im Hintergrund");
    el("title").value = "";
    el("body").value = "";
    el("title-count").textContent = "0";
    el("title-count").parentElement.classList.remove("limit");
    previewSeq += 1; // eine noch laufende Vorschau gehört zur gesendeten Meldung
    el("preview-frame").srcdoc = "";
    updateSubjectPreview();
    loadHistory();
  } catch (error) {
    // Ohne Antwort der API (Netz weg, 5xx, kein JSON) ist offen, ob der Versand angelegt
    // wurde. Die Meldung behält deshalb ihren Schlüssel: Unverändert erneut gesendet, legt
    // die API keinen zweiten Versand an. Die Historie zeigt den Stand und fragt eine Weile
    // weiter (siehe loadHistory); bis sie neu geladen ist, steht dort nicht mehr der alte.
    // Eine Ablehnung (4xx) ändert am offenen Ausgang eines früheren Aufrufs nichts: Sie
    // gilt diesem Aufruf, und manche entsteht, bevor die API den Versand ansieht (401,
    // 403, 429 eines Proxys). Er endet mit einer Bestätigung oder mit dem Nachfassen.
    const ungewiss = !error.status || error.status >= 500;
    if (ungewiss) {
      merkeOffenenVersand({ schluessel, meldung });
      el("history-body").innerHTML = HISTORIE_LAEDT;
      loadHistory();
    }
    App.toast(
      error.status === 401 ? SITZUNG_ABGELAUFEN : ungewiss ? VERSAND_UNGEWISS : error.message,
      true);
  } finally {
    sending = false;
    sperreMeldung(false);
    updateSendButton();
    // `disabled` hat den Fokus auf <body> geworfen. Nach einem Fehlschlag ist der Knopf wieder
    // frei (nach einem Erfolg bleibt er gesperrt und nimmt den Fokus nicht an) — wer inzwischen
    // woanders ist, bleibt dort. Nach einem Mausklick ohne Bildlauf: Wer zur Historie
    // gescrollt hat, den holt der Fokus nicht zum Knopf zurück.
    if (hatteFokus && document.activeElement === document.body) {
      el("send-button").focus({ preventScroll: !perTastatur });
    }
  }
}

function renderNoPermission(me) {
  const grid = document.querySelector(".send-grid");
  grid.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card empty-state";

  const heading = document.createElement("h3");
  heading.textContent = "Für die Versand-Maske fehlt dir die Berechtigung";
  const message = document.createElement("p");
  message.style.cssText = "margin: 0.75rem 0 1.25rem 0; color: #64748b;";
  message.append("Du bist als ");
  const who = document.createElement("strong");
  who.textContent = me.email;
  message.append(who,
    " (Standard-Mitarbeiter) angemeldet. Um Störungsmeldungen zu versenden, " +
    "wird das im Portal vergebene Adminrecht benötigt.");

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;";
  const loginLink = document.createElement("a");
  loginLink.href = "/auth/login?prompt=login&next=/versand.html";
  loginLink.className = "btn btn-primary";
  // Umgebungsneutral: kein DEV-Testuser-Name im PROD-Image (Review-Befund)
  loginLink.textContent = "Mit anderem Konto anmelden";
  const logoutLink = document.createElement("a");
  logoutLink.href = "#";
  logoutLink.className = "btn logout-link"; // Delegation in app.js → POST-Logout
  logoutLink.textContent = "Abmelden";
  actions.append(loginLink, logoutLink);

  card.append(heading, message, actions);
  grid.appendChild(card);
  el("history-body").innerHTML = KEINE_BERECHTIGUNG;
}

async function init() {
  const me = await App.initTopbar("versand");
  if (!me.roles.includes("admin")) {
    renderNoPermission(me);
    return;
  }
  const topics = await App.requestJson("/api/v1/topics");
  const select = el("topic");
  if (!topics.length) {
    select.disabled = true;
    el("send-button").textContent = "Keine aktiven Verteiler vorhanden";
    App.toast("Es sind derzeit keine aktiven Verteiler vorhanden.", true);
    loadHistory(); // frühere Versände bleiben sichtbar, auch wenn gerade nichts zu senden ist
    return;
  }
  topics.forEach((topic) => {
    topicNames[topic.id] = topic.name;
    const option = document.createElement("option");
    option.value = topic.id;
    option.textContent = topic.name + (topic.is_mandatory ? " (Pflicht — alle Mitarbeiter)" : "");
    select.appendChild(option);
  });

  select.addEventListener("change", () => { refreshRecipientCount(); schedulePreview(); });
  document.querySelectorAll('input[name="severity"]').forEach((radio) =>
    radio.addEventListener("change", schedulePreview));
  el("title").addEventListener("input", () => {
    const length = el("title").value.length;
    el("title-count").textContent = String(length);
    el("title-count").parentElement.classList.toggle("limit", length >= 150);
    schedulePreview();
  });
  el("body").addEventListener("input", schedulePreview);
  el("send-form").addEventListener("submit", onSubmit);
  // detail 0 heißt: per Tastatur ausgelöst (ein Mausklick zählt ab 1), siehe onSubmit.
  el("send-button").addEventListener("click", (event) => { perTastatur = event.detail === 0; });

  updateSubjectPreview();
  loadHistory();
}

init().catch((error) => {
  const tbody = el("history-body");
  if (tbody) {
    tbody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-state";
    cell.textContent = "Laden fehlgeschlagen: " + error.message;
    row.appendChild(cell);
    tbody.appendChild(row);
  }
  App.toast(error.message, true);
});
