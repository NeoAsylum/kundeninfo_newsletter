/* Versand-Maske — ausgelagert aus versand.html, damit die CSP strikt bleiben kann
   (script-src 'self', keine Inline-Skripte). */

"use strict";

const PREFIX = { stoerung: "STÖRUNG", einschraenkung: "EINSCHRÄNKUNG", entwarnung: "ENTWARNUNG" };
const topicNames = {};
let previewTimer = null;
let historyTimer = null;

const el = (id) => document.getElementById(id);
const form = {
  topic: () => el("topic").value,
  severity: () => document.querySelector('input[name="severity"]:checked').value,
  title: () => el("title").value.trim(),
  body: () => el("body").value,
};

function updateSubjectPreview() {
  const topicName = topicNames[form.topic()] || "<Verteiler>";
  const title = form.title() || "<Titel>";
  el("subject-preview").textContent = `[${PREFIX[form.severity()]}] ${topicName}: ${title}`;
}

function updateSendButton() {
  el("send-button").disabled = !(form.topic() && form.title() && form.body().trim());
}

function schedulePreview() {
  updateSubjectPreview();
  updateSendButton();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 350);
}

async function refreshPreview() {
  if (!form.topic() || !form.title() || !form.body().trim()) return;
  try {
    const data = await App.requestJson("/api/v1/admin/dispatches/preview", {
      method: "POST",
      body: JSON.stringify({
        topic_id: form.topic(), severity: form.severity(),
        title: form.title(), body: form.body(),
      }),
    });
    el("preview-frame").srcdoc = data.html;
  } catch (error) {
    /* Vorschau-Fehler nicht als Toast spammen — Validierung meldet beim Senden */
  }
}

async function refreshRecipientCount() {
  const topicId = form.topic();
  if (!topicId) return;
  el("recipient-hint").hidden = false;
  el("recipient-count").textContent = "–";
  try {
    const data = await App.requestJson(
      "/api/v1/admin/topics/" + encodeURIComponent(topicId) + "/recipient-count");
    el("recipient-count").textContent = data.count.toLocaleString("de-DE");
  } catch (error) {
    el("recipient-count").textContent = "?";
  }
}

async function loadHistory() {
  try {
    const items = await App.requestJson("/api/v1/admin/dispatches?limit=20");
    const tbody = el("history-body");
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Noch keine Versände.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((d) => `
      <tr>
        <td>${App.formatDateTime(d.created_at)}</td>
        <td><span class="sev-chip"><span class="dot dot-${d.severity}"></span>${App.escapeHtml(d.subject)}</span></td>
        <td>${App.escapeHtml(d.topic_name)}</td>
        <td><span class="status-badge status-${d.status}">${statusLabel(d)}</span></td>
        <td class="num">${d.sent_count}/${d.recipient_count}</td>
        <td class="num">${d.failed_count}</td>
      </tr>`).join("");
    const anyOpen = items.some((d) => d.status === "pending" || d.status === "sending");
    clearTimeout(historyTimer);
    if (anyOpen) historyTimer = setTimeout(loadHistory, 4000);
  } catch (error) {
    /* Historie-Polling still scheitern lassen */
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
  const count = el("recipient-count").textContent;
  const topicName = topicNames[form.topic()] || form.topic();
  if (!window.confirm(
    `Störungsmeldung an "${topicName}" (ca. ${count} Empfänger) jetzt versenden?`)) return;
  el("send-button").disabled = true;
  try {
    await App.requestJson("/api/v1/admin/dispatches", {
      method: "POST",
      body: JSON.stringify({
        topic_id: form.topic(), severity: form.severity(),
        title: form.title(), body: form.body(),
      }),
    });
    App.toast("Versand angelegt — läuft im Hintergrund");
    el("title").value = "";
    el("body").value = "";
    el("title-count").textContent = "0";
    el("preview-frame").srcdoc = "";
    updateSubjectPreview();
    loadHistory();
  } catch (error) {
    App.toast(error.message, true);
  } finally {
    updateSendButton();
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
    "wird die Rolle „stoerungsinfo-admin“ benötigt.");

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;";
  const loginLink = document.createElement("a");
  loginLink.href = "/auth/login?prompt=login&next=/versand.html";
  loginLink.className = "btn btn-primary";
  loginLink.textContent = "Als Admin anmelden (admin1)";
  const logoutLink = document.createElement("a");
  logoutLink.href = "/auth/logout";
  logoutLink.className = "btn";
  logoutLink.textContent = "Abmelden";
  actions.append(loginLink, logoutLink);

  card.append(heading, message, actions);
  grid.appendChild(card);
  el("history-body").innerHTML =
    '<tr><td colspan="6" class="empty-state">Keine Berechtigung.</td></tr>';
}

async function init() {
  const me = await App.initTopbar("versand");
  if (!me.roles.includes("admin")) {
    renderNoPermission(me);
    return;
  }
  const topics = await App.requestJson("/api/v1/topics");
  const select = el("topic");
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
