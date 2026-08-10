/* Gemeinsame Frontend-Schicht: fetch-Wrapper (CSRF-Header, 401-Redirect), Topbar, Toast. */

"use strict";

const App = {
  /** Zentraler fetch-Wrapper — setzt den CSRF-Header (Plan 5.6) und fängt 401 ab. */
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
      window.location.href = "/auth/login?next=" + encodeURIComponent(window.location.pathname);
      throw new Error("Nicht angemeldet — Weiterleitung zum Login");
    }
    return response;
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

  /** Lädt /me, füllt User-Chip und blendet die Admin-Navigation ein. */
  async initTopbar(activePage) {
    const me = await this.requestJson("/api/v1/me");
    const chip = document.getElementById("user-chip");
    if (chip) chip.textContent = me.email;
    if (me.roles.includes("admin")) {
      const nav = document.getElementById("nav-versand");
      if (nav) nav.hidden = false;
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
