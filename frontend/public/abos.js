/* Abo-Maske — ausgelagert aus abos.html, damit die CSP strikt bleiben kann
   (script-src 'self', keine Inline-Skripte). */

"use strict";

const LOCK_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" stroke-width="2"/></svg>';

function renderTopic(topic) {
  const card = document.createElement("div");
  card.className = "card topic-card" + (topic.is_mandatory ? " mandatory" : "");

  const info = document.createElement("div");
  info.className = "topic-info";
  const badge = topic.is_mandatory ? ' <span class="badge badge-mandatory">Pflicht</span>' : "";
  info.innerHTML =
    '<div class="topic-title"><span>' + App.escapeHtml(topic.name) + "</span>" + badge + "</div>" +
    '<div class="topic-desc">' + App.escapeHtml(topic.description || "") + "</div>";
  card.appendChild(info);

  if (topic.is_mandatory) {
    const locked = document.createElement("span");
    locked.className = "locked-state";
    locked.innerHTML = LOCK_ICON + " Aktiv";
    locked.title = "Pflicht-Verteiler — nicht abwählbar";
    card.appendChild(locked);
  } else {
    // DOM-API statt String-HTML: escapeHtml deckt Attribut-Kontexte (Quotes)
    // nicht ab — setAttribute ist injektionssicher (Review-Befund).
    const label = document.createElement("label");
    label.className = "toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = topic.subscribed;
    input.setAttribute("aria-label", "Abonnement " + topic.name);
    const track = document.createElement("span");
    track.className = "toggle-track";
    label.append(input, track);
    // detail 0 heißt: per Tastatur umgeschaltet (ein Mausklick zählt ab 1), siehe onToggle.
    input.addEventListener("click", (event) => { perTastatur = event.detail === 0; });
    input.addEventListener("change", () => onToggle(topic, input));
    card.appendChild(label);
  }
  return card;
}

let letzterSchalter = null; // der zuletzt bediente — nur er holt sich den Fokus zurück
let perTastatur = false; // … und ob das mit der Tastatur geschah
let laufend = 0; // Umschaltungen, deren Antwort noch aussteht

/* Die Sperre (`disabled`) wirft den Tastaturfokus auf <body>. Eine zweite Leertaste („doch
   nicht“) träfe dort die Seite und blätterte sie weiter — der Schalter wäre aus dem Bild.
   Solange eine per Tastatur ausgelöste Umschaltung läuft, tut die Leertaste dort nichts. */
document.addEventListener("keydown", (event) => {
  if (event.key === " " && event.target === document.body && laufend > 0 && perTastatur) {
    event.preventDefault();
  }
});

async function onToggle(topic, input) {
  const subscribe = input.checked;
  const hatteFokus = document.activeElement === input;
  letzterSchalter = input;
  input.disabled = true;
  laufend += 1;
  try {
    await App.requestJson("/api/v1/me/subscriptions/" + encodeURIComponent(topic.id), {
      method: subscribe ? "PUT" : "DELETE",
    });
    App.toast(subscribe ? "Abonniert: " + topic.name : "Abbestellt: " + topic.name);
  } catch (error) {
    input.checked = !subscribe; // Rollback bei API-Fehler
    App.toast(error.message, true);
  } finally {
    laufend -= 1;
    input.disabled = false;
    // Den Fokus nur zurückholen, wenn er noch auf <body> liegt — wer inzwischen
    // weitergegangen ist, behält seinen. Von zwei laufenden Umschaltungen bekommt ihn
    // nur die letzte: Sonst träfe die nächste Leertaste den falschen Verteiler. Nach einem
    // Mausklick ohne Scrollen: Wer inzwischen weitergescrollt hat, den holt die Antwort nicht
    // zurück. Nach der Tastatur mit: Die nächste Leertaste träfe sonst einen Schalter, den
    // man nicht sieht.
    const fokusAufBody = !document.activeElement || document.activeElement === document.body;
    if (hatteFokus && letzterSchalter === input && fokusAufBody) {
      input.focus({ preventScroll: !perTastatur });
    }
  }
}

function renderLoadError(list, error) {
  list.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card empty-state";
  const heading = document.createElement("h3");
  heading.textContent = "Laden fehlgeschlagen";
  const message = document.createElement("p");
  message.style.cssText = "margin: 0.5rem 0 1rem 0; color: #64748b;";
  message.textContent = error.message;
  const retry = document.createElement("button");
  retry.className = "btn btn-primary";
  retry.textContent = "Erneut versuchen (F5)";
  retry.addEventListener("click", () => window.location.reload());
  card.append(heading, message, retry);
  list.appendChild(card);
}

async function init() {
  const list = document.getElementById("topic-list");
  try {
    await App.initTopbar("abos");
    const topics = await App.requestJson("/api/v1/topics");
    list.innerHTML = "";
    if (!topics.length) {
      list.innerHTML = '<div class="card empty-state">Derzeit sind keine Verteiler verfügbar.</div>';
      return;
    }
    topics.forEach((topic) => list.appendChild(renderTopic(topic)));
  } catch (error) {
    renderLoadError(list, error);
    App.toast(error.message, true);
  }
}

init();
