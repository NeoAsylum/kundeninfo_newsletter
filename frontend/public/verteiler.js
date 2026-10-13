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
    "Für die Verteiler-Verwaltung fehlt dir die Berechtigung — sie ist dem im Portal " +
    "vergebenen Adminrecht vorbehalten.";
  const SITZUNG_ABGELAUFEN =
    "Sitzung abgelaufen — die Eingabe bleibt stehen. Bitte in einem zweiten Tab neu anmelden " +
    "und erneut speichern.";
  const SITZUNG_ABGELAUFEN_AKTION =
    "Sitzung abgelaufen — die Eingabe in der Maske bleibt stehen. Bitte in einem zweiten Tab " +
    "neu anmelden und die Aktion wiederholen.";

  const el = (id) => document.getElementById(id);

  let verteiler = [];
  let listenFolge = 0; // Schutz gegen überholende Listenantworten (zwei Aktionen nacheinander)
  let juengsteListe = null; // der jüngste Listenabruf — ein überholter endet erst mit ihm
  // Verteiler (ID), deren Zeilen-Aktion noch auf ihre Antwort wartet: Ihre Zeile bleibt gesperrt,
  // auch wenn ein anderes Neuladen sie inzwischen neu zeichnet (siehe zeilenAktion).
  const laufend = new Set();
  let bearbeitet = null; // Original-Datensatz beim Bearbeiten, null bei der Neuanlage
  let maskenFolge = 0; // zählt Öffnen und Schließen: Eine späte Antwort erkennt daran ihre Maske
  let slugManuell = false; // sobald der Nutzer selbst tippt, keine Vorschläge mehr
  // Der zuletzt bediente Knopf, dem der Fokus zurückgegeben wird: ein per Tastatur ausgelöster
  // Zeilen-Knopf (siehe gibFrei) oder „Speichern“ (siehe speichern); nach einem Mausklick auf
  // einen Zeilen-Knopf keiner.
  let fokusKnopf = null;

  /* ---------- Tastaturfokus ---------- */

  /** Ziel, wenn das Element mit dem Fokus verschwindet (Maske zu, Zeile gelöscht) — sonst
   *  fiele er auf <body>. */
  function fokusAufNeu() {
    // Nach einem Rechteentzug ist auch dieser Knopf versteckt — dann nimmt er den Fokus nicht an.
    el("neu-button").focus();
  }

  /** Nach dem Neuzeichnen ist derselbe Knopf ein anderes Element: wiederfinden über Verteiler
   *  und Aktion, nie über den Platz der Zeile — ein deaktivierter Verteiler rückt ans Ende. */
  function fokusAufNachfolger(alt) {
    const neu = Array.from(el("verteiler-body").querySelectorAll("button"))
      .find((button) => button.dataset.knopf === alt.dataset.knopf);
    if (neu) neu.focus();
    // Bei offener Maske nicht auf „Neuen Verteiler anlegen“: Die nächste Eingabetaste
    // ersetzte sie durch eine leere, und die Eingabe wäre weg.
    else if (el("form-panel").hidden) fokusAufNeu();
  }

  /** Sperrt oder öffnet alle Knöpfe einer Zeile. Das „Löschen“ eines nicht löschbaren
   *  Verteilers bleibt dabei gesperrt (siehe loeschKnopf). */
  function sperreZeile(row, gesperrt) {
    row.querySelectorAll("button").forEach((button) => {
      button.disabled = gesperrt || button.dataset.fest === "ja";
    });
  }

  /** Die Antwort einer Zeilen-Aktion ist da: Die Zeile ihres Verteilers wird frei — die, die
   *  jetzt auf dem Schirm steht. Gesucht über die ID, nie über den Platz: Ein Neuladen kann sie
   *  inzwischen neu gezeichnet und umsortiert haben.
   *  Die Sperre (`disabled`) hat den Fokus auf <body> geworfen. Zurück bekommt ihn nur der
   *  zuletzt ausgelöste Knopf (siehe knopf), und nur, wenn er noch auf <body> liegt: Wer
   *  inzwischen woanders ist, bleibt dort. Sonst träfe die nächste Eingabetaste einen anderen
   *  Verteiler als den, bei dem der Nutzer gerade ist. */
  function gibFrei(topic, button) {
    laufend.delete(topic.id);
    const zeile = Array.from(el("verteiler-body").rows)
      .find((row) => row.dataset.verteiler === topic.id);
    if (zeile) sperreZeile(zeile, false);
    if (fokusKnopf !== button) return;
    fokusKnopf = null;
    if (!document.activeElement || document.activeElement === document.body) {
      fokusAufNachfolger(button);
    }
  }

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

  function knopf(topic, aktion, variante, text, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn " + variante + " btn-inline";
    button.textContent = text;
    button.dataset.knopf = aktion + ":" + topic.id; // siehe fokusAufNachfolger
    button.addEventListener("click", (event) => {
      // detail 0 heißt: per Tastatur ausgelöst (ein Mausklick zählt ab 1). Nur dann gibt es
      // einen Tastaturfokus zurückzuholen — nach einem Mausklick bliebe er unsichtbar, die
      // Seite spränge ihm aber nach: zur neuen Stelle der Zeile oder an den Listenanfang.
      fokusKnopf = event.detail === 0 ? button : null;
      handler(button);
    });
    return button;
  }

  function loeschKnopf(topic) {
    const button = knopf(topic, "loeschen", "btn-danger", "Löschen",
      (self) => loeschen(topic, self));
    if (topic.dispatch_count > 0) {
      // Die API antwortet hier 409 TOPIC_IN_USE. Ein Knopf, der garantiert scheitert,
      // erklärt nichts — ein grauer mit Begründung schon.
      button.dataset.fest = "ja"; // gibt auch das Ende einer Zeilen-Aktion nicht frei (sperreZeile)
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
    row.dataset.verteiler = topic.id; // siehe gibFrei
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
      knopf(topic, "bearbeiten", "btn-secondary", "Bearbeiten", () => oeffneFormular(topic)),
      knopf(topic, "umschalten", "btn-secondary", topic.is_active ? "Deaktivieren" : "Aktivieren",
        (self) => umschalten(topic, self)),
      loeschKnopf(topic)
    );
    aktionenZelle.appendChild(aktionen);

    row.append(nameZelle, beschreibungZelle, abosZelle(topic), meldungenZelle, aktionenZelle);
    // Wartet eine Zeilen-Aktion dieses Verteilers noch auf ihre Antwort, bleibt auch die neu
    // gezeichnete Zeile gesperrt — ein zweiter Klick sendete sonst dieselbe Aktion noch einmal.
    if (laufend.has(topic.id)) sperreZeile(row, true);
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

  /** Lädt die Liste neu. Fertig ist ein Abruf erst, wenn der JÜNGSTE beantwortet ist: Wer auf
   *  einen überholten wartet (zeilenAktion), gäbe seine Zeile sonst frei, solange sie noch den
   *  alten Stand zeigt — und ein Klick sendete dieselbe Änderung noch einmal. */
  function ladeListe() {
    juengsteListe = holeListe();
    return juengsteListe;
  }

  async function holeListe() {
    // Nur die jüngste Anfrage darf die Tabelle verändern (Race-Schutz)
    const folge = ++listenFolge;
    try {
      const antwort = await App.requestJson("/api/v1/admin/topics");
      if (folge !== listenFolge) return juengsteListe; // veraltete Antwort verwerfen
      verteiler = antwort;
    } catch (error) {
      if (folge !== listenFolge) return juengsteListe;
      el("anzahl").textContent = "";
      // Das Recht kann zwischen /me und dieser Anfrage entzogen worden sein (ADR-0022:
      // require_admin prüft jede Anfrage neu) — dann keine leere Tabelle zeigen und nichts
      // stehen lassen, was nur ein Admin bedienen kann. Der Hinweis in der Tabelle sagt alles:
      // kein Toast dazu, wie auf der Rollen-Seite.
      if (error.code === "NOT_ADMIN") {
        el("neu-button").hidden = true;
        schliesseFormular();
        zeigeMeldungszeile(KEINE_BERECHTIGUNG);
        return;
      }
      zeigeMeldungszeile("Laden fehlgeschlagen: " + error.message);
      App.toast(error.message, true);
      return;
    }
    // Das Neuzeichnen nimmt einem Zeilen-Knopf den Tastaturfokus — sein Nachfolger bekommt ihn.
    const body = el("verteiler-body");
    const fokus = body.contains(document.activeElement) ? document.activeElement : null;
    zeichneListe();
    if (fokus) fokusAufNachfolger(fokus);
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

  /** Solange gespeichert wird, nimmt die Maske nichts an: Was der Admin noch tippte, ginge mit
   *  ihrem Schließen still verloren. Die Textfelder werden readOnly, nicht disabled — das nähme
   *  dem Feld den Tastaturfokus. Ohne Sperre gilt, was der Datensatz vorgibt. */
  function sperreMaske(gesperrt) {
    el("speichern").disabled = gesperrt;
    el("feld-slug").readOnly = gesperrt || Boolean(bearbeitet);
    el("feld-name").readOnly = gesperrt || Boolean(bearbeitet && bearbeitet.has_open_dispatch);
    el("feld-beschreibung").readOnly = gesperrt;
    // Ein Haken kennt kein readOnly: Das Umschalten verwirft sein click-Handler (siehe init).
    el("feld-pflicht").setAttribute("aria-disabled", String(gesperrt));
  }

  function oeffneFormular(topic) {
    bearbeitet = topic || null;
    slugManuell = false;
    // Eine neue Maske: Läuft für die vorige noch ein Speichern, sperrt es diese nicht.
    maskenFolge += 1;
    sperreMaske(false);
    el("form-title").textContent = topic ? "Verteiler bearbeiten" : "Neuen Verteiler anlegen";

    const slug = el("feld-slug");
    slug.value = topic ? topic.id : "";
    el("hinweis-slug").textContent = topic
      ? "Nicht änderbar: Der Slug ist der Primärschlüssel, auf den alle Abos und alle " +
        "versendeten Meldungen verweisen."
      : "Kleinbuchstaben, Ziffern und Bindestriche, 2–64 Zeichen. Wird aus dem Namen " +
        "vorgeschlagen und ist nach dem Anlegen nicht mehr änderbar.";

    const name = el("feld-name");
    name.value = topic ? topic.name : "";
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
    maskenFolge += 1;
    fokusAufNeu(); // hidden würde den Tastaturfokus sonst auf <body> werfen
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

  /** Als Klick-Handler mit dem Ereignis aufgerufen, per Enter im Feld ohne (siehe init). */
  async function speichern(event) {
    const button = el("speichern");
    if (button.disabled) return; // Enter im Textfeld kommt am gesperrten Knopf vorbei
    const slug = el("feld-slug").value.trim();
    const name = el("feld-name").value.trim();
    const beschreibung = el("feld-beschreibung").value.trim() || null;
    const pflicht = el("feld-pflicht").checked;
    if (!pruefeEingaben(slug, name)) return;

    const maske = maskenFolge;
    const hatteFokus = document.activeElement === button;
    const perTastatur = Boolean(event) && event.detail === 0; // wie bei den Zeilen-Knöpfen
    // Zuletzt bedient ist jetzt dieser Knopf: Die späte Antwort einer Zeilen-Aktion holt den
    // Fokus nicht mehr in ihre Zeile — die nächste Eingabetaste träfe sonst deren Knopf.
    if (hatteFokus) fokusKnopf = button;
    sperreMaske(true);
    try {
      if (!bearbeitet) {
        await App.requestJson("/api/v1/admin/topics", {
          method: "POST",
          // Bei abgelaufener Sitzung NICHT zum Login navigieren: Die Eingabe wäre weg.
          background: true,
          body: JSON.stringify({
            id: slug, name: name, description: beschreibung, is_mandatory: pflicht,
          }),
        });
        App.toast("Verteiler „" + name + "“ angelegt");
      } else {
        // Nur echte Änderungen senden (die API wertet exclude_unset aus) — ohne Änderung
        // geht keine Anfrage raus.
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
          { method: "PATCH", background: true, body: JSON.stringify(aenderungen) }
        );
        App.toast("Verteiler „" + name + "“ gespeichert");
      }
      // Inzwischen kann eine andere Maske offen sein — die schließt diese Antwort nicht.
      if (maske === maskenFolge) schliesseFormular();
      await ladeListe();
    } catch (error) {
      // Die API-Meldungen sind fertige deutsche Sätze (TOPIC_EXISTS, TOPIC_NAME_EXISTS,
      // TOPIC_RENAME_BLOCKED) — unverändert ausgeben, das Formular bleibt offen.
      App.toast(error.status === 401 ? SITZUNG_ABGELAUFEN : error.message, true);
    } finally {
      // Eine andere Maske hat ihren eigenen Stand: frei seit dem Öffnen oder selbst am Speichern.
      if (maske === maskenFolge) {
        sperreMaske(false);
        // `disabled` hat den Fokus auf <body> geworfen; die Maske ist noch offen. Zurück
        // bekommt ihn der Knopf nur, wenn seither kein Zeilen-Knopf bedient wurde. Nach einem
        // Mausklick ohne Bildlauf: Wer inzwischen in die Liste gescrollt hat, bleibt dort.
        if (hatteFokus && fokusKnopf === button && document.activeElement === document.body) {
          button.focus({ preventScroll: !perTastatur });
        }
      }
    }
  }

  /* ---------- Zeilen-Aktionen ---------- */

  /** Ablauf jeder Zeilen-Aktion. Bis sie beantwortet ist — nach einem Erfolg samt ihrem
   *  Listenabruf —, bleibt die Zeile des Verteilers gesperrt, auch über ein Neuzeichnen durch
   *  eine andere Aktion hinweg (siehe zeileFuer). */
  async function zeilenAktion(topic, button, anfrage, nachErfolg) {
    laufend.add(topic.id);
    sperreZeile(button.closest("tr"), true);
    try {
      await App.requestJson("/api/v1/admin/topics/" + encodeURIComponent(topic.id), {
        ...anfrage,
        // Ob eine abgelaufene Sitzung zum Login führt, entscheidet erst die Antwort (siehe catch).
        background: true,
      });
      nachErfolg();
      await ladeListe();
    } catch (error) {
      // Sitzung abgelaufen: Es zählt, wie die Seite JETZT dasteht — seit dem Absenden kann die
      // Maske auf- oder zugegangen sein. Ist eine offen, bleibt die Seite stehen: Die Eingabe
      // darin wäre sonst weg. Ohne Maske geht es zum Login wie bei einer Anfrage ohne `background`.
      let hinweis = error.message;
      if (error.status === 401) {
        hinweis = el("form-panel").hidden ? App.loginRequired() : SITZUNG_ABGELAUFEN_AKTION;
      }
      App.toast(hinweis, true);
    } finally {
      gibFrei(topic, button);
    }
  }

  function umschalten(topic, button) {
    zeilenAktion(
      topic, button,
      { method: "PATCH", body: JSON.stringify({ is_active: !topic.is_active }) },
      () => App.toast("„" + topic.name + "“ " + (topic.is_active ? "deaktiviert" : "aktiviert"))
    );
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

  function loeschen(topic, button) {
    if (!window.confirm(loeschFrage(topic))) return;
    zeilenAktion(topic, button, { method: "DELETE" }, () => {
      App.toast("Verteiler „" + topic.name + "“ gelöscht");
      if (bearbeitet && bearbeitet.id === topic.id) schliesseFormular();
    });
  }

  /* ---------- Start ---------- */

  async function init() {
    const me = await App.initTopbar("verteiler");
    if (!me.roles.includes("admin")) {
      zeigeMeldungszeile(KEINE_BERECHTIGUNG);
      return;
    }

    // Erst jetzt sichtbar: Ohne bestätigtes Adminrecht — auch nach einem gescheiterten /me —
    // stünde der Knopf sonst ohne Funktion da.
    el("neu-button").hidden = false;
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
    el("feld-pflicht").addEventListener("click", (event) => {
      // Während des Speicherns (siehe sperreMaske) schaltet der Haken nicht um — weder per Maus
      // noch per Leertaste noch über seine Beschriftung: Alle drei kommen hier als click an.
      // Nicht `disabled`: Das nähme ihm den Tastaturfokus.
      if (event.target.getAttribute("aria-disabled") === "true") event.preventDefault();
    });
    el("form-panel").addEventListener("keydown", (event) => {
      // Enter im Textfeld soll speichern wie in einem echten <form>; das Panel ist
      // bewusst keins (Inline-Maske ohne Modal-CSS). Die Textarea bleibt ausgenommen.
      if (event.key === "Enter" && event.target.tagName === "INPUT") {
        event.preventDefault();
        if (!event.repeat) speichern();
      }
    });
    // Eine gehaltene Eingabetaste zählt einmal. Ihre Wiederholungen träfen sonst, was inzwischen
    // den Fokus hat: das Feld der eben geöffneten Maske (oben), denselben Zeilen-Knopf mit der
    // Gegenwirkung oder „Neuen Verteiler anlegen“ gleich nach dem Speichern.
    document.addEventListener("keydown", (event) => {
      if (event.repeat && event.key === "Enter" && event.target.tagName === "BUTTON") {
        event.preventDefault();
      }
    });

    await ladeListe();
  }

  init().catch((error) => {
    zeigeMeldungszeile("Laden fehlgeschlagen: " + error.message);
    App.toast(error.message, true);
  });
})();
