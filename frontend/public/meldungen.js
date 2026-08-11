/* Meldungs-Leseansicht für alle angemeldeten Nutzer — ausgelagert aus meldungen.html,
   damit die CSP strikt bleiben kann (script-src 'self', keine Inline-Skripte).

   IIFE: Seitenskripte sind klassische Skripte und teilen einen globalen Scope; Namen wie
   `el` sind im Bestand (empfaenger.js, versand.js) bereits belegt.

   Kein Polling: Die Seite ist ein Nachschlagewerk ohne Live-Zustand — anders als die
   Versand-Maske, die den Fortschritt eines gerade angelegten Versands verfolgt. */

(function () {
  "use strict";

  const PAGE_LIMIT = 20;
  const SEVERITY_LABELS = {
    stoerung: "Störung",
    einschraenkung: "Einschränkung",
    entwarnung: "Entwarnung",
  };

  let currentTopicId = "";
  let currentOffset = 0;
  let totalCount = 0;
  let requestSeq = 0; // Schutz gegen überholende Responses (Filterwechsel vs. Mehr-laden)

  const byId = (id) => document.getElementById(id);

  function meldungenUrl() {
    return (
      "/api/v1/dispatches?limit=" + PAGE_LIMIT + "&offset=" + currentOffset +
      (currentTopicId ? "&topic_id=" + encodeURIComponent(currentTopicId) : "")
    );
  }

  function renderMeldung(meldung) {
    // Nur bekannte Schweregrade dürfen einen Klassennamen bilden — kein stilles Vertrauen
    // darauf, dass die eigene API nie andere Werte liefert (Review-Befund versand.js).
    const label = SEVERITY_LABELS[meldung.severity];

    const article = document.createElement("article");
    article.className = "meldung";
    if (label) article.classList.add("meldung-" + meldung.severity);

    const subject = document.createElement("h2");
    subject.className = "meldung-subject";
    // Der Betreff bringt Präfix und Verteilernamen schon mit; ihn hier zu zerlegen wäre
    // eine Textsuche, die beim nächsten Betreffs-Format bricht.
    subject.textContent = meldung.subject;

    const meta = document.createElement("div");
    meta.className = "meldung-meta";
    const chip = document.createElement("span");
    chip.className = "sev-chip";
    const dot = document.createElement("span");
    dot.className = "dot" + (label ? " dot-" + meldung.severity : "");
    chip.append(dot, label || meldung.severity);
    const topicName = document.createElement("span");
    topicName.textContent = meldung.topic_name;
    const zeitpunkt = document.createElement("span");
    // Die API liefert naive UTC ohne "Z" — nur der Helper rechnet das korrekt um.
    zeitpunkt.textContent = App.formatDateTime(meldung.created_at);
    meta.append(chip, topicName, zeitpunkt);

    const body = document.createElement("p");
    body.className = "meldung-body";
    // Ausschließlich textContent: der Meldungstext ist nur längenbegrenzt, nie gegen HTML
    // validiert — per innerHTML wäre das gespeichertes XSS. pre-wrap erhält die Absätze.
    body.textContent = meldung.body;

    article.append(subject, meta, body);
    return article;
  }

  function showMessage(message, stateClass) {
    const list = byId("meldung-list");
    list.replaceChildren();
    const info = document.createElement("p");
    info.className = stateClass;
    info.textContent = message;
    list.appendChild(info);
  }

  function emptyText() {
    return currentTopicId
      ? "Für diesen Verteiler wurde noch keine Meldung versendet."
      : "Noch keine Meldungen versendet.";
  }

  async function loadPage(reset) {
    const list = byId("meldung-list");
    const loadMore = byId("load-more");
    if (reset) {
      currentOffset = 0;
      showMessage("Lade Meldungen …", "loading-state");
    }
    // Nur die jüngste Anfrage darf die Liste verändern (Race-Schutz)
    const seq = ++requestSeq;
    loadMore.disabled = true;
    try {
      const data = await App.requestJson(meldungenUrl());
      if (seq !== requestSeq) return; // veraltete Response verwerfen
      // Die Liste ist nach Zeitpunkt absteigend sortiert und wird per offset geblättert.
      // Kommt zwischen zwei Seiten eine Meldung hinzu, rutscht alles eine Position nach
      // hinten: Die zwanzigste Karte erschiene doppelt und die neueste fehlte ganz —
      // ausgerechnet die, die in einer Großstörung zählt. Verschiebung erkennen und
      // von vorn laden, statt anzuhängen.
      if (!reset && data.total !== totalCount) {
        currentOffset = 0;
        totalCount = data.total;
        await loadPage(true);
        return;
      }
      totalCount = data.total;
      if (reset) list.replaceChildren();
      if (!data.items.length && currentOffset === 0) {
        showMessage(emptyText(), "empty-state");
      } else {
        data.items.forEach((meldung) => list.appendChild(renderMeldung(meldung)));
      }
      currentOffset += data.items.length;
      byId("result-count").textContent = currentOffset + " von " + totalCount;
      loadMore.hidden = currentOffset >= totalCount;
    } catch (error) {
      if (seq !== requestSeq) return;
      if (reset) {
        showMessage("Laden fehlgeschlagen: " + error.message, "empty-state");
        // Die Liste ist weg — ein „Mehr laden“ würde an die Fehlermeldung anhängen
        byId("result-count").textContent = "";
        loadMore.hidden = true;
      }
      // Beim Nachladen bleiben die geladenen Meldungen stehen — nur melden
      App.toast(error.message, true);
    } finally {
      if (seq === requestSeq) loadMore.disabled = false;
    }
  }

  async function init() {
    await App.initTopbar("meldungen");
    // /api/v1/topics liefert nur aktive Verteiler; Meldungen zu inzwischen deaktivierten
    // bleiben in der Liste, sind aber nicht filterbar — die Historie ist unveränderlich.
    const topics = await App.requestJson("/api/v1/topics");
    const select = byId("topic-filter");
    topics.forEach((topic) => {
      const option = document.createElement("option");
      option.value = topic.id;
      option.textContent = topic.name;
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      currentTopicId = select.value;
      loadPage(true);
    });
    byId("load-more").addEventListener("click", () => loadPage(false));

    loadPage(true);
  }

  init().catch((error) => {
    showMessage("Laden fehlgeschlagen: " + error.message, "empty-state");
    App.toast(error.message, true);
  });
})();
