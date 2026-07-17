(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }
  function safeParse(raw, fallback) { try { return JSON.parse(raw); } catch (_e) { return fallback; } }
  function normEmail(v) { return String(v || "").trim().toLowerCase(); }
  function toInt(v, f) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : f; }
  function esc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }

  function loginPath() { return "../Account/form.html"; }

  function resolveProjectPrefix() {
    const path = String(window.location.pathname || "/");
    const lower = path.toLowerCase();
    const marker = "/frontend/";
    const markerIndex = lower.indexOf(marker);
    if (markerIndex >= 0) return path.slice(0, markerIndex);
    if (lower.endsWith("/frontend")) return path.slice(0, -9);
    return "";
  }

  function apiBaseUrl() {
    const prefix = resolveProjectPrefix().replace(/\/+$/, "");
    return `${prefix}/backend/public/index.php/api`;
  }

  function readCsrfToken() {
    return String(sessionStorage.getItem("foodiehub_csrf_token_v1") || "").trim();
  }

  function writeCsrfToken(token) {
    const value = String(token || "").trim();
    if (!value) return;
    sessionStorage.setItem("foodiehub_csrf_token_v1", value);
  }

  function captureCsrfToken(response) {
    if (!response || !response.headers) return;
    writeCsrfToken(response.headers.get("X-CSRF-Token") || "");
  }

  function isUnsafeMethod(method) {
    const value = String(method || "GET").toUpperCase();
    return value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE";
  }

  async function ensureCsrfToken(forceRefresh) {
    if (!forceRefresh) {
      const existing = readCsrfToken();
      if (existing) return existing;
    }
    const response = await fetch(`${apiBaseUrl()}/health`, {
      method: "GET",
      credentials: "include"
    });
    captureCsrfToken(response);
    return readCsrfToken();
  }

  async function apiRequest(path, options) {
    const p = String(path || "");
    const url = `${apiBaseUrl()}${p.startsWith("/") ? "" : "/"}${p}`;
    const init = Object.assign({
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include"
    }, options || {});
    init.headers = Object.assign({}, init.headers || {});

    if (isUnsafeMethod(init.method)) {
      const csrfToken = await ensureCsrfToken(false);
      if (csrfToken) init.headers["X-CSRF-Token"] = csrfToken;
    }

    if (init.body && typeof init.body !== "string") {
      init.body = JSON.stringify(init.body);
    }

    const res = await fetch(url, init);
    captureCsrfToken(res);
    let payload = null;
    try { payload = await res.json(); } catch (_e) { payload = null; }
    if (res.status === 419 && isUnsafeMethod(init.method) && !init.__retriedCsrf) {
      await ensureCsrfToken(true);
      return apiRequest(path, Object.assign({}, options || {}, { __retriedCsrf: true }));
    }
    if (!res.ok || !payload || payload.success !== true) {
      const msg = payload && payload.message ? payload.message : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return payload.data;
  }

  function getSession() {
    // Prefer auth.js API, but fall back to raw storage in case a stale page/script
    // order issue prevents FoodieAuth from being available early enough.
    try {
      if (window.FoodieAuth && typeof window.FoodieAuth.getSession === "function") {
        const s = window.FoodieAuth.getSession();
        if (s && s.email) return s;
      }
    } catch (_e) { }

    const raw = safeParse(sessionStorage.getItem("foodiehub_auth_session_v3"), null)
      || safeParse(localStorage.getItem("foodiehub_auth_session_v3"), null);
    if (!raw || typeof raw !== "object") return null;
    if (!raw.email) return null;
    return raw;
  }

  async function waitForSession(maxMs) {
    const deadline = Date.now() + (Number(maxMs) || 1200);
    while (Date.now() < deadline) {
      const s = getSession();
      if (s) return s;
      await new Promise((r) => setTimeout(r, 80));
    }
    return getSession();
  }

  const State = {
    profile: null,
    addresses: []
  };

  function defaultSettings(settings) {
    const s = (settings && typeof settings === "object") ? settings : {};
    return {
      newsletter: s.newsletter !== false,
      smsUpdates: !!s.smsUpdates,
      orderAlerts: s.orderAlerts !== false
    };
  }

  async function loadProfileFromDb() {
    const data = await apiRequest("/users/profile", { method: "GET" });
    const settings = defaultSettings(data && data.settings);
    State.profile = Object.assign({}, data, { settings });
    return State.profile;
  }

  async function saveProfileToDb(next) {
    const payload = {
      name: String(next && next.name || "").trim(),
      email: normEmail(next && next.email || ""),
      phone: String(next && next.phone || "").trim(),
      age: Number.isFinite(next && next.age) ? next.age : null,
      settings: defaultSettings(next && next.settings)
    };
    const data = await apiRequest("/users/profile", { method: "PUT", body: payload });
    const settings = defaultSettings(data && data.settings);
    State.profile = Object.assign({}, data, { settings });
    return State.profile;
  }

  async function loadAddressesFromDb() {
    const list = await apiRequest("/users/addresses", { method: "GET" });
    State.addresses = Array.isArray(list) ? list : [];
    return State.addresses;
  }

  async function saveAddressesToDb(list) {
    const data = await apiRequest("/users/addresses", { method: "PUT", body: { addresses: list } });
    State.addresses = Array.isArray(data) ? data : [];
    return State.addresses;
  }

  function roleLabel(role) {
    if (role === "admin") return "Admin";
    if (role === "guest") return "Guest";
    return "User";
  }

  function init() {
    const form = byId("profileForm");
    if (!form) return;

    const status = byId("profileStatus");
    const roleBadge = byId("profileRoleBadge");
    const adminPanelLinkWrap = byId("adminPanelLinkWrap");

    const pName = byId("profileName");
    const pEmail = byId("profileEmail");
    const pPhone = byId("profilePhone");
    const pAge = byId("profileAge");
    const avatarPreview = byId("profileAvatarPreview");
    const pSettingNewsletter = byId("settingNewsletter");
    const pSettingSmsUpdates = byId("settingSmsUpdates");
    const pSettingOrderAlerts = byId("settingOrderAlerts");

    const addressForm = byId("addressForm");
    const addressList = byId("addressList");
    const clearAddressesBtn = byId("clearAddressesBtn");
    const profileResetBtn = byId("profileResetBtn");

    const aLabel = byId("addressLabel");
    const aLine = byId("addressLine");
    const aCity = byId("addressCity");
    const aZip = byId("addressZip");
    const aDefault = byId("addressDefault");

    function setStatus(text) { if (status) status.textContent = text; }

    function renderAvatar(profile) {
      if (!avatarPreview) return;
      const name = String(profile && profile.name || "").trim();
      const initials = (name || "User")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
      avatarPreview.textContent = initials || "U";
      avatarPreview.classList.remove("has-image");
      avatarPreview.innerHTML = esc(avatarPreview.textContent);
    }

    function renderProfile() {
      const profile = State.profile || {};
      if (pName) pName.value = profile.name || "";
      if (pEmail) pEmail.value = profile.email || "";
      if (pPhone) pPhone.value = profile.phone || "";
      if (pAge) pAge.value = Number.isFinite(profile.age) ? String(profile.age) : "";
      if (pSettingNewsletter) pSettingNewsletter.checked = profile.settings.newsletter !== false;
      if (pSettingSmsUpdates) pSettingSmsUpdates.checked = !!profile.settings.smsUpdates;
      if (pSettingOrderAlerts) pSettingOrderAlerts.checked = profile.settings.orderAlerts !== false;
      if (roleBadge) roleBadge.textContent = roleLabel(profile.role);
      if (adminPanelLinkWrap) adminPanelLinkWrap.classList.toggle("d-none", profile.role !== "admin");
      renderAvatar(profile);
    }

    function renderAddresses() {
      if (!addressList) return;
      const list = Array.isArray(State.addresses) ? State.addresses : [];
      if (!list.length) {
        addressList.innerHTML = "<div class='text-muted'>No saved addresses yet.</div>";
        return;
      }

      addressList.innerHTML = list.map((a) => `
        <article class="profile-address" data-addr-id="${esc(a.id)}">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
            <strong>${esc(a.label)} ${a.isDefault ? "<span class='badge text-bg-success ms-1'>Default</span>" : ""}</strong>
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-sm btn-outline-secondary" data-addr-default="${esc(a.id)}">Default</button>
              <button type="button" class="btn btn-sm btn-outline-danger" data-addr-remove="${esc(a.id)}">Remove</button>
            </div>
          </div>
          <div>${esc(a.line)}, ${esc(a.city)} ${esc(a.zip)}</div>
        </article>
      `).join("");
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const current = State.profile || {};
      const next = Object.assign({}, current, {
        name: String(pName && pName.value || "").trim(),
        email: normEmail(pEmail && pEmail.value || ""),
        phone: String(pPhone && pPhone.value || "").trim(),
        age: toInt(pAge && pAge.value || "", NaN),
        settings: {
          newsletter: !!(pSettingNewsletter && pSettingNewsletter.checked),
          smsUpdates: !!(pSettingSmsUpdates && pSettingSmsUpdates.checked),
          orderAlerts: !!(pSettingOrderAlerts && pSettingOrderAlerts.checked)
        }
      });

      if (!next.name || !next.email) {
        setStatus("Name and email are required.");
        window.alert("Name and email are required.");
        return;
      }

      setStatus("Saving...");
      saveProfileToDb(next).then(() => {
        setStatus("Profile saved.");
        renderProfile();
      }).catch((e) => {
        setStatus("Save failed.");
        window.alert(String(e && e.message || "Failed to save profile."));
      });
    });

    profileResetBtn && profileResetBtn.addEventListener("click", () => {
      renderProfile();
      setStatus("Form reset.");
    });

    pName && pName.addEventListener("input", () => {
      const profile = State.profile || {};
      renderAvatar({ name: (pName.value || profile.name || "") });
    });

    addressForm && addressForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const label = String(aLabel && aLabel.value || "").trim();
      const line = String(aLine && aLine.value || "").trim();
      const city = String(aCity && aCity.value || "").trim();
      const zip = String(aZip && aZip.value || "").trim();
      const makeDefault = !!(aDefault && aDefault.checked);
      if (!label || !line || !city || !zip) {
        window.alert("Fill all address fields.");
        return;
      }
      const list = Array.isArray(State.addresses) ? State.addresses.slice() : [];
      if (makeDefault) list.forEach((x) => { x.isDefault = false; });
      list.unshift({
        id: "",
        label,
        line,
        city,
        zip,
        isDefault: makeDefault || !list.length
      });
      setStatus("Saving address...");
      saveAddressesToDb(list.slice(0, 12)).then(() => {
        addressForm.reset();
        renderAddresses();
        setStatus("Address saved.");
      }).catch((e) => {
        setStatus("Save failed.");
        window.alert(String(e && e.message || "Failed to save address."));
      });
    });

    addressList && addressList.addEventListener("click", (event) => {
      const rm = event.target.closest("[data-addr-remove]");
      const def = event.target.closest("[data-addr-default]");
      if (!rm && !def) return;
      const id = rm ? rm.getAttribute("data-addr-remove") : def.getAttribute("data-addr-default");
      const list = Array.isArray(State.addresses) ? State.addresses.slice() : [];
      const idx = list.findIndex((a) => a.id === id);
      if (idx < 0) return;

      if (rm) {
        list.splice(idx, 1);
        if (list.length && !list.some((a) => a.isDefault)) list[0].isDefault = true;
        setStatus("Saving...");
        saveAddressesToDb(list).then(() => {
          renderAddresses();
          setStatus("Saved.");
        }).catch((e) => {
          setStatus("Save failed.");
          window.alert(String(e && e.message || "Failed to save address change."));
        });
        return;
      }

      list.forEach((a) => { a.isDefault = a.id === id; });
      setStatus("Saving...");
      saveAddressesToDb(list).then(() => {
        renderAddresses();
        setStatus("Saved.");
      }).catch((e) => {
        setStatus("Save failed.");
        window.alert(String(e && e.message || "Failed to save address change."));
      });
    });

    clearAddressesBtn && clearAddressesBtn.addEventListener("click", () => {
      setStatus("Saving...");
      saveAddressesToDb([]).then(() => {
        renderAddresses();
        setStatus("Saved.");
      }).catch((e) => {
        setStatus("Save failed.");
        window.alert(String(e && e.message || "Failed to clear addresses."));
      });
    });

    renderProfile();
    renderAddresses();
  }

  async function boot() {
    // Wait for auth.js to restore session (Google cookie flow).
    if (window.FoodieAuth && typeof window.FoodieAuth.detectBackend === "function") {
      const enabled = await window.FoodieAuth.detectBackend().catch(() => false);
      if (enabled) await waitForSession(3000);
    }

    const s = getSession();
    if (!s || s.role === "guest") {
      window.alert("Please login first to open profile.");
      window.location.href = loginPath();
      return;
    }

    try {
      await Promise.all([loadProfileFromDb(), loadAddressesFromDb()]);
    } catch (e) {
      // Fall back to session-only fields if DB is unavailable.
      State.profile = {
        id: String(s.id || ""),
        username: String(s.username || ""),
        name: String(s.name || "User"),
        email: String(s.email || ""),
        phone: String(s.phone || ""),
        role: String(s.role || "user"),
        age: null,
        settings: defaultSettings(null)
      };
      State.addresses = [];
      console.error("[FoodieHub] Failed to load profile from backend", e);
    }

    init();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
