/* Gemeinsame Frontend-Schicht: fetch-Wrapper (CSRF-Header, 401-Handling), Topbar, Toast. */

"use strict";

const COOKIE_HINWEIS = "Anmeldung fehlgeschlagen — bitte Cookies zulassen und die Seite neu laden.";
const KEINE_VERBINDUNG =
  "Keine Verbindung zum Server — bitte Netzverbindung prüfen und erneut versuchen.";
// Kein „Seite neu laden“: Auf Versand- und Verteiler-Maske ginge damit die Eingabe verloren.
const KEINE_API_ANTWORT = "Unerwartete Antwort vom Server — bitte erneut versuchen.";

const App = {
  _redirecting: 0, // wann diese Seite die Weiterleitung zum Login angestoßen hat (0 = nie)

  /** Zentraler fetch-Wrapper — setzt den CSRF-Header (Plan 5.6) und behandelt 401.
   *  options.background: true → bei 401 NICHT navigieren (Hintergrund-Polling darf
   *  eine gerade getippte Störungsmeldung nicht wegwerfen), nur Fehler werfen. */
  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          "X-Requested-With": "fetch",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
    } catch (netzfehler) {
      // fetch() wirft bei Netzfehlern einen TypeError mit dem englischen Text des Browsers
      // („Failed to fetch“) — die Seiten zeigen error.message unverändert an.
      throw new Error(KEINE_VERBINDUNG);
    }
    if (response.status === 401) {
      if (options.background) {
        const error = new Error("Sitzung abgelaufen — bitte Seite neu laden und anmelden.");
        error.status = 401; // Aufrufer mit ungesicherter Eingabe formulieren den Hinweis selbst
        throw error;
      }
      throw new Error(this.loginRequired());
    }
    return response;
  },

  /** Was request() bei 401 ohne `background` tut — auch für Aufrufer, die mit `background`
   *  senden und erst bei der Antwort entscheiden, ob die Seite stehen bleiben muss
   *  (verteiler.js, Zeilen-Aktionen): leitet zum Login weiter, wenn der Schleifenschutz es
   *  zulässt, und liefert den Text, den die Seite als Toast zeigt. Greift der Schleifenschutz,
   *  muss das derselbe Hinweis sein — sonst überschreibt die Seite ihn im selben Atemzug. */
  loginRequired() {
    return this._redirectToLogin() ? "Nicht angemeldet — Weiterleitung zum Login" : COOKIE_HINWEIS;
  },

  /** Schleifenschutz: Landet der Nutzer nach einem Login-Versuch sofort wieder auf 401
   *  (z. B. Cookie wird nicht gespeichert), nicht endlos redirecten (Review-Befund).
   *  Liefert, ob weitergeleitet wurde. */
  _redirectToLogin() {
    // Mehrere Anfragen können gleichzeitig auf 401 laufen: Die zweite darf weder erneut
    // navigieren noch den Schleifenschutz auslösen — es ist noch kein Login gescheitert.
    // Befristet wie der Schleifenschutz: Bleibt die Seite stehen (Laden abgebrochen), muss
    // ein späteres 401 wieder zum Login führen.
    if (Date.now() - this._redirecting < 30000) return true;
    let schleife;
    try {
      const lastAttempt = Number(sessionStorage.getItem("login_redirect_at") || 0);
      schleife = Date.now() - lastAttempt < 30000;
      if (!schleife) sessionStorage.setItem("login_redirect_at", String(Date.now()));
    } catch (gesperrt) {
      // Sind im Browser Cookies gesperrt, wirft schon der Zugriff auf sessionStorage — genau
      // der Fall, für den der Hinweis gedacht ist. Ohne Merker liefe der Login im Kreis.
      schleife = true;
    }
    if (schleife) {
      this.toast(COOKIE_HINWEIS, true);
      return false;
    }
    this._redirecting = Date.now();
    window.location.href = "/auth/login?next=" + encodeURIComponent(window.location.pathname);
    return true;
  },

  /** Für eine aus dem Back/Forward-Cache zurückgeholte Seite (siehe pageshow unten): Gilt
   *  die Sitzung nicht mehr, geht es zum Login — an der Stelle dieser Seite im Verlauf, damit
   *  „Zurück“ nicht wieder auf dem alten Stand landet. Lässt sich die Sitzung nicht prüfen
   *  (Netz weg), bleibt die Seite stehen. */
  async _pruefeSitzung() {
    try {
      await this.requestJson("/api/v1/me", { background: true });
    } catch (error) {
      if (error.status === 401) {
        window.location.replace(
          "/auth/login?next=" + encodeURIComponent(window.location.pathname));
      }
    }
  },

  async requestJson(path, options = {}) {
    const response = await this.request(path, options);
    // undefined heißt: kein JSON im Rumpf (null wäre gültiges JSON)
    const data = response.status === 204 ? null : await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = (data && data.detail) || `Fehler (HTTP ${response.status})`;
      const error = new Error(message);
      error.code = data && data.code;
      error.status = response.status;
      throw error;
    }
    // Die API antwortet bei Erfolg mit JSON oder mit 204. Alles andere — etwa die HTML-Seite
    // eines vorgeschalteten Proxys mit Status 200 — ist kein Erfolg: Die Seiten meldeten
    // sonst „gespeichert“, obwohl nichts gespeichert ist.
    if (data === undefined) throw new Error(KEINE_API_ANTWORT);
    return data;
  },

  /** POST-Logout (CSRF-geschützt, ADR/Review): Server beendet die Session und liefert
   *  die IdP-End-Session-URL, zu der der Browser dann navigiert. */
  async logout() {
    let data;
    try {
      data = await this.requestJson("/auth/logout", { method: "POST", background: true });
    } catch (error) {
      // Abgelaufene Sitzung (401): abgemeldet ist man ohnehin — zur Startseite. Jeder andere
      // Fehler heißt: NICHT abgemeldet. Das muss der Nutzer erfahren, statt dass die Seite
      // wortlos neu lädt.
      if (error.status === 401) window.location.href = "/";
      else this.toast("Abmelden fehlgeschlagen — bitte erneut versuchen.", true);
      return;
    }
    window.location.href = (data && data.logout_url) || "/";
  },

  /** Lädt /me, füllt User-Chip und blendet die Admin-Navigation ein. */
  async initTopbar(activePage) {
    // Vor /me: Navigation und „Abmelden“ stecken im mobilen Menü und müssen auch dann
    // erreichbar sein, wenn /me scheitert oder auf sich warten lässt.
    this._initMobileMenu();
    const me = await this.requestJson("/api/v1/me");
    try {
      sessionStorage.removeItem("login_redirect_at"); // Session funktioniert wieder
    } catch (gesperrt) {
      /* sessionStorage gesperrt — siehe _redirectToLogin */
    }
    const chip = document.getElementById("user-chip");
    if (chip) chip.textContent = me.email;
    if (me.roles.includes("admin")) {
      document.querySelectorAll("[data-admin-only]").forEach((node) => {
        node.hidden = false;
      });
    }
    document.querySelectorAll(".topbar-nav a").forEach((link) => {
      if (link.dataset.page === activePage) link.classList.add("active");
    });
    return me;
  },

  /** Mobile Navigation Toggle (ADR-0006 Responsive UI) */
  _initMobileMenu() {
    const toggleBtn = document.getElementById("nav-toggle");
    const menuEl = document.getElementById("topbar-menu");
    if (toggleBtn && menuEl) {
      const toggleMenu = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const isOpen = menuEl.classList.toggle("is-open");
        toggleBtn.classList.toggle("is-active", isOpen);
        toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
        toggleBtn.setAttribute("aria-label", isOpen ? "Menü schließen" : "Menü öffnen");
      };

      toggleBtn.addEventListener("click", toggleMenu);

      document.addEventListener("click", (evt) => {
        if (menuEl.classList.contains("is-open") && !menuEl.contains(evt.target) && !toggleBtn.contains(evt.target)) {
          menuEl.classList.remove("is-open");
          toggleBtn.classList.remove("is-active");
          toggleBtn.setAttribute("aria-expanded", "false");
          toggleBtn.setAttribute("aria-label", "Menü öffnen");
        }
      });
    }
  },

  toast(message, isError = false) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), isError ? 5000 : 2200);
  },

  escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    // innerHTML maskiert nur & < > — in Attributwerten zählen auch die Anführungszeichen.
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  formatDateTime(iso) {
    if (!iso) return "–";
    return new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  },
};

/* Logout-Links (auch dynamisch erzeugte) laufen über den POST-Flow. */
document.addEventListener("click", (event) => {
  const link = event.target.closest(".logout-link");
  if (!link) return;
  event.preventDefault();
  App.logout();
});

/* Zurück-Taste: Der Browser holt die Seite samt Inhalt und Skriptzustand aus dem
   Back/Forward-Cache, ohne eine Anfrage zu stellen — auch nach dem Abmelden, dann mit den
   Daten der beendeten Sitzung. Deshalb die Sitzung prüfen. Eine Weiterleitung von damals ist
   vorbei: Ab hier entscheidet wieder der Schleifenschutz. */
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  App._redirecting = 0;
  App._pruefeSitzung();
});
