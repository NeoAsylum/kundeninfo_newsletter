/* Empfänger-Verwaltung (Admin), verteiler-zentriert: erst Verteiler wählen,
   dann aktive Empfänger per E-Mail filtern und Abos per Checkbox pflegen.
   Nutzerdaten gehen ausschließlich über DOM-APIs ins Dokument (ADR-0020). */

"use strict";

const PAGE_LIMIT = 50;

let allTopics = [];
let selectedTopic = null;
let currentQuery = "";
let currentOffset = 0; // Zahl der geladenen Zeilen
let totalCount = 0;
let searchTimer = null;
let requestSeq = 0; // Schutz gegen überholende Responses (Suche vs. Mehr-laden)
let fokusZiel = null; // zuletzt bedient (Checkbox, „Mehr laden“) und dabei den Fokus verloren
/* Umschaltungen je Empfänger und Verteiler (aboKey). Die Liste kann neu geladen werden, während
   eine Anfrage läuft, und trägt dann womöglich noch den Stand vor dem Schreiben:
   `laufend` hält bis zur Antwort den angefragten Zustand und den, auf den ein Fehler
   zurückführt ({ angefragt, davor }); `bestaetigt` den gespeicherten, bis die nächste Liste
   angefragt wird (requestUsers) — eine, die schon unterwegs war, kann älter sein. */
const laufend = new Map();
const bestaetigt = new Map();

const el = (id) => document.getElementById(id);
const aboKey = (user, topic) => user.id + ":" + topic.id;

function requestUsers(offset, limit) {
  // Vor JEDER Listenanfrage — auch vor der zweiten eines „Mehr laden“, das von vorn lädt: Was
  // bis hierher gespeichert ist, steht in der Liste, die jetzt angefragt wird.
  bestaetigt.clear();
  return App.requestJson(
    "/api/v1/admin/users?is_active=true&query=" + encodeURIComponent(currentQuery) +
    "&limit=" + limit + "&offset=" + offset
  );
}

/* `disabled` wirft den Tastaturfokus auf <body>; ist die Anfrage beantwortet, bekommt ihn das
   Element zurück. Nur das zuletzt bediente: Laufen zwei Anfragen, träfe die nächste Leertaste
   sonst die falsche Zeile. Und nur von <body>: Wer inzwischen ins Filterfeld getippt hat,
   verlöre den Fokus sonst mitten im Wort — und ein Leerzeichen würde die dann fokussierte
   Checkbox umschalten. Ein ausgeblendetes Element nimmt den Fokus nicht an. */
function fokusZurueck(element, optionen) {
  if (fokusZiel !== element) return;
  if (!document.activeElement || document.activeElement === document.body) element.focus(optionen);
}

function renderRow(user) {
  const row = document.createElement("tr");
  row.dataset.userId = user.id;

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
    const key = aboKey(user, selectedTopic);
    const umschaltung = laufend.get(key);
    const gemeldet = bestaetigt.get(key) ?? user.subscribed_topic_ids.includes(selectedTopic.id);
    // Läuft die Umschaltung noch, zeigt auch die neue Zeile den angefragten Zustand und bleibt
    // gesperrt; scheitert die Anfrage, gilt, was diese Liste gemeldet hat.
    if (umschaltung) umschaltung.davor = gemeldet;
    checkbox.checked = umschaltung ? umschaltung.angefragt : gemeldet;
    checkbox.disabled = Boolean(umschaltung);
    checkbox.addEventListener("change", () => onSubscribedToggle(user, checkbox));
  }
  subscribedCell.appendChild(checkbox);

  row.append(emailCell, subscribedCell);
  return row;
}

/* Die Checkbox des Empfängers in der Liste, die gerade dasteht — gesucht über die ID, nie über
   die Position: Die Zeilen können inzwischen neu gezeichnet, gefiltert oder verschoben sein. */
function hakenVon(user) {
  const row = Array.from(el("users-body").rows).find((r) => r.dataset.userId === String(user.id));
  return row ? row.querySelector("input") : null;
}

async function onSubscribedToggle(user, checkbox) {
  const topic = selectedTopic;
  const subscribe = checkbox.checked;
  const key = aboKey(user, topic);
  const umschaltung = { angefragt: subscribe, davor: !subscribe };
  let gespeichert = false;
  laufend.set(key, umschaltung);
  fokusZiel = document.activeElement === checkbox ? checkbox : null;
  checkbox.disabled = true;
  try {
    await App.requestJson(
      "/api/v1/admin/users/" + user.id + "/subscriptions/" + encodeURIComponent(topic.id),
      { method: subscribe ? "PUT" : "DELETE" }
    );
    gespeichert = true;
    bestaetigt.set(key, subscribe);
    App.toast((subscribe ? "Abonniert: " : "Abbestellt: ") + topic.name + " für " + user.email);
  } catch (error) {
    App.toast(error.message, true);
  } finally {
    laufend.delete(key);
    // Die Antwort gilt der Zeile, die JETZT dasteht — `checkbox` ist nach einem Neuladen nicht
    // mehr im Dokument. Unter einem anderen Verteiler oder Filter gibt es nichts zu zeigen.
    const haken = selectedTopic === topic ? hakenVon(user) : null;
    if (haken) {
      haken.checked = gespeichert ? subscribe : umschaltung.davor; // Rollback bei API-Fehler
      haken.disabled = false;
      fokusZurueck(haken);
    }
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
  // Ohne geladene Zeile gibt es keinen Anschluss, an dem sich das Nachladen prüfen ließe
  if (!currentOffset) reset = true;
  if (reset) {
    currentOffset = 0;
    showMessageRow("Lade Empfänger …");
  }
  // Nur die jüngste Anfrage darf die Tabelle verändern (Race-Schutz)
  const seq = ++requestSeq;
  // Jedes Laden entscheidet neu, auch das ohne den Knopf: Überholt eine Suche ein „Mehr laden“,
  // zöge ihre Antwort den Fokus sonst auf den Knopf, obwohl der Admin längst gefiltert hat.
  fokusZiel = document.activeElement === loadMore ? loadMore : null;
  loadMore.disabled = true;
  try {
    // Nachgeladen wird mit einer Zeile Überlappung: ab der letzten geladenen Zeile
    let data = await (
      reset ? requestUsers(0, PAGE_LIMIT) : requestUsers(currentOffset - 1, PAGE_LIMIT + 1)
    );
    if (seq !== requestSeq) return; // veraltete Response verwerfen
    const anschluss = data.items[0];
    if (!reset && (data.total !== totalCount || !anschluss ||
        String(anschluss.id) !== body.lastElementChild.dataset.userId)) {
      // Die Liste ist nach E-Mail sortiert und wird per offset geblättert. Kommt zwischen zwei
      // Seiten ein Empfänger hinzu oder fällt einer weg, verschiebt sich alles dahinter: Einer
      // stünde doppelt da (zwei Haken für dasselbe Abo) oder fehlte still. Zu erkennen an der
      // Gesamtzahl — oder, wenn zugleich einer hinzukam und einer wegfiel, daran, dass die
      // Antwort nicht mit der letzten geladenen Zeile beginnt. Dann von vorn laden, statt
      // anzuhängen. Die geladenen Zeilen bleiben bis zur Antwort stehen — scheitert sie, ist
      // nichts verloren —, nehmen so lange aber nichts an: Ihr Stand ist überholt.
      body.inert = true;
      data = await requestUsers(0, PAGE_LIMIT);
      if (seq !== requestSeq) return;
      currentOffset = 0;
      reset = true;
    }
    totalCount = data.total;
    const neu = reset ? data.items : data.items.slice(1); // ohne die Anschlusszeile
    if (reset) body.replaceChildren();
    if (!data.items.length) {
      showMessageRow(
        currentQuery
          ? "Keine aktiven Empfänger zu diesem E-Mail-Filter."
          : "Noch keine aktiven Empfänger — sie entstehen beim ersten SSO-Login."
      );
    } else {
      neu.forEach((user) => body.appendChild(renderRow(user)));
    }
    currentOffset += neu.length;
    el("result-count").textContent = currentOffset + " von " + totalCount;
    loadMore.hidden = currentOffset >= totalCount;
  } catch (error) {
    if (seq !== requestSeq) return;
    if (reset) {
      showMessageRow("Laden fehlgeschlagen: " + error.message);
      // Die Liste ist weg — zur Fehlermeldung gibt es nichts nachzuladen
      el("result-count").textContent = "";
      loadMore.hidden = true;
    }
    // Beim Nachladen bleibt die Liste stehen — nur melden
    App.toast(error.message, true);
  } finally {
    if (seq === requestSeq) {
      body.inert = false;
      loadMore.disabled = false;
      // Ohne Scrollen: Der Knopf ist mit den neuen Zeilen nach unten gewandert — die Seite
      // spränge sonst hinter die Zeilen, die gerade dazugekommen sind.
      fokusZurueck(loadMore, { preventScroll: true });
    }
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
    showMessageRow("Für die Empfänger-Verwaltung fehlt dir die Berechtigung (im Portal vergebenes Adminrecht).");
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
