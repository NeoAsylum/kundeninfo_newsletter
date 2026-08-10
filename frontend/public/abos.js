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
    const label = document.createElement("label");
    label.className = "toggle";
    const srText = "Abonnement " + topic.name;
    label.innerHTML =
      '<input type="checkbox" aria-label="' + App.escapeHtml(srText) + '"' +
      (topic.subscribed ? " checked" : "") + ">" +
      '<span class="toggle-track"></span>';
    const input = label.querySelector("input");
    input.addEventListener("change", () => onToggle(topic, input));
    card.appendChild(label);
  }
  return card;
}

async function onToggle(topic, input) {
  const subscribe = input.checked;
  input.disabled = true;
  try {
    await App.requestJson("/api/v1/me/subscriptions/" + encodeURIComponent(topic.id), {
      method: subscribe ? "PUT" : "DELETE",
    });
    App.toast(subscribe ? "Abonniert: " + topic.name : "Abbestellt: " + topic.name);
  } catch (error) {
    input.checked = !subscribe; // Rollback bei API-Fehler
    App.toast(error.message, true);
  } finally {
    input.disabled = false;
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
