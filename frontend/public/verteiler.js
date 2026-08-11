/* Verteiler-Verwaltung (Admin) — löst die per RUNBOOK dokumentierte SQL-Handarbeit ab
   (ADR-0024). Die Maske erklärt die Grenzen des Datenmodells dort, wo sie greifen:
   Ein durchgereichter 409 kommt zu spät, wenn der Admin schon getippt hat.

   IIFE, weil alle Seitenskripte einen globalen Scope teilen (`el` ist in empfaenger.js
   und versand.js bereits belegt). */

(function () {
  "use strict";

  // Identisch zu TopicCreate.id im Backend — vorab prüfen, statt 422 abzuwarten.
  const SLUG_MUSTER = /^[a-z0-9][a-z0-9-]{1,63}$/;
  const SPALTEN = 5;
  const KEINE_BERECHTIGUNG =
    "Für die Verteiler-Verwaltung fehlt dir die Berechtigung — sie ist der Rolle " +
    "„stoerungsinfo-admin“ bzw. dem im Portal vergebenen Adminrecht vorbehalten.";

  const el = (id) => document.getElementById(id);

  let verteiler = [];
  let bearbeitet = null; // Original-Datensatz beim Bearbeiten, null bei der Neuanlage
  let slugManuell = false; // sobald der Nutzer selbst tippt, keine Vorschläge mehr

  /* ---------- Liste ---------- */

  function zeigeMeldungszeile(text) {
    const body = el("verteiler-body");
    body.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = SPALTEN;
    cell.className = "empty-state";
    cell.textContent = text;
    row.appendChild(cell);
    body.appendChild(row);
  }

  /* badge-admin ist die einzige blaue Badge-Variante im Stylesheet; app.css bleibt
     unangetastet, deshalb trägt sie hier auch den laufenden Versand. */
  function badge(variante, text, titel) {
    const span = document.createElement("span");
    span.className = "badge " + variante;
    span.textContent = text;
    span.title = titel;
    return span;
  }

  function knopf(variante, text, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn " + variante + " btn-inline";
    button.textContent = text;
    button.addEventListener("click", () => handler(button));
    return button;
  }

  function loeschKnopf(topic) {
    const button = knopf("btn-danger", "Löschen", (self) => loeschen(topic, self));
    if (topic.dispatch_count > 0) {
      // Die API antwortet hier 409 TOPIC_IN_USE. Ein Knopf, der garantiert scheitert,
      // erklärt nichts — ein grauer mit Begründung schon.
      button.disabled = true;
      button.title =
        "Nicht löschbar: Über diesen Verteiler wurden bereits " + topic.dispatch_count +
        " Meldung(en) verschickt, und die Meldungshistorie bleibt unveränderlich. " +
        "Nimm ihn stattdessen mit „Deaktivieren“ aus Abo-Maske und Versand-Auswahl.";
    }
    return button;
  }

  function abosZelle(topic) {
    const cell = document.createElement("td");
    cell.className = "num";
    if (!topic.is_mandatory) {
      cell.textContent = topic.subscriber_count.toLocaleString("de-DE");
      return cell;
    }
    // Pflicht-Verteiler haben keine Abo-Zeilen (ADR-0009): jeder aktive Empfänger gilt
    // implizit. Eine 0 würde als „erreicht niemanden“ gelesen.
    cell.textContent = "–";
    cell.title =
      "Pflicht-Verteiler: Jeder aktive Empfänger ist implizit dabei, es gibt keine " +
      "Abo-Zeilen zum Zählen." +
      (topic.subscriber_count
        ? " (" + topic.subscriber_count + " ältere Abo-Zeile(n) liegen ungenutzt und würden " +
          "wieder greifen, wenn die Pflicht zurückgenommen wird.)"
        : "");
    return cell;
  }

  function zeileFuer(topic) {
    const row = document.createElement("tr");
    if (!topic.is_active) row.className = "row-inactive";

    const nameZelle = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = topic.name;
    nameZelle.appendChild(name);
    if (topic.is_mandatory) {
      nameZelle.append(" ", badge("badge-mandatory", "Pflicht",
        "Gilt automatisch für alle aktiven Empfänger und ist nicht abbestellbar"));
    }
    if (!topic.is_active) {
      nameZelle.append(" ", badge("badge-inactive", "Inaktiv",
        "Deaktiviert — erscheint weder in der Abo-Maske noch in der Versand-Auswahl; " +
        "bestehende Abos und Meldungen bleiben erhalten"));
    }
    if (topic.has_open_dispatch) {
      nameZelle.append(" ", badge("badge-admin", "Versand läuft",
        "Umbenennen ist gesperrt, bis der Versand abgeschlossen ist: Der Meldungstitel " +
        "wird zur Sendezeit aus dem Betreff zurückgerechnet und würde sonst verfälscht"));
    }
    const slug = document.createElement("div");
    slug.className = "slug-preview";
    slug.textContent = topic.id;
    nameZelle.appendChild(slug);

    const beschreibungZelle = document.createElement("td");
    beschreibungZelle.textContent = topic.description || "–";

    const meldungenZelle = document.createElement("td");
    meldungenZelle.className = "num";
    meldungenZelle.textContent = topic.dispatch_count.toLocaleString("de-DE");
    if (topic.dispatch_count > 0) {
      meldungenZelle.title =
        "Versendete Meldungen — die Historie bleibt unveränderlich und verhindert das Löschen.";
    }

    const aktionenZelle = document.createElement("td");
    const aktionen = document.createElement("div");
    aktionen.className = "row-actions";
    aktionen.append(
      knopf("btn-secondary", "Bearbeiten", () => oeffneFormular(topic)),
      knopf("btn-secondary", topic.is_active ? "Deaktivieren" : "Aktivieren",
        (self) => umschalten(topic, self)),
      loeschKnopf(topic)
    );
    aktionenZelle.appendChild(aktionen);

    row.append(nameZelle, beschreibungZelle, abosZelle(topic), meldungenZelle, aktionenZelle);
    return row;
  }

  function zeichneListe() {
    const inaktiv = verteiler.filter((topic) => !topic.is_active).length;
    el("anzahl").textContent = verteiler.length
      ? verteiler.length + " Verteiler" + (inaktiv ? ", " + inaktiv + " davon inaktiv" : "")
      : "";
    if (!verteiler.length) {
      zeigeMeldungszeile(
        "Noch kein Verteiler angelegt — „Neuen Verteiler anlegen“ erstellt den ersten.");
      return;
    }
    el("verteiler-body").replaceChildren(...verteiler.map((topic) => zeileFuer(topic)));
  }

  async function ladeListe() {
    try {
      verteiler = await App.requestJson("/api/v1/admin/topics");
    } catch (error) {
      // Das Recht kann zwischen /me und dieser Anfrage entzogen worden sein (ADR-0022:
      // require_admin prüft jede Anfrage neu) — dann keine leere Tabelle zeigen.
      zeigeMeldungszeile(
        error.code === "NOT_ADMIN" ? KEINE_BERECHTIGUNG : "Laden fehlgeschlagen: " + error.message);
      el("anzahl").textContent = "";
      App.toast(error.message, true);
      return;
    }
    zeichneListe();
  }

  /* ---------- Formular ---------- */

  /** Slug-Vorschlag aus dem Namen: kleinschreiben, Umlaute auflösen, Rest zu Bindestrichen. */
  function slugVorschlag(name) {
    const roh = name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      // Ein Lauf beliebiger Restzeichen wird zu genau EINEM Bindestrich zusammengefasst.
      .replace(/[^a-z0-9]+/g, "-");
    return roh.replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
  }

  function oeffneFormular(topic) {
    bearbeitet = topic || null;
    slugManuell = false;
    el("form-title").textContent = topic ? "Verteiler bearbeiten" : "Neuen Verteiler anlegen";

    const slug = el("feld-slug");
    slug.value = topic ? topic.id : "";
    slug.readOnly = Boolean(topic);
    el("hinweis-slug").textContent = topic
      ? "Nicht änderbar: Der Slug ist der Primärschlüssel, auf den alle Abos und alle " +
        "versendeten Meldungen verweisen."
      : "Kleinbuchstaben, Ziffern und Bindestriche, 2–64 Zeichen. Wird aus dem Namen " +
        "vorgeschlagen und ist nach dem Anlegen nicht mehr änderbar.";

    const name = el("feld-name");
    name.value = topic ? topic.name : "";
    name.readOnly = Boolean(topic && topic.has_open_dispatch);
    el("hinweis-name").textContent = name.readOnly
      ? "Umbenennen gesperrt, solange ein Versand offen ist: Der Meldungstitel wird zur " +
        "Sendezeit aus dem Betreff zurückgerechnet und stünde sonst falsch in den Mails."
      : "Erscheint in der Abo-Maske, in der Versand-Auswahl und im Betreff jeder Mail.";

    el("feld-beschreibung").value = (topic && topic.description) || "";
    el("feld-pflicht").checked = Boolean(topic && topic.is_mandatory);

    const panel = el("form-panel");
    panel.hidden = false;
    panel.scrollIntoView({ block: "center" });
    // Der Fokus startet beim Namen, weil daraus der Slug entsteht.
    (name.readOnly ? el("feld-beschreibung") : name).focus();
  }

  function schliesseFormular() {
    el("form-panel").hidden = true;
    bearbeitet = null;
    el("neu-button").focus(); // hidden würde den Tastaturfokus sonst auf <body> werfen
  }

  function pruefeEingaben(slug, name) {
    if (name.length < 2 || name.length > 120) {
      App.toast("Der Name muss 2 bis 120 Zeichen lang sein.", true);
      el("feld-name").focus();
      return false;
    }
    if (!bearbeitet && !SLUG_MUSTER.test(slug)) {
      App.toast(
        "Der Slug muss 2 bis 64 Zeichen lang sein, mit einem Kleinbuchstaben oder einer " +
        "Ziffer beginnen und darf sonst nur Kleinbuchstaben, Ziffern und Bindestriche " +
        "enthalten.", true);
      el("feld-slug").focus();
      return false;
    }
    return true;
  }

  async function speichern() {
    const slug = el("feld-slug").value.trim();
    const name = el("feld-name").value.trim();
    const beschreibung = el("feld-beschreibung").value.trim() || null;
    const pflicht = el("feld-pflicht").checked;
    if (!pruefeEingaben(slug, name)) return;

    const button = el("speichern");
    button.disabled = true;
    try {
      if (!bearbeitet) {
        await App.requestJson("/api/v1/admin/topics", {
          method: "POST",
          body: JSON.stringify({
            id: slug, name: name, description: beschreibung, is_mandatory: pflicht,
          }),
        });
        App.toast("Verteiler „" + name + "“ angelegt");
      } else {
        // Nur echte Änderungen senden: Die API wertet exclude_unset aus, ein vollständiger
        // Body würde unveränderte Felder als Änderung ins Audit-Log schreiben.
        const aenderungen = {};
        if (name !== bearbeitet.name) aenderungen.name = name;
        if (beschreibung !== (bearbeitet.description || null)) {
          aenderungen.description = beschreibung;
        }
        if (pflicht !== bearbeitet.is_mandatory) aenderungen.is_mandatory = pflicht;
        if (!Object.keys(aenderungen).length) {
          App.toast("Keine Änderung — nichts gespeichert.");
          schliesseFormular();
          return;
        }
        await App.requestJson(
          "/api/v1/admin/topics/" + encodeURIComponent(bearbeitet.id),
          { method: "PATCH", body: JSON.stringify(aenderungen) }
        );
        App.toast("Verteiler „" + name + "“ gespeichert");
      }
      schliesseFormular();
      await ladeListe();
    } catch (error) {
      // Die API-Meldungen sind fertige deutsche Sätze (TOPIC_EXISTS, TOPIC_NAME_EXISTS,
      // TOPIC_RENAME_BLOCKED) — unverändert ausgeben, das Formular bleibt offen.
      App.toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- Zeilen-Aktionen ---------- */

  async function umschalten(topic, button) {
    button.disabled = true;
    try {
      await App.requestJson("/api/v1/admin/topics/" + encodeURIComponent(topic.id), {
        method: "PATCH",
        body: JSON.stringify({ is_active: !topic.is_active }),
      });
      App.toast("„" + topic.name + "“ " + (topic.is_active ? "deaktiviert" : "aktiviert"));
      await ladeListe();
    } catch (error) {
      App.toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function loeschFrage(topic) {
    let text = "Verteiler „" + topic.name + "“ (" + topic.id + ") endgültig löschen?\n\n";
    if (!topic.subscriber_count) {
      text += "Es hängen keine Abos daran.";
    } else if (topic.is_mandatory) {
      text += topic.subscriber_count + " liegengebliebene Abo-Zeile(n) gehen mit verloren. " +
        "Sie wirken heute nicht (Pflicht-Verteiler), würden ohne die Pflicht aber wieder greifen.";
    } else {
      text += topic.subscriber_count + " Abo(s) gehen dabei verloren und sind nicht " +
        "wiederherstellbar — die Empfänger müssten sich neu eintragen.";
    }
    return text + "\n\nDas Löschen selbst ist nicht rückgängig zu machen.";
  }

  async function loeschen(topic, button) {
    if (!window.confirm(loeschFrage(topic))) return;
    button.disabled = true;
    try {
      await App.requestJson("/api/v1/admin/topics/" + encodeURIComponent(topic.id), {
        method: "DELETE",
      });
      App.toast("Verteiler „" + topic.name + "“ gelöscht");
      if (bearbeitet && bearbeitet.id === topic.id) schliesseFormular();
      await ladeListe();
    } catch (error) {
      App.toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- Start ---------- */

  async function init() {
    const me = await App.initTopbar("verteiler");
    if (!me.roles.includes("admin")) {
      zeigeMeldungszeile(KEINE_BERECHTIGUNG);
      el("neu-button").hidden = true;
      return;
    }

    el("neu-button").addEventListener("click", () => oeffneFormular(null));
    el("abbrechen").addEventListener("click", schliesseFormular);
    el("speichern").addEventListener("click", speichern);

    el("feld-name").addEventListener("input", () => {
      if (bearbeitet || slugManuell) return; // nie überschreiben, was der Nutzer getippt hat
      el("feld-slug").value = slugVorschlag(el("feld-name").value);
    });
    el("feld-slug").addEventListener("input", () => {
      // Ein geleertes Feld gibt den Vorschlag wieder frei.
      slugManuell = el("feld-slug").value.trim() !== "";
    });
    el("form-panel").addEventListener("keydown", (event) => {
      // Enter im Textfeld soll speichern wie in einem echten <form>; das Panel ist
      // bewusst keins (Inline-Maske ohne Modal-CSS). Die Textarea bleibt ausgenommen.
      if (event.key === "Enter" && event.target.tagName === "INPUT") {
        event.preventDefault();
        speichern();
      }
    });

    await ladeListe();
  }

  init().catch((error) => {
    zeigeMeldungszeile("Laden fehlgeschlagen: " + error.message);
    App.toast(error.message, true);
  });
})();
