/* Rollen-Verwaltung (Admin): vergibt und entzieht das im Portal geführte Adminrecht
   (ADR-0022). Gezeigt werden auch deaktivierte Empfänger, damit nachvollziehbar bleibt,
   warum die Vergabe bei ihnen gesperrt ist.

   Alles steckt in einer IIFE: Seitenskripte sind klassische Scripts, ihre Top-Level-
   Bezeichner teilen sonst einen globalen Scope mit app.js und den Nachbarseiten.
   Nutzerdaten gehen ausschließlich über DOM-APIs ins Dokument (ADR-0020). */

(function () {
  "use strict";

  const PAGE_LIMIT = 50;
  const SEARCH_DELAY = 250;

  let myEmail = "";
  let currentQuery = "";
  let currentOffset = 0;
  let totalCount = 0;
  let searchTimer = null;
  let requestSeq = 0; // Schutz gegen überholende Responses (Tippen vs. Mehr-laden)
  let lastUsed = null; // zuletzt bediente Checkbox bzw. „Mehr laden“ (siehe restoreFocus)
  const shown = new WeakMap(); // Zeile → Konto, wie die API es zuletzt gemeldet hat
  /* Die Liste kann neu geladen werden, während eine Umschaltung läuft, und kennt dann womöglich
     noch den Stand vor dem Schreiben. `pending` hält je Konto-ID die laufende Umschaltung
     { grant, checkbox }, `confirmed` das Konto aus ihrer Antwort — bis die nächste Liste
     angefragt wird: Eine, die da schon unterwegs war, kann älter sein. */
  const pending = new Map();
  const confirmed = new Map();

  const el = (id) => document.getElementById(id);

  function requestUsers(offset, limit) {
    // Was bis hierher gespeichert ist, steht in der Liste, die jetzt angefragt wird.
    confirmed.clear();
    return App.requestJson(
      "/api/v1/admin/users?query=" + encodeURIComponent(currentQuery) +
      "&limit=" + limit + "&offset=" + offset
    );
  }

  function showMessageRow(message) {
    const body = el("users-body");
    body.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "empty-state";
    cell.textContent = message;
    row.appendChild(cell);
    body.appendChild(row);
  }

  /* Die Navigation zeigt „Rollen“ nur Admins — hier landet nur, wer die URL kennt.
     Eine leere Tabelle würde wie ein leeres Portal aussehen, also die Absage ausschreiben. */
  function showDenied() {
    showMessageRow("Diese Seite ist Administratoren vorbehalten.");
    el("search").disabled = true;
    el("result-count").textContent = "";
    el("load-more").hidden = true;
  }

  /* Zeichnet die Zeile nach dem Konto, wie die API es meldet — beim Laden der Liste und nach
     jeder Antwort auf Vergabe oder Entzug. So bietet die Checkbox an, was die API annähme. */
  function showUser(row, user) {
    const [emailCell, statusCell] = row.cells;
    const checkbox = row.querySelector("input");
    shown.set(row, user);
    row.classList.toggle("row-inactive", !user.is_active);
    emailCell.textContent = user.email;
    statusCell.replaceChildren();
    if (!user.is_active) {
      const badge = document.createElement("span");
      badge.className = "badge badge-inactive";
      badge.textContent = "Deaktiviert";
      statusCell.appendChild(badge);
    }

    checkbox.checked = user.is_admin;
    checkbox.setAttribute("aria-label", "Adminrecht: " + user.email);
    checkbox.disabled = false;
    checkbox.removeAttribute("title");
    if (!user.is_active && !user.is_admin) {
      // Nur die VERGABE ist gesperrt: Die API lehnt sie mit 409 USER_INACTIVE ab, weil das
      // Recht keine Wirkung hätte (die Anmeldung endet vorher mit „Bitte neu anmelden“).
      checkbox.disabled = true;
      checkbox.title =
        "Deaktivierte Empfänger können kein Adminrecht erhalten — erst reaktivieren.";
    } else if (user.email.toLowerCase() === myEmail) {
      // Gesperrt in BEIDE Richtungen: Der Entzug endet in 409 CANNOT_REVOKE_OWN_ADMIN
      // (Aussperr-Schutz), eine Selbstvergabe wäre also nicht mehr zurücknehmbar.
      checkbox.disabled = true;
      checkbox.title = "Du kannst dir die Adminrechte nicht selbst entziehen";
    } else if (!user.is_active) {
      // Deaktiviert MIT Kennzeichen: Der Entzug muss klickbar bleiben. Sonst wäre das
      // Recht eines offboardeten Kontos nur per SQL entziehbar — und eine erneute
      // Anmeldung reaktiviert die Person (ADR-0010), womit sie sofort wieder Admin ist.
      checkbox.title =
        "Konto ist deaktiviert. Das Adminrecht lässt sich hier entziehen; eine erneute " +
        "Vergabe erst nach Reaktivierung.";
    }

    const toggle = pending.get(user.id);
    if (toggle) {
      // Die Liste wird neu gezeichnet, während die Umschaltung dieses Kontos läuft: Die neue
      // Zeile zeigt den gewünschten Stand und bleibt gesperrt, und die Antwort auf die
      // Umschaltung gilt dann ihr. Zugeordnet wird über die Konto-ID, nicht über die Stelle
      // in der Liste.
      if (lastUsed === toggle.checkbox) lastUsed = checkbox;
      toggle.checkbox = checkbox;
      checkbox.checked = toggle.grant;
      checkbox.disabled = true;
    }
  }

  function renderRow(user) {
    const row = document.createElement("tr");
    const adminCell = document.createElement("td");
    adminCell.className = "col-subscribed";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "subscribed-check";
    // Auch an gesperrten Zeilen: Eine gesperrte Checkbox löst kein „change“ aus.
    checkbox.addEventListener("change", () => onAdminToggle(checkbox));
    adminCell.appendChild(checkbox);
    row.append(document.createElement("td"), document.createElement("td"), adminCell);
    showUser(row, confirmed.get(user.id) || user);
    return row;
  }

  /* `disabled` wirft den Tastaturfokus auf <body>; nur von dort zurückholen. Nicht
     bedingungslos: Wer währenddessen ins Filterfeld getippt hat, verlöre sonst den Fokus
     mitten im Wort — und ein Leerzeichen im Text würde die nun fokussierte Checkbox
     umschalten, also fremde Adminrechte ändern. Aus demselben Grund nur an das zuletzt
     bediente Element: Laufen zwei Anfragen zugleich, zöge sonst die erste Antwort den
     Fokus zu sich zurück, und die nächste Leertaste träfe das falsche Konto. Ein
     gesperrtes oder ausgeblendetes Element nimmt ihn nicht an. */
  function restoreFocus(element, hatteFokus, options) {
    if (
      hatteFokus && lastUsed === element &&
      (!document.activeElement || document.activeElement === document.body)
    ) {
      element.focus(options);
    }
  }

  async function onAdminToggle(checkbox) {
    const user = shown.get(checkbox.closest("tr"));
    const toggle = { grant: checkbox.checked, checkbox };
    const hatteFokus = document.activeElement === checkbox;
    lastUsed = checkbox;
    pending.set(user.id, toggle);
    checkbox.disabled = true;
    let answer = null;
    try {
      answer = await App.requestJson("/api/v1/admin/users/" + user.id + "/admin", {
        method: toggle.grant ? "PUT" : "DELETE",
      });
      confirmed.set(user.id, answer);
      // Der Response ist die Wahrheit, nicht der Klick: hat jemand parallel geändert,
      // meldeten Toast und Zeile sonst einen Wunschzustand.
      App.toast(
        (answer.is_admin ? "Adminrecht vergeben: " : "Adminrecht entzogen: ") + answer.email
      );
    } catch (error) {
      App.toast(error.message, true);
    }
    pending.delete(user.id);
    // Die Antwort gilt der Zeile, die JETZT für dieses Konto dasteht (siehe showUser). Fehlt
    // es in der inzwischen geladenen Liste, ist das eine Zeile, die niemand mehr sieht — es
    // bleibt beim Toast. Gescheitert: zurück auf das, was die API zuletzt zu diesem Konto
    // gemeldet hat.
    const row = toggle.checkbox.closest("tr");
    showUser(row, answer || shown.get(row));
    restoreFocus(toggle.checkbox, hatteFokus);
  }

  async function loadPage(reset) {
    const body = el("users-body");
    const loadMore = el("load-more");
    // Steht keine Zeile da, gibt es nichts, woran sich anschließen ließe: von vorn.
    if (!currentOffset) reset = true;
    if (reset) {
      currentOffset = 0;
      showMessageRow("Lade …");
    }
    // Nur die jüngste Anfrage darf die Tabelle verändern (Race-Schutz)
    const seq = ++requestSeq;
    const hatteFokus = document.activeElement === loadMore;
    if (hatteFokus) lastUsed = loadMore;
    loadMore.disabled = true;
    try {
      // „Mehr laden“ fragt die letzte geladene Zeile noch einmal mit an.
      let data = await (
        reset ? requestUsers(0, PAGE_LIMIT) : requestUsers(currentOffset - 1, PAGE_LIMIT + 1)
      );
      if (seq !== requestSeq) return; // veraltete Response verwerfen
      // Die Liste ist nach E-Mail sortiert und wird per offset geblättert. Kommt zwischen
      // zwei Seiten ein Konto hinzu oder fällt eines weg, verschiebt sich alles: Eine Zeile
      // stünde doppelt da, ein Konto fehlte — auf der Seite, die zeigt, wer Admin ist.
      // Erkannt wird das an der Gesamtzahl und daran, dass die Antwort nicht mit dem Konto
      // beginnt, das als letztes dasteht (Vergleich über die ID). Dann von vorn laden.
      // Scheitert das, ist noch nichts umgestellt: Die geladenen Zeilen bleiben stehen, und
      // es gilt wie bei jedem Nachladen: nur melden.
      const first = data.items[0];
      const vonVorn = !reset && (
        data.total !== totalCount || !first || first.id !== shown.get(body.lastElementChild).id
      );
      if (vonVorn) {
        data = await requestUsers(0, PAGE_LIMIT);
        if (seq !== requestSeq) return;
      }
      totalCount = data.total;
      if (vonVorn) currentOffset = 0;
      if (reset || vonVorn) body.replaceChildren();
      const items = reset || vonVorn ? data.items : data.items.slice(1);
      if (!items.length && currentOffset === 0) {
        showMessageRow("Keine Treffer.");
      } else {
        items.forEach((user) => body.appendChild(renderRow(user)));
      }
      currentOffset += items.length;
      el("result-count").textContent = currentOffset + " von " + totalCount;
      loadMore.hidden = currentOffset >= totalCount;
    } catch (error) {
      if (seq !== requestSeq) return;
      if (error.code === "NOT_ADMIN") {
        // Recht zwischen /me und dieser Anfrage entzogen — dasselbe Bild wie beim
        // Direktaufruf durch einen Nicht-Admin
        showDenied();
        return;
      }
      if (reset) {
        showMessageRow("Laden fehlgeschlagen: " + error.message);
        // Die Liste ist weg — ein „Mehr laden“ würde an die Fehlermeldung anhängen
        el("result-count").textContent = "";
        loadMore.hidden = true;
      }
      // Beim Nachladen bleibt die Liste stehen — nur melden
      App.toast(error.message, true);
    } finally {
      if (seq === requestSeq) {
        loadMore.disabled = false;
        // Ohne Bildlauf: Der Knopf ist mit den neuen Zeilen nach unten gewandert — die
        // Seite spränge sonst über sie hinweg ans Ende der Liste.
        restoreFocus(loadMore, hatteFokus, { preventScroll: true });
      }
    }
  }

  async function init() {
    const me = await App.initTopbar("rollen");
    // Case-insensitiv: /me liefert die Adresse aus dem Session-Claim, die Zeile aus der
    // Datenbank. Fällt die eigene Zeile durch, wäre ihre Checkbox offen und der Klick
    // endete in 409 CANNOT_REVOKE_OWN_ADMIN.
    myEmail = (me.email || "").toLowerCase();
    if (!me.roles.includes("admin")) {
      showDenied();
      return;
    }
    el("search").disabled = false;

    el("search").addEventListener("input", () => {
      // Entprellt, damit nicht jeder Tastendruck eine Anfrage auslöst
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentQuery = el("search").value.trim();
        loadPage(true);
      }, SEARCH_DELAY);
    });
    el("load-more").addEventListener("click", () => loadPage(false));

    await loadPage(true);
  }

  init().catch((error) => {
    showMessageRow("Laden fehlgeschlagen: " + error.message);
    App.toast(error.message, true);
  });
})();
