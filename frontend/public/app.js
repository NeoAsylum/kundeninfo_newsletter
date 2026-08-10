/* Gemeinsame Frontend-Schicht: fetch-Wrapper (CSRF-Header, 401-Handling), Topbar, Toast. */

"use strict";

const App = {
  /** Zentraler fetch-Wrapper — setzt den CSRF-Header (Plan 5.6) und behandelt 401.
   *  options.background: true → bei 401 NICHT navigieren (Hintergrund-Polling darf
   *  eine gerade getippte Störungsmeldung nicht wegwerfen), nur Fehler werfen. */
  async request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "X-Requested-With": "fetch",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    if (response.status === 401) {
      if (options.background) {
        throw new Error("Sitzung abgelaufen — bitte Seite neu laden und anmelden.");
      }
      this._redirectToLogin();
      throw new Error("Nicht angemeldet — Weiterleitung zum Login");
    }
    return response;
  },

  /** Schleifenschutz: Landet der Nutzer nach einem Login-Versuch sofort wieder auf 401
   *  (z. B. Cookie wird nicht gespeichert), nicht endlos redirecten (Review-Befund). */
  _redirectToLogin() {
    const lastAttempt = Number(sessionStorage.getItem("login_redirect_at") || 0);
    if (Date.now() - lastAttempt < 30000) {
      this.toast(
        "Anmeldung fehlgeschlagen — bitte Cookies zulassen und die Seite neu laden.",
        true
      );
      return;
    }
    sessionStorage.setItem("login_redirect_at", String(Date.now()));
    window.location.href = "/auth/login?next=" + encodeURIComponent(window.location.pathname);
  },

  async requestJson(path, options = {}) {
    const response = await this.request(path, options);
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const message = (data && data.detail) || `Fehler (HTTP ${response.status})`;
      const error = new Error(message);
      error.code = data && data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  },

  /** POST-Logout (CSRF-geschützt, ADR/Review): Server beendet die Session und liefert
   *  die IdP-End-Session-URL, zu der der Browser dann navigiert. */
  async logout() {
    try {
      const data = await this.requestJson("/auth/logout", { method: "POST", background: true });
      window.location.href = (data && data.logout_url) || "/";
    } catch (error) {
      window.location.href = "/";
    }
  },

  /** Lädt /me, füllt User-Chip und blendet die Admin-Navigation ein. */
  async initTopbar(activePage) {
    const me = await this.requestJson("/api/v1/me");
    sessionStorage.removeItem("login_redirect_at"); // Session funktioniert wieder
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
    return div.innerHTML;
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
