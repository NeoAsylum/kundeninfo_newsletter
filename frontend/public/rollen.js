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

  const el = (id) => document.getElementById(id);

  function usersUrl() {
    return (
      "/api/v1/admin/users?query=" + encodeURIComponent(currentQuery) +
      "&limit=" + PAGE_LIMIT + "&offset=" + currentOffset
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

  function renderRow(user) {
    const row = document.createElement("tr");
    if (!user.is_active) row.className = "row-inactive";

    const emailCell = document.createElement("td");
    emailCell.textContent = user.email;

    const statusCell = document.createElement("td");
    if (!user.is_active) {
      const badge = document.createElement("span");
      badge.className = "badge badge-inactive";
      badge.textContent = "Deaktiviert";
      statusCell.appendChild(badge);
    }

    const adminCell = document.createElement("td");
    adminCell.className = "col-subscribed";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "subscribed-check";
    checkbox.checked = user.is_admin;
    checkbox.setAttribute("aria-label", "Adminrecht: " + user.email);

    if (!user.is_active && !user.is_admin) {
      // Nur die VERGABE ist gesperrt: Die API lehnt sie mit 409 USER_INACTIVE ab, weil
      // das Recht keine Wirkung hätte (die Anmeldung endet vorher mit „Bitte neu
      // anmelden“).
      checkbox.disabled = true;
      checkbox.title =
        "Deaktivierte Empfänger können kein Adminrecht erhalten — erst reaktivieren.";
    } else if (user.email.toLowerCase() === myEmail) {
      // Gesperrt in BEIDE Richtungen: Der Entzug endet in 409 CANNOT_REVOKE_OWN_ADMIN
      // (Aussperr-Schutz), eine Selbstvergabe wäre also nicht mehr zurücknehmbar.
      checkbox.disabled = true;
      checkbox.title = "Du kannst dir die Adminrechte nicht selbst entziehen";
    } else {
      if (!user.is_active) {
        // Deaktiviert MIT Kennzeichen: Der Entzug muss klickbar bleiben. Sonst wäre das
        // Recht eines offboardeten Kontos nur per SQL entziehbar — und eine erneute
        // Anmeldung reaktiviert die Person (ADR-0010), womit sie sofort wieder Admin ist.
        checkbox.title =
          "Konto ist deaktiviert. Das Adminrecht lässt sich hier entziehen; eine erneute " +
          "Vergabe erst nach Reaktivierung.";
      }
      checkbox.addEventListener("change", () => onAdminToggle(user, checkbox));
    }
    adminCell.appendChild(checkbox);

    row.append(emailCell, statusCell, adminCell);
    return row;
  }

  async function onAdminToggle(user, checkbox) {
    const grant = checkbox.checked;
    const hatteFokus = document.activeElement === checkbox;
    checkbox.disabled = true;
    try {
      const updated = await App.requestJson("/api/v1/admin/users/" + user.id + "/admin", {
        method: grant ? "PUT" : "DELETE",
      });
      // Der Response ist die Wahrheit, nicht der Klick: hat jemand parallel geändert,
      // zeigt die Zeile sonst einen Wunschzustand.
      user.is_admin = updated.is_admin;
      checkbox.checked = updated.is_admin;
      App.toast(
        (updated.is_admin ? "Adminrecht vergeben: " : "Adminrecht entzogen: ") + user.email
      );
    } catch (error) {
      checkbox.checked = !grant; // Rollback bei API-Fehler
      App.toast(error.message, true);
    } finally {
      checkbox.disabled = false;
      // `disabled` wirft den Tastaturfokus auf <body>; nur dann zurückholen. Nicht
      // bedingungslos: Wer währenddessen ins Filterfeld getippt hat, verlöre sonst den
      // Fokus mitten im Wort — und ein Leerzeichen im Text würde die nun fokussierte
      // Checkbox umschalten, also fremde Adminrechte ändern.
      if (hatteFokus && (!document.activeElement || document.activeElement === document.body)) {
        checkbox.focus();
      }
    }
  }

  async function loadPage(reset) {
    const body = el("users-body");
    const loadMore = el("load-more");
    if (reset) {
      currentOffset = 0;
      showMessageRow("Lade …");
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
        showMessageRow("Keine Treffer.");
      } else {
        data.items.forEach((user) => body.appendChild(renderRow(user)));
      }
      currentOffset += data.items.length;
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
      if (reset) showMessageRow("Laden fehlgeschlagen: " + error.message);
      // Beim Nachladen bleibt die Liste stehen — nur melden
      App.toast(error.message, true);
    } finally {
      if (seq === requestSeq) loadMore.disabled = false;
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
