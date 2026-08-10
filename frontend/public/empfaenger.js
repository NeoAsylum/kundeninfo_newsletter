/* Empfänger-Verwaltung (Admin), verteiler-zentriert: erst Verteiler wählen,
   dann aktive Empfänger per E-Mail filtern und Abos per Checkbox pflegen.
   Nutzerdaten gehen ausschließlich über DOM-APIs ins Dokument (ADR-0020). */

"use strict";

const PAGE_LIMIT = 50;

let allTopics = [];
let selectedTopic = null;
let currentQuery = "";
let currentOffset = 0;
let totalCount = 0;
let searchTimer = null;
let requestSeq = 0; // Schutz gegen überholende Responses (Suche vs. Mehr-laden)

const el = (id) => document.getElementById(id);

function usersUrl() {
  return (
    "/api/v1/admin/users?is_active=true&query=" + encodeURIComponent(currentQuery) +
    "&limit=" + PAGE_LIMIT + "&offset=" + currentOffset
  );
}

function renderRow(user) {
  const row = document.createElement("tr");

  const emailCell = document.createElement("td");
  emailCell.textContent = user.email;

  const subscribedCell = document.createElement("td");
  subscribedCell.className = "col-subscribed";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "subscribed-check";
  checkbox.setAttribute("aria-label", "Abonniert: " + user.email);

  if (selectedTopic.is_mandatory) {
    // Pflicht-Topics sind implizit (ADR-0009): alle Aktiven, nicht abwählbar
    checkbox.checked = true;
    checkbox.disabled = true;
    checkbox.title = "Pflicht-Verteiler — gilt automatisch für alle aktiven Empfänger";
  } else {
    checkbox.checked = user.subscribed_topic_ids.includes(selectedTopic.id);
    checkbox.addEventListener("change", () => onSubscribedToggle(user, checkbox));
  }
  subscribedCell.appendChild(checkbox);

  row.append(emailCell, subscribedCell);
  return row;
}

async function onSubscribedToggle(user, checkbox) {
  const topic = selectedTopic;
  const subscribe = checkbox.checked;
  checkbox.disabled = true;
  try {
    await App.requestJson(
      "/api/v1/admin/users/" + user.id + "/subscriptions/" + encodeURIComponent(topic.id),
      { method: subscribe ? "PUT" : "DELETE" }
    );
    if (subscribe) {
      if (!user.subscribed_topic_ids.includes(topic.id)) user.subscribed_topic_ids.push(topic.id);
    } else {
      user.subscribed_topic_ids = user.subscribed_topic_ids.filter((id) => id !== topic.id);
    }
    App.toast((subscribe ? "Abonniert: " : "Abbestellt: ") + topic.name + " für " + user.email);
  } catch (error) {
    checkbox.checked = !subscribe; // Rollback bei API-Fehler
    App.toast(error.message, true);
  } finally {
    checkbox.disabled = false;
    checkbox.focus(); // disabled wirft den Tastaturfokus auf <body>
  }
}

function showMessageRow(message) {
  const body = el("users-body");
  body.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 2;
  cell.className = "empty-state";
  cell.textContent = message;
  row.appendChild(cell);
  body.appendChild(row);
}

async function loadPage(reset) {
  if (!selectedTopic) return;
  const body = el("users-body");
  const loadMore = el("load-more");
  if (reset) {
    currentOffset = 0;
    showMessageRow("Lade Empfänger …");
  }
  // Nur die jüngste Anfrage darf die Tabelle verändern (Race-Schutz)
  const seq = ++requestSeq;
  loadMore.disabled = true;
  try {
    const data = await App.requestJson(usersUrl());
    if (seq !== requestSeq) return; // veraltete Response verwerfen
    totalCount = data.total;
    if (reset) body.replaceChildren();
    if (!data.items.length && currentOffset === 0) {
      showMessageRow(
        currentQuery
          ? "Keine aktiven Empfänger zu diesem E-Mail-Filter."
          : "Noch keine aktiven Empfänger — sie entstehen beim ersten SSO-Login."
      );
    } else {
      data.items.forEach((user) => body.appendChild(renderRow(user)));
    }
    currentOffset += data.items.length;
    el("result-count").textContent = currentOffset + " von " + totalCount;
    loadMore.hidden = currentOffset >= totalCount;
  } catch (error) {
    if (seq !== requestSeq) return;
    if (reset) showMessageRow("Laden fehlgeschlagen: " + error.message);
    // Beim Nachladen bleibt die Liste stehen — nur melden
    App.toast(error.message, true);
  } finally {
    if (seq === requestSeq) loadMore.disabled = false;
  }
}

function onTopicChange() {
  const topicId = el("topic-filter").value;
  selectedTopic = allTopics.find((t) => t.id === topicId) || null;
  el("search").disabled = !selectedTopic;
  el("mandatory-hint").hidden = !(selectedTopic && selectedTopic.is_mandatory);
  if (selectedTopic) loadPage(true);
}

async function init() {
  const me = await App.initTopbar("empfaenger");
  if (!me.roles.includes("admin")) {
    showMessageRow("Für die Empfänger-Verwaltung fehlt dir die Berechtigung (Rolle „stoerungsinfo-admin“).");
    el("topic-filter").disabled = true;
    return;
  }
  allTopics = await App.requestJson("/api/v1/topics");
  const select = el("topic-filter");
  allTopics.forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic.id;
    option.textContent = topic.name + (topic.is_mandatory ? " (Pflicht)" : "");
    select.appendChild(option);
  });

  select.addEventListener("change", onTopicChange);
  el("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentQuery = el("search").value.trim();
      loadPage(true);
    }, 300);
  });
  el("load-more").addEventListener("click", () => loadPage(false));
}

init().catch((error) => {
  showMessageRow("Laden fehlgeschlagen: " + error.message);
  App.toast(error.message, true);
});
