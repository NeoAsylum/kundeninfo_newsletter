/* Empfänger-Verwaltung (Admin): browsen/suchen, Abos pflegen, deaktivieren.
   Alle Nutzerdaten laufen über DOM-APIs (textContent/setAttribute) — kein
   String-HTML mit Nutzerinhalten (CSP-/Injection-Regel, ADR-0020). */

"use strict";

const PAGE_LIMIT = 50;

let allTopics = [];
let currentQuery = "";
let currentOffset = 0;
let totalCount = 0;
let searchTimer = null;

let requestSeq = 0; // Schutz gegen überholende Responses (Suche vs. Mehr-laden)

const el = (id) => document.getElementById(id);
const topicName = (id) => {
  const topic = allTopics.find((t) => t.id === id);
  // /api/v1/topics liefert nur aktive Topics — Abos auf deaktivierte bleiben
  // sichtbar (und entfernbar), werden aber als inaktiv gekennzeichnet
  return topic ? topic.name : "Inaktiv: " + id;
};

function usersUrl() {
  return (
    "/api/v1/admin/users?query=" + encodeURIComponent(currentQuery) +
    "&limit=" + PAGE_LIMIT + "&offset=" + currentOffset
  );
}

function statusBadge(user) {
  const badge = document.createElement("span");
  badge.className = "status-badge " + (user.is_active ? "badge-active" : "badge-inactive");
  badge.textContent = user.is_active ? "Aktiv" : "Inaktiv";
  return badge;
}

function fillSubscriptionCell(cell, user) {
  cell.replaceChildren();
  if (!user.subscribed_topic_ids.length) {
    cell.textContent = "–";
    cell.title = "Keine freiwilligen Abonnements (Pflicht-Verteiler gelten automatisch)";
    return;
  }
  cell.title = "";
  user.subscribed_topic_ids.forEach((topicId) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = topicName(topicId);
    cell.appendChild(chip);
  });
}

function renderRow(user) {
  const row = document.createElement("tr");
  row.className = user.is_active ? "" : "inactive";

  const emailCell = document.createElement("td");
  emailCell.textContent = user.email;
  const nameCell = document.createElement("td");
  nameCell.textContent = user.display_name || "–";
  const statusCell = document.createElement("td");
  statusCell.appendChild(statusBadge(user));
  const subsCell = document.createElement("td");
  fillSubscriptionCell(subsCell, user);

  const actionCell = document.createElement("td");
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "btn btn-secondary";
  editButton.textContent = "Bearbeiten";
  actionCell.appendChild(editButton);

  row.append(emailCell, nameCell, statusCell, subsCell, actionCell);

  let detailRow = null;
  const detailId = "user-detail-" + user.id;
  editButton.setAttribute("aria-expanded", "false");
  editButton.setAttribute("aria-controls", detailId);
  editButton.addEventListener("click", () => {
    if (detailRow) {
      detailRow.remove();
      detailRow = null;
      editButton.textContent = "Bearbeiten";
      editButton.setAttribute("aria-expanded", "false");
      return;
    }
    detailRow = renderDetailRow(user, row, statusCell, subsCell);
    detailRow.id = detailId;
    row.after(detailRow);
    editButton.textContent = "Schließen";
    editButton.setAttribute("aria-expanded", "true");
  });

  return row;
}

function renderDetailRow(user, row, statusCell, subsCell) {
  const detail = document.createElement("tr");
  detail.className = "detail-row";
  const cell = document.createElement("td");
  cell.colSpan = 5;

  const grid = document.createElement("div");
  grid.className = "detail-grid";

  // --- Block 1: Abonnements ---
  const subsBlock = document.createElement("div");
  subsBlock.className = "detail-block";
  const subsHeading = document.createElement("h4");
  subsHeading.textContent = "Abonnements";
  subsBlock.appendChild(subsHeading);

  allTopics.forEach((topic) => {
    const line = document.createElement("label");
    line.className = "detail-topic";
    if (topic.is_mandatory) {
      const note = document.createElement("span");
      note.className = "mandatory-note";
      note.textContent = "🔒 " + topic.name + " — Pflicht, gilt automatisch für alle Aktiven";
      line.appendChild(note);
    } else {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = user.subscribed_topic_ids.includes(topic.id);
      checkbox.setAttribute("aria-label", "Abo " + topic.name + " für " + user.email);
      const text = document.createElement("span");
      text.textContent = topic.name;
      line.append(checkbox, text);
      checkbox.addEventListener("change", () =>
        onSubscriptionToggle(user, topic, checkbox, subsCell)
      );
    }
    subsBlock.appendChild(line);
  });

  // --- Block 2: Status ---
  const statusBlock = document.createElement("div");
  statusBlock.className = "detail-block";
  const statusHeading = document.createElement("h4");
  statusHeading.textContent = "Status";
  statusBlock.appendChild(statusHeading);

  const toggleLine = document.createElement("label");
  toggleLine.className = "detail-topic";
  const toggleWrap = document.createElement("span");
  toggleWrap.className = "toggle";
  const activeInput = document.createElement("input");
  activeInput.type = "checkbox";
  activeInput.checked = user.is_active;
  activeInput.setAttribute("aria-label", "Empfänger aktiv: " + user.email);
  const track = document.createElement("span");
  track.className = "toggle-track";
  toggleWrap.append(activeInput, track);
  const toggleText = document.createElement("span");
  toggleText.textContent = "Empfänger ist aktiv";
  toggleLine.append(toggleWrap, toggleText);
  statusBlock.appendChild(toggleLine);

  const hint = document.createElement("p");
  hint.className = "detail-hint";
  hint.textContent =
    "Inaktive Empfänger erhalten keine künftigen Störungsmeldungen — auch keine " +
    "Pflicht-Verteiler. Bereits angelegte Versände behalten ihren Empfänger-Snapshot. " +
    "Meldet sich die Person erneut per SSO an, wird sie automatisch wieder aktiviert " +
    "(gedacht für Offboarding, nicht als dauerhafter Ausschluss).";
  statusBlock.appendChild(hint);

  activeInput.addEventListener("change", () =>
    onActiveToggle(user, activeInput, row, statusCell)
  );

  grid.append(subsBlock, statusBlock);
  cell.appendChild(grid);
  detail.appendChild(cell);
  return detail;
}

async function onSubscriptionToggle(user, topic, checkbox, subsCell) {
  const subscribe = checkbox.checked;
  checkbox.disabled = true;
  try {
    await App.requestJson(
      "/api/v1/admin/users/" + user.id + "/subscriptions/" + encodeURIComponent(topic.id),
      { method: subscribe ? "PUT" : "DELETE" }
    );
    if (subscribe) {
      if (!user.subscribed_topic_ids.includes(topic.id)) {
        user.subscribed_topic_ids.push(topic.id);
        user.subscribed_topic_ids.sort();
      }
    } else {
      user.subscribed_topic_ids = user.subscribed_topic_ids.filter((id) => id !== topic.id);
    }
    fillSubscriptionCell(subsCell, user);
    App.toast((subscribe ? "Abonniert: " : "Abbestellt: ") + topic.name + " für " + user.email);
  } catch (error) {
    checkbox.checked = !subscribe;
    App.toast(error.message, true);
  } finally {
    checkbox.disabled = false;
    checkbox.focus(); // disabled wirft den Tastaturfokus auf <body> (Review-Befund)
  }
}

async function onActiveToggle(user, activeInput, row, statusCell) {
  const activate = activeInput.checked;
  activeInput.disabled = true;
  try {
    const updated = await App.requestJson("/api/v1/admin/users/" + user.id, {
      method: "PATCH",
      body: JSON.stringify({ is_active: activate }),
    });
    user.is_active = updated.is_active;
    row.className = user.is_active ? "" : "inactive";
    statusCell.replaceChildren(statusBadge(user));
    App.toast(user.email + (user.is_active ? " aktiviert" : " deaktiviert"));
  } catch (error) {
    activeInput.checked = !activate;
    App.toast(error.message, true);
  } finally {
    activeInput.disabled = false;
    activeInput.focus();
  }
}

function showMessageRow(message) {
  const body = el("users-body");
  body.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.className = "empty-state";
  cell.textContent = message;
  row.appendChild(cell);
  body.appendChild(row);
}

async function loadPage(reset) {
  const body = el("users-body");
  const loadMore = el("load-more");
  if (reset) {
    currentOffset = 0;
    showMessageRow("Lade Empfänger …");
  }
  // Sequenz-Token: Nur die jüngste Anfrage darf die Tabelle verändern — sonst
  // überschreibt eine überholte Such-Response neuere Ergebnisse (Review-Befund).
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
          ? "Keine Empfänger zu dieser Suche gefunden."
          : "Noch keine Empfänger — sie entstehen beim ersten SSO-Login."
      );
    } else {
      data.items.forEach((user) => body.appendChild(renderRow(user)));
    }
    currentOffset += data.items.length;
    el("result-count").textContent = currentOffset + " von " + totalCount;
    loadMore.hidden = currentOffset >= totalCount;
  } catch (error) {
    if (seq !== requestSeq) return;
    if (reset) {
      showMessageRow("Laden fehlgeschlagen: " + error.message);
    }
    // Beim Nachladen bleibt die bestehende Liste stehen — nur melden (Review-Befund)
    App.toast(error.message, true);
  } finally {
    if (seq === requestSeq) loadMore.disabled = false;
  }
}

async function init() {
  const me = await App.initTopbar("empfaenger");
  if (!me.roles.includes("admin")) {
    showMessageRow("Für die Empfänger-Verwaltung fehlt dir die Berechtigung (Rolle „stoerungsinfo-admin“).");
    el("search").disabled = true;
    return;
  }
  allTopics = await App.requestJson("/api/v1/topics");

  el("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentQuery = el("search").value.trim();
      loadPage(true);
    }, 300);
  });
  el("load-more").addEventListener("click", () => loadPage(false));

  await loadPage(true);
}

init().catch((error) => {
  showMessageRow("Laden fehlgeschlagen: " + error.message);
  App.toast(error.message, true);
});
