(function () {
  "use strict";

  const Keys = {
    CART: "foodiehub_cart_v1",
    SAVED_FOR_LATER: "foodiehub_saved_for_later_v1",
    PREFS: "foodiehub_cart_prefs_v1",
    CART_NOTE: "foodiehub_cart_note_v1",
    CART_SAVED_AT: "foodiehub_cart_saved_at_v1",
    CHECKOUT_DRAFT: "foodiehub_checkout_draft_v1",
    CONTACT_DRAFT: "foodiehub_contact_draft_v1",
    ORDER_HISTORY: "foodiehub_order_history_v1",
    PROFILE: "foodiehub_profile_v1",
    ADDRESSES: "foodiehub_addresses_v1",
    FAVORITES: "foodiehub_favorites_v1",
    CSRF: "foodiehub_csrf_token_v1"
  };

  const Coupons = {
    SAVE10: { type: "percent", value: 10, minSubtotal: 20, maxDiscount: 8, label: "\u20B98 off" },
    WELCOME5: { type: "flat", value: 5, minSubtotal: 25, label: "\u20B95 off" },
    FREEDLV: { type: "delivery", value: 0, minSubtotal: 18, label: "Free delivery" }
  };

  const DefaultPrefs = { couponCode: "", deliveryType: "standard", tipChoice: "0" };
  const OrderStatuses = ["Placed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];
  const BackendState = { checked: false, enabled: false };
  let RazorpayScriptPromise = null;

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

  function frontendBasePath() {
    const prefix = resolveProjectPrefix().replace(/\/+$/, "");
    return `${prefix}/frontend`;
  }

  function readCsrfToken() { return String(sessionStorage.getItem(Keys.CSRF) || "").trim(); }
  function writeCsrfToken(token) { const value = String(token || "").trim(); if (value) sessionStorage.setItem(Keys.CSRF, value); }
  function captureCsrfToken(response) { if (response && response.headers) writeCsrfToken(response.headers.get("X-CSRF-Token") || ""); }
  function isUnsafeMethod(method) { const value = String(method || "GET").toUpperCase(); return value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE"; }
  async function ensureCsrfToken(forceRefresh) {
    if (!forceRefresh) {
      const existing = readCsrfToken();
      if (existing) return existing;
    }
    const response = await fetch(`${apiBaseUrl()}/health`, { method: "GET", credentials: "include" });
    captureCsrfToken(response);
    return readCsrfToken();
  }

  async function apiRequest(path, options) {
    const target = `${apiBaseUrl()}${String(path || "").startsWith("/") ? "" : "/"}${String(path || "")}`;
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

    const response = await fetch(target, init);
    captureCsrfToken(response);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }
    if (response.status === 419 && isUnsafeMethod(init.method) && !init.__retriedCsrf) {
      await ensureCsrfToken(true);
      return apiRequest(path, Object.assign({}, options || {}, { __retriedCsrf: true }));
    }
    if (!response.ok) {
      const message = payload && payload.message ? payload.message : `Request failed (${response.status})`;
      throw new Error(message);
    }
    return payload || {};
  }

  async function detectBackend() {
    if (BackendState.checked) return BackendState.enabled;
    BackendState.checked = true;
    try {
      const response = await apiRequest("/health", { method: "GET" });
      BackendState.enabled = !!(response && response.success);
    } catch (_error) {
      BackendState.enabled = false;
    }
    return BackendState.enabled;
  }

  function byId(id) { return document.getElementById(id); }
  function qsa(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function qs(s, r) { return (r || document).querySelector(s); }
  function safeParse(raw, fallback) { try { return JSON.parse(raw); } catch (_e) { return fallback; } }
  function toNum(v, f) { const n = Number(v); return Number.isFinite(n) ? n : f; }
  function toInt(v, f) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : f; }
  function normEmail(v) { return String(v || "").trim().toLowerCase(); }
  function money(v) { return `\u20B9${(Number(v) || 0).toFixed(2)}`; }
  function esc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
  function slug(v) { return String(v || "item").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
  function imgSrc(v) {
    const raw = String(v || "").trim().replace(/\\/g, "/");
    const base = frontendBasePath();
    const fallback = `${base}/assets/Main/logo.webp`;
    if (!raw) return fallback;
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:")) return raw;

    if (raw.startsWith("/")) {
      if (/^\/assets\//i.test(raw)) return `${base}${raw}`;
      if (/^\/backend\//i.test(raw)) {
        const prefix = resolveProjectPrefix().replace(/\/+$/, "");
        return prefix ? `${prefix}${raw}` : raw;
      }
      return raw;
    }

    const lower = raw.toLowerCase();
    const frontendMarker = "/frontend/assets/";
    const frontendAt = lower.lastIndexOf(frontendMarker);
    if (frontendAt >= 0) {
      return raw.slice(frontendAt);
    }

    const assetsMarker = "assets/";
    const assetsAt = lower.lastIndexOf(assetsMarker);
    if (assetsAt >= 0) {
      return `${base}/${raw.slice(assetsAt).replace(/^\/+/, "")}`;
    }

    try {
      const resolved = new URL(raw, window.location.href);
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch (_error) {
      return fallback;
    }
  }

  function normalizeMenuCategory(raw) {
    const value = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!value) return "meal";

    if (value === "nonveg" || value === "non-veg" || value === "non veg") return "nonveg";
    if (value === "veg" || value === "vegetarian") return "veg";
    if (value === "dessert" || value === "desserts" || value === "sweet" || value === "sweets") return "dessert";
    if (value === "meal" || value === "meals") return "meal";
    if (value === "premium") return "premium";
    if (value === "quick") return "quick";

    if (value.includes("nonveg") || value.includes("non-veg") || value.includes("non veg")) return "nonveg";
    if (value.includes("dessert") || value.includes("sweet")) return "dessert";
    if (value.includes("meal")) return "meal";
    if (value.includes("vegetarian")) return "veg";
    if (value.includes("veg")) return "veg";
    if (value.includes("premium")) return "premium";
    if (value.includes("quick")) return "quick";

    return value;
  }

  function initImageFormatFallbacks() {
    const fallbackOrder = [".webp", ".jpg", ".jpeg", ".png", ".avif"];
    qsa("img[src]").forEach((img) => {
      if (img.getAttribute("data-img-fallback-bound") === "1") return;
      img.setAttribute("data-img-fallback-bound", "1");

      img.addEventListener("error", () => {
        const current = String(img.getAttribute("src") || "").trim();
        if (!current || /^(https?:)?\/\//i.test(current)) return;

        const parts = current.match(/^(.*?)(\.[a-z0-9]+)([?#].*)?$/i);
        if (!parts) return;

        const base = parts[1];
        const ext = String(parts[2] || "").toLowerCase();
        const suffix = parts[3] || "";
        const extIndex = fallbackOrder.indexOf(ext);
        if (extIndex < 0) return;

        const tried = String(img.getAttribute("data-img-fallback-tried") || "")
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean);
        if (!tried.includes(ext)) tried.push(ext);

        for (let i = extIndex + 1; i < fallbackOrder.length; i += 1) {
          const nextExt = fallbackOrder[i];
          if (tried.includes(nextExt)) continue;
          tried.push(nextExt);
          img.setAttribute("data-img-fallback-tried", tried.join(","));
          img.setAttribute("src", `${base}${nextExt}${suffix}`);
          return;
        }
      }, { passive: true });
    });
  }

  function getAuthSession() {
    if (!window.FoodieAuth || typeof window.FoodieAuth.getSession !== "function") return null;
    const s = window.FoodieAuth.getSession();
    return (s && s.email) ? s : null;
  }

  async function restoreSessionFromBackendIfNeeded() {
    // auth.js already knows how to restore a cookie-based server session.
    // Here we only wait a moment for that async restore to complete.
    try {
      if (getAuthSession()) return;
      if (!window.FoodieAuth || typeof window.FoodieAuth.detectBackend !== "function") return;

      const backendEnabled = await window.FoodieAuth.detectBackend().catch(() => false);
      if (!backendEnabled) return;

      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        if (getAuthSession()) return;
        await new Promise((r) => setTimeout(r, 80));
      }
    } catch (_e) { }
  }

  function isLoggedIn() {
    return !!getAuthSession();
  }

  function loginPath() {
    const path = (window.location.pathname || "").toLowerCase();
    if (path.includes("/pages/category/")) return "../../Account/form.html";
    if (path.includes("/pages/")) return "../Account/form.html";
    if (path.includes("/account/")) return "./form.html";
    return "Account/form.html";
  }

  function profilePath() {
    const path = (window.location.pathname || "").toLowerCase();
    if (path.includes("/pages/category/")) return "../profile.html";
    if (path.includes("/pages/")) return "./profile.html";
    if (path.includes("/account/")) return "../pages/profile.html";
    return "pages/profile.html";
  }

  function adminPanelPath() {
    const path = (window.location.pathname || "").toLowerCase();
    if (path.includes("/pages/category/")) return "../../Account/admin-panel.html";
    if (path.includes("/pages/")) return "../Account/admin-panel.html";
    if (path.includes("/account/")) return "./admin-panel.html";
    return "Account/admin-panel.html";
  }

  function authRoleLabel(role) {
    if (role === "admin") return "Admin";
    if (role === "guest") return "Guest";
    return "User";
  }

  function normalizeOrderStatus(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (raw === "placed") return "Placed";
    if (raw === "preparing") return "Preparing";
    if (raw === "out for delivery") return "Out for Delivery";
    if (raw === "delivered") return "Delivered";
    if (raw === "cancelled" || raw === "canceled") return "Cancelled";
    return "Placed";
  }

  function logoutRedirectPath(role) {
    const base = loginPath();
    if (role === "admin") return `${base}?mode=admin`;
    return `${base}?mode=user`;
  }

  function logoutCurrentSession() {
    const session = getAuthSession();
    const role = session?.role === "admin" ? "admin" : session?.role === "guest" ? "guest" : "user";

    if (window.FoodieAuth && typeof window.FoodieAuth.logout === "function") {
      window.FoodieAuth.logout(logoutRedirectPath(role));
      return;
    }
  }

  function notify(message, type) {
    const msg = String(message || "").trim();
    if (!msg) return;
    if (window.FoodieUI && typeof window.FoodieUI.toast === "function") {
      window.FoodieUI.toast(msg, type || "info");
      return;
    }
    window.alert(msg);
  }

  function getStorageScope() {
    const session = getAuthSession();
    if (!session || !session.email) return "";
    const role = session.role === "admin" ? "admin" : session.role === "guest" ? "guest" : "user";
    const email = normEmail(session.email || "");
    if (!email) return "";
    return slug(`${role}-${email}`);
  }

  function scopedKey(baseKey) {
    const key = String(baseKey || "").trim();
    if (!key) return key;
    const scope = getStorageScope();
    return scope ? `${key}__${scope}` : key;
  }

  function readScopedJson(baseKey, fallback) {
    const key = scopedKey(baseKey);
    const scopedRaw = sessionStorage.getItem(key);
    if (scopedRaw !== null) return safeParse(scopedRaw, fallback);

    // Legacy fallback: older versions stored unscoped keys. If we have a scoped key
    // now, migrate the legacy value into the scoped slot so cart/checkout stays in sync.
    const legacyKey = String(baseKey || "");
    if (legacyKey && legacyKey !== key) {
      const legacyRaw = sessionStorage.getItem(legacyKey);
      if (legacyRaw !== null) {
        const parsed = safeParse(legacyRaw, fallback);
        try {
          sessionStorage.setItem(key, JSON.stringify(parsed));
          sessionStorage.removeItem(legacyKey);
        } catch (_e) { }
        return parsed;
      }
    }
    return fallback;
  }

  function writeScopedJson(baseKey, value) {
    sessionStorage.setItem(scopedKey(baseKey), JSON.stringify(value));
  }

  function readScopedText(baseKey, fallback) {
    const key = scopedKey(baseKey);
    const scopedRaw = sessionStorage.getItem(key);
    if (scopedRaw !== null) return scopedRaw;

    const legacyKey = String(baseKey || "");
    if (legacyKey && legacyKey !== key) {
      const legacyRaw = sessionStorage.getItem(legacyKey);
      if (legacyRaw !== null) {
        try {
          sessionStorage.setItem(key, legacyRaw);
          sessionStorage.removeItem(legacyKey);
        } catch (_e) { }
        return legacyRaw;
      }
    }
    return typeof fallback === "string" ? fallback : "";
  }

  function writeScopedText(baseKey, value) {
    sessionStorage.setItem(scopedKey(baseKey), String(value ?? ""));
  }

  function removeScoped(baseKey) {
    sessionStorage.removeItem(scopedKey(baseKey));
  }

  function normalizeAddress(raw, index) {
    const x = raw || {};
    return {
      id: String(x.id || `addr-${Date.now()}-${index || 0}`).trim(),
      label: String(x.label || "Address").trim(),
      line: String(x.line || "").trim(),
      city: String(x.city || "").trim(),
      zip: String(x.zip || "").trim(),
      isDefault: !!x.isDefault
    };
  }

  function readProfile() {
    const session = getAuthSession();
    const stored = readScopedJson(Keys.PROFILE, {});
    const role = session?.role === "admin" ? "admin" : session?.role === "guest" ? "guest" : "user";
    const settings = stored && typeof stored.settings === "object" ? stored.settings : {};
    return {
      id: String((stored && stored.id) || (session && session.id) || "").trim(),
      role,
      name: String((stored && stored.name) || (session && session.name) || "").trim(),
      email: normEmail((stored && stored.email) || (session && session.email) || ""),
      phone: String((stored && stored.phone) || (session && session.phone) || "").trim(),
      age: toInt((stored && stored.age) || "", NaN),
      avatar: String((stored && stored.avatar) || "").trim(),
      settings: {
        newsletter: settings.newsletter !== false,
        smsUpdates: !!settings.smsUpdates,
        orderAlerts: settings.orderAlerts !== false
      }
    };
  }

  function writeProfile(profile) {
    const current = readProfile();
    const incoming = profile || {};
    const merged = {
      id: String((incoming && incoming.id) || current.id || "").trim(),
      role: incoming && incoming.role ? incoming.role : current.role,
      name: String((incoming && incoming.name) || current.name || "").trim(),
      email: normEmail((incoming && incoming.email) || current.email || ""),
      phone: String((incoming && incoming.phone) || current.phone || "").trim(),
      age: toInt((incoming && incoming.age) || current.age, NaN),
      avatar: String((incoming && incoming.avatar) || current.avatar || "").trim(),
      settings: {
        newsletter: (incoming && incoming.settings && typeof incoming.settings.newsletter === "boolean")
          ? incoming.settings.newsletter
          : current.settings.newsletter,
        smsUpdates: (incoming && incoming.settings && typeof incoming.settings.smsUpdates === "boolean")
          ? incoming.settings.smsUpdates
          : current.settings.smsUpdates,
        orderAlerts: (incoming && incoming.settings && typeof incoming.settings.orderAlerts === "boolean")
          ? incoming.settings.orderAlerts
          : current.settings.orderAlerts
      }
    };
    writeScopedJson(Keys.PROFILE, merged);
    return readProfile();
  }

  function readAddresses() {
    const list = readScopedJson(Keys.ADDRESSES, []);
    if (!Array.isArray(list)) return [];
    const addresses = list.map(normalizeAddress).filter((a) => a.line);
    if (!addresses.length) return [];
    if (!addresses.some((a) => a.isDefault)) addresses[0].isDefault = true;
    return addresses;
  }

  function writeAddresses(list) {
    const addresses = Array.isArray(list) ? list.map(normalizeAddress).filter((a) => a.line) : [];
    if (addresses.length && !addresses.some((a) => a.isDefault)) addresses[0].isDefault = true;
    writeScopedJson(Keys.ADDRESSES, addresses);
    return readAddresses();
  }

  async function syncProfileFromBackend() {
    const session = getAuthSession();
    if (!session || session.role === "guest") return false;
    const enabled = await detectBackend().catch(() => false);
    if (!enabled) return false;

    try {
      const profileRes = await apiRequest("/users/profile", { method: "GET" });
      if (profileRes && profileRes.success && profileRes.data) {
        writeProfile(profileRes.data);
      }

      const addrRes = await apiRequest("/users/addresses", { method: "GET" });
      if (addrRes && addrRes.success && Array.isArray(addrRes.data)) {
        writeAddresses(addrRes.data);
      }

      return true;
    } catch (_e) {
      return false;
    }
  }

  function readFavorites() {
    const list = readScopedJson(Keys.FAVORITES, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeItem).filter((i) => i.id);
  }

  function writeFavorites(list) {
    const favorites = Array.isArray(list) ? list.map(normalizeItem).filter((i) => i.id) : [];
    writeScopedJson(Keys.FAVORITES, favorites);
    return readFavorites();
  }

  function isFavorite(id) {
    return readFavorites().some((item) => item.id === id);
  }

  function toggleFavorite(item) {
    const incoming = normalizeItem(item);
    if (!incoming.id) return { active: false };
    const favorites = readFavorites();
    const idx = favorites.findIndex((x) => x.id === incoming.id);
    if (idx >= 0) {
      favorites.splice(idx, 1);
      writeFavorites(favorites);
      return { active: false };
    }
    favorites.unshift(incoming);
    writeFavorites(favorites.slice(0, 80));
    return { active: true };
  }

  function updateAuthBadge() {
    qsa("[data-auth-badge-auto]").forEach((el) => el.remove());
    const session = getAuthSession();
    if (!session) return;

    const roleLabel = authRoleLabel(session.role);
    const name = String(session.name || "User").trim() || "User";
    const badgeText = `${roleLabel}: ${name}`;

    qsa(".navbar .navbar-nav").forEach((list) => {
      const badgeItem = document.createElement("li");
      badgeItem.className = "nav-item d-flex align-items-center";
      badgeItem.setAttribute("data-auth-badge-auto", "1");
      badgeItem.innerHTML = `<span class="badge rounded-pill text-bg-warning ms-lg-2 mt-2 mt-lg-0">${esc(badgeText)}</span>`;
      list.appendChild(badgeItem);

      const logoutItem = document.createElement("li");
      logoutItem.className = "nav-item d-flex align-items-center";
      logoutItem.setAttribute("data-auth-badge-auto", "1");
      logoutItem.innerHTML = `<button type="button" class="btn btn-outline-light btn-sm ms-lg-2 mt-2 mt-lg-0" data-auth-logout>Logout</button>`;
      list.appendChild(logoutItem);
    });
  }

  function updateProfileNavLink() {
    qsa("[data-nav-profile-auto]").forEach((el) => el.remove());
    const session = getAuthSession();
    if (!session || session.role === "guest") return;
    const href = profilePath();

    qsa(".navbar .navbar-nav").forEach((list) => {
      if (list.querySelector('[href$="profile.html"], [href*="/profile.html"]')) return;
      const item = document.createElement("li");
      item.className = "nav-item";
      item.setAttribute("data-nav-profile-auto", "1");
      item.innerHTML = `<a class="nav-link" href="${esc(href)}">Profile</a>`;
      const beforeNode = list.querySelector("[data-auth-badge-auto]") || null;
      if (beforeNode) list.insertBefore(item, beforeNode);
      else list.appendChild(item);
    });
  }

  function updateSignInNavLink() {
    qsa("[data-nav-signin-auto]").forEach((el) => el.remove());
    const session = getAuthSession();
    if (session) return;
    const href = loginPath();

    qsa(".navbar .navbar-nav").forEach((list) => {
      const hasExisting = !!list.querySelector('[href$="form.html"], [href*="/form.html"], [href*="Account/form.html"], [href*="../Account/form.html"]');
      if (hasExisting) return;
      const item = document.createElement("li");
      item.className = "nav-item";
      item.setAttribute("data-nav-signin-auto", "1");
      item.innerHTML = `<a class="nav-link" href="${esc(href)}">Sign In</a>`;
      list.appendChild(item);
    });
  }

  function requireLogin(actionText) {
    if (isLoggedIn()) return true;
    window.alert(actionText || "Please login first.");
    window.location.href = loginPath();
    return false;
  }

  function normalizeItem(item) {
    const x = item || {};
    return {
      id: String(x.id || "").trim(),
      name: String(x.name || "Item").trim(),
      price: Math.max(0, toNum(x.price, 0)),
      image: String(x.image || "").trim(),
      category: String(x.category || "meal").trim(),
      prepMin: Math.max(5, toInt(x.prepMin, 18)),
      quantity: Math.max(1, toInt(x.quantity, 1))
    };
  }

  function readCart() {
    const list = readScopedJson(Keys.CART, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeItem).filter((i) => i.id && Number.isFinite(i.price));
  }

  function writeCart(cart) { writeScopedJson(Keys.CART, cart); }

  function readSavedForLater() {
    const list = readScopedJson(Keys.SAVED_FOR_LATER, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeItem).filter((i) => i.id && Number.isFinite(i.price));
  }

  function writeSavedForLater(items) {
    const list = Array.isArray(items) ? items.map(normalizeItem).filter((i) => i.id && Number.isFinite(i.price)) : [];
    writeScopedJson(Keys.SAVED_FOR_LATER, list);
    return readSavedForLater();
  }

  function saveForLater(id) {
    const itemId = String(id || "").trim();
    if (!itemId) return { ok: false };
    const cart = readCart();
    const idx = cart.findIndex((i) => i.id === itemId);
    if (idx < 0) return { ok: false };
    const item = cart[idx];
    cart.splice(idx, 1);
    writeCart(cart);
    const saved = readSavedForLater();
    const exists = saved.findIndex((i) => i.id === item.id);
    if (exists >= 0) saved.splice(exists, 1);
    saved.unshift(item);
    writeSavedForLater(saved.slice(0, 80));
    return { ok: true, item };
  }

  function moveSavedToCart(id) {
    const itemId = String(id || "").trim();
    if (!itemId) return { ok: false };
    const saved = readSavedForLater();
    const idx = saved.findIndex((i) => i.id === itemId);
    if (idx < 0) return { ok: false };
    const item = saved[idx];
    saved.splice(idx, 1);
    writeSavedForLater(saved);
    addItem(item, item.quantity || 1);
    return { ok: true, item };
  }

  function removeSavedForLater(id) {
    const itemId = String(id || "").trim();
    if (!itemId) return readSavedForLater();
    const next = readSavedForLater().filter((i) => i.id !== itemId);
    return writeSavedForLater(next);
  }

  function readPrefs() {
    const p = readScopedJson(Keys.PREFS, DefaultPrefs);
    return {
      couponCode: String((p && p.couponCode) || "").trim().toUpperCase(),
      deliveryType: p && p.deliveryType === "priority" ? "priority" : "standard",
      tipChoice: String((p && p.tipChoice) || "0")
    };
  }

  function writePrefs(next) {
    const merged = Object.assign({}, readPrefs(), next || {});
    writeScopedJson(Keys.PREFS, merged);
    return merged;
  }

  function cartCount(cart) { return cart.reduce((t, i) => t + i.quantity, 0); }
  function subTotal(cart) { return cart.reduce((t, i) => t + i.price * i.quantity, 0); }

  function normalizeOrder(order) {
    const x = order || {};
    const items = Array.isArray(x.items) ? x.items.map(normalizeItem).filter((i) => i.id && Number.isFinite(i.price)) : [];
    const created = Date.parse(String(x.createdAt || ""));
    const createdAt = Number.isFinite(created) ? new Date(created).toISOString() : new Date().toISOString();
    const fallbackSubtotal = subTotal(items);
    const fallbackItemCount = cartCount(items);
    const fallbackDiscount = Math.max(0, toNum(x.discount, 0));
    const fallbackTax = Math.max(0, toNum(x.tax, 0));
    const fallbackDelivery = Math.max(0, toNum(x.deliveryFee, 0));
    const fallbackTip = Math.max(0, toNum(x.tip, 0));
    const fallbackTotal = Math.max(0, fallbackSubtotal - fallbackDiscount + fallbackTax + fallbackDelivery + fallbackTip);
    return {
      id: String(x.id || `FH-${Math.floor(100000 + Math.random() * 900000)}`).trim(),
      createdAt,
      status: normalizeOrderStatus(x.status),
      payment: String(x.payment || "Card").trim() || "Card",
      ownerId: String(x.ownerId || x.userId || "").trim(),
      ownerEmail: normEmail(x.ownerEmail || x.userEmail || x.email || ""),
      ownerRole: x.ownerRole === "admin" ? "admin" : x.ownerRole === "guest" ? "guest" : "user",
      itemCount: Math.max(0, toInt(x.itemCount, fallbackItemCount)),
      subtotal: Math.max(0, toNum(x.subtotal, fallbackSubtotal)),
      discount: fallbackDiscount,
      tax: fallbackTax,
      deliveryFee: fallbackDelivery,
      tip: fallbackTip,
      total: Math.max(0, toNum(x.total, fallbackTotal)),
      items
    };
  }

  function readAllOrders() {
    const list = safeParse(sessionStorage.getItem(Keys.ORDER_HISTORY), []);
    if (!Array.isArray(list)) return [];
    return list
      .map(normalizeOrder)
      .filter((o) => o.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  function readOrders() {
    const session = getAuthSession();
    if (!session || session.role === "guest") return [];
    const all = readAllOrders();
    if (session.role === "admin") return all;

    const sid = String(session.id || "").trim();
    const email = normEmail(session.email || "");
    return all.filter((o) => (sid && o.ownerId === sid) || (email && o.ownerEmail === email));
  }

  function writeOrders(orders) {
    sessionStorage.setItem(Keys.ORDER_HISTORY, JSON.stringify(Array.isArray(orders) ? orders : []));
  }

  function backendOrderToClient(row) {
    const backendId = toInt(row && row.id, 0);
    const createdAt = String((row && (row.created_at || row.createdAt)) || new Date().toISOString());
    return normalizeOrder({
      id: backendId > 0 ? `FH-${String(backendId).padStart(6, "0")}` : "",
      createdAt,
      status: row && row.status ? row.status : "Placed",
      payment: row && (row.payment_method || row.payment) ? (row.payment_method || row.payment) : "Cash on Delivery",
      userId: row && row.user_id ? String(row.user_id) : "",
      fullName: row && row.full_name ? row.full_name : "",
      subtotal: toNum(row && row.subtotal, 0),
      discount: toNum(row && row.discount, 0),
      deliveryFee: toNum(row && row.delivery_fee, 0),
      tax: 0,
      tip: 0,
      total: toNum(row && row.total, 0),
      items: Array.isArray(row && row.items) ? row.items : []
    });
  }

  async function syncOrdersFromBackend() {
    const backendMode = await detectBackend();
    if (!backendMode) {
      writeOrders([]);
      return [];
    }
    const session = getAuthSession();
    if (!session || session.role === "guest") {
      writeOrders([]);
      return [];
    }

    try {
      const response = await apiRequest("/orders/list", { method: "POST", body: {} });
      const rows = Array.isArray(response && response.data) ? response.data : [];
      const mapped = rows.map(backendOrderToClient).filter((order) => order.id);

      const scoped = session.role === "admin"
        ? mapped
        : mapped.filter((order) => String(order.ownerId || "") === String(session.id || ""));

      writeOrders(scoped.slice(0, 100));
      return readOrders();
    } catch (_error) {
      return [];
    }
  }

  async function addOrder(order) {
    const backendMode = await detectBackend();
    if (!backendMode) {
      return { ok: false, message: "Backend is required to place orders." };
    }
    const all = readAllOrders();
    const session = getAuthSession();
    if (!session || session.role === "guest") {
      return { ok: false, message: "Login required to place orders." };
    }
    const fallbackRole = session?.role === "admin" ? "admin" : session?.role === "guest" ? "guest" : "user";
    const incoming = normalizeOrder(Object.assign({}, order || {}, {
      ownerId: String((order && order.ownerId) || (session && session.id) || "").trim(),
      ownerEmail: normEmail((order && order.ownerEmail) || (session && session.email) || ""),
      ownerRole: (order && order.ownerRole) || fallbackRole
    }));

    const payload = {
      user_id: incoming.ownerId ? toInt(incoming.ownerId, 0) : null,
      full_name: String((order && order.fullName) || (session && session.name) || "").trim(),
      phone: String((order && order.phone) || (session && session.phone) || "").trim(),
      address: String((order && order.address) || "").trim(),
      city: String((order && order.city) || "").trim(),
      zip: String((order && order.zip) || "").trim(),
      payment_method: incoming.payment,
      status: incoming.status,
      subtotal: incoming.subtotal,
      delivery_fee: incoming.deliveryFee,
      discount: incoming.discount,
      total: incoming.total,
      notes: String((order && order.notes) || "").trim(),
      items: incoming.items,
      payment_gateway: String((order && order.paymentGateway) || "").trim(),
      razorpay_order_id: String((order && order.razorpayOrderId) || "").trim(),
      razorpay_payment_id: String((order && order.razorpayPaymentId) || "").trim(),
      razorpay_signature: String((order && order.razorpaySignature) || "").trim()
    };

    try {
      const response = await apiRequest("/orders", { method: "POST", body: payload });
      if (response && response.success && response.data) {
        const created = backendOrderToClient(response.data);
        all.unshift(created);
        writeOrders(all.slice(0, 100));
        return { ok: true, order: created };
      }
      if (response && response.success === false) {
        return { ok: false, message: response.message || "Failed to place order." };
      }
    } catch (_error) {
      return { ok: false, message: (_error && _error.message) ? _error.message : "Order creation failed on backend." };
    }

    return { ok: false, message: "Order creation failed on backend." };
  }

  function updateOrderStatus(orderId, status) {
    const id = String(orderId || "").trim();
    const nextStatus = normalizeOrderStatus(status);
    if (!id || !nextStatus) return null;
    const all = readAllOrders();
    const idx = all.findIndex((o) => o.id === id);
    if (idx < 0) return null;
    all[idx] = normalizeOrder(Object.assign({}, all[idx], { status: nextStatus }));
    writeOrders(all);
    return all[idx];
  }

  function autoAdvanceOrderStatuses() {
    const all = readAllOrders();
    if (!all.length) return [];
    const now = Date.now();
    let changed = false;

    const next = all.map((order) => {
      const currentStatus = normalizeOrderStatus(order.status);
      if (currentStatus === "Delivered" || currentStatus === "Cancelled") return order;

      const createdMs = Date.parse(String(order.createdAt || ""));
      if (!Number.isFinite(createdMs)) return order;

      const elapsedSec = Math.max(0, Math.floor((now - createdMs) / 1000));
      const stage = Math.floor(elapsedSec / 15);
      const targetStatus = stage <= 0
        ? "Placed"
        : stage === 1
          ? "Preparing"
          : stage === 2
            ? "Out for Delivery"
            : "Delivered";

      if (currentStatus === targetStatus) return order;
      changed = true;
      return normalizeOrder(Object.assign({}, order, { status: targetStatus }));
    });

    if (changed) writeOrders(next);
    return readOrders();
  }

  function parseTip(choice, base) {
    if (!choice || choice === "0") return 0;
    if (choice.endsWith("p")) return (base * (toNum(choice.replace("p", ""), 0))) / 100;
    return toNum(choice, 0);
  }

  function applyDiscount(subtotalValue, couponCode, deliveryFee) {
    const code = String(couponCode || "").trim().toUpperCase();
    const coupon = Coupons[code];
    if (!code || !coupon) {
      return { code, label: "", discount: 0, deliveryDiscount: 0, applied: false, message: code ? "Invalid coupon code" : "" };
    }
    if (subtotalValue < coupon.minSubtotal) {
      return { code, label: coupon.label, discount: 0, deliveryDiscount: 0, applied: false, message: `Minimum order is ${money(coupon.minSubtotal)}` };
    }
    if (coupon.type === "flat") {
      return { code, label: coupon.label, discount: Math.min(coupon.value, subtotalValue), deliveryDiscount: 0, applied: true, message: `${coupon.label} applied` };
    }
    if (coupon.type === "percent") {
      let v = (subtotalValue * coupon.value) / 100;
      if (coupon.maxDiscount) v = Math.min(v, coupon.maxDiscount);
      return { code, label: coupon.label, discount: v, deliveryDiscount: 0, applied: true, message: `${coupon.label} applied` };
    }
    if (coupon.type === "delivery") {
      return { code, label: coupon.label, discount: 0, deliveryDiscount: deliveryFee, applied: true, message: `${coupon.label} applied` };
    }
    return { code, label: "", discount: 0, deliveryDiscount: 0, applied: false, message: "" };
  }

  function calculateSummary(options) {
    const cart = readCart();
    const prefs = Object.assign({}, readPrefs(), options || {});
    const subtotal = subTotal(cart);
    const baseDelivery = prefs.deliveryType === "priority" ? 5.99 : 2.99;
    const freeDeliveryByAmount = subtotal >= 45;
    const deliveryBeforeCoupon = freeDeliveryByAmount ? 0 : baseDelivery;

    const discountInfo = applyDiscount(subtotal, prefs.couponCode, deliveryBeforeCoupon);
    const discount = discountInfo.discount;
    const deliveryFee = Math.max(0, deliveryBeforeCoupon - discountInfo.deliveryDiscount);

    const taxableAmount = Math.max(0, subtotal - discount);
    const tax = taxableAmount * 0.08;
    const preTip = taxableAmount + tax + deliveryFee;
    const tip = parseTip(prefs.tipChoice, preTip);
    const total = Math.max(0, taxableAmount + tax + deliveryFee + tip);

    const itemCount = cartCount(cart);
    const prepMinutes = cart.length ? Math.max(12, Math.round(cart.reduce((s, i) => s + i.prepMin * i.quantity, 0) / Math.max(1, itemCount))) : 0;

    return {
      cart,
      itemCount,
      subtotal,
      discount,
      tax,
      deliveryFee,
      tip,
      total,
      prepMinutes,
      prefs,
      coupon: discountInfo,
      freeDeliveryByAmount
    };
  }

  function addItem(item, quantity) {
    const qty = Math.max(1, toInt(quantity, 1));
    const cart = readCart();
    const incoming = normalizeItem(Object.assign({}, item, { quantity: qty }));
    if (!incoming.id) return cart;
    const existing = cart.find((e) => e.id === incoming.id);
    if (existing) existing.quantity += qty;
    else cart.push(incoming);
    writeCart(cart);
    return cart;
  }

  function updateQuantity(id, quantity) {
    const cart = readCart();
    const idx = cart.findIndex((x) => x.id === id);
    if (idx === -1) return cart;
    const q = toInt(quantity, 0);
    if (q <= 0) cart.splice(idx, 1);
    else cart[idx].quantity = q;
    writeCart(cart);
    return cart;
  }

  function removeItem(id) { return updateQuantity(id, 0); }
  function clearCart() { writeCart([]); return []; }
  function setPrefs(next) { return writePrefs(next); }
  function getPrefs() { return readPrefs(); }

  window.FoodieCart = {
    coupons: Coupons,
    readCart,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    readSavedForLater,
    writeSavedForLater,
    saveForLater,
    moveSavedToCart,
    removeSavedForLater,
    calculateSummary,
    setPrefs,
    getPrefs,
    readOrders,
    syncOrders: syncOrdersFromBackend,
    addOrder,
    updateOrderStatus,
    autoAdvanceOrderStatuses,
    readProfile,
    writeProfile,
    readAddresses,
    writeAddresses,
    readFavorites,
    isFavorite,
    toggleFavorite,
    formatMoney: money,
    slugify: slug
  };

  function updateNavCount() {
    const summary = window.FoodieCart.calculateSummary(window.FoodieCart.getPrefs());
    qsa("#navCartCount").forEach((el) => { el.textContent = String(summary.itemCount); });
  }

  function mountFavoriteButton(card, itemFactory) {
    if (!card || typeof itemFactory !== "function") return;
    card.style.position = card.style.position || "relative";
    let btn = card.querySelector("[data-fav-btn]");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fav-btn";
      btn.setAttribute("data-fav-btn", "1");
      btn.setAttribute("aria-label", "Add to favorites");
      btn.innerHTML = '<i class="bi bi-heart"></i>';
      card.appendChild(btn);
    }

    function refresh() {
      const item = itemFactory();
      const active = !!(item && item.id && window.FoodieCart.isFavorite(item.id));
      btn.classList.toggle("active", active);
      btn.innerHTML = active ? '<i class="bi bi-heart-fill"></i>' : '<i class="bi bi-heart"></i>';
      btn.setAttribute("aria-label", active ? "Remove from favorites" : "Add to favorites");
    }

    btn.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      const item = itemFactory();
      const result = window.FoodieCart.toggleFavorite(item);
      notify(result.active ? `${item.name} added to favorites` : `${item.name} removed from favorites`, "info");
      refresh();
    };

    refresh();
  }

  async function initMenu() {
    const grid = byId("menuItems");
    if (!grid) return;

    function getPrep(card) {
      const t = card?.querySelector(".menu-meta")?.textContent || "";
      const m = t.match(/(\d+)\s*-\s*(\d+)/);
      return m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : 20;
    }

    function buildItem(root) {
      const card = root.querySelector(".card");
      const name = root.dataset.name || card?.querySelector(".card-title")?.textContent?.trim() || "Dish";
      return {
        id: `menu-${slug(name)}`,
        name,
        category: (root.dataset.category || "meal").split(" ")[0],
        price: Number(root.dataset.price) || 0,
        image: card?.querySelector("img")?.getAttribute("src") || "",
        prepMin: getPrep(card)
      };
    }

    // Keep full menu page curated/static.
    // Admin-added items are rendered on category pages only.

    const menuItems = qsa(".menu-item", grid);
    if (!menuItems.length) return;

    const filterButtons = qsa(".menu-filter-btn");
    const searchInput = byId("menuSearch");
    const sortSelect = byId("menuSort");
    const menuResultText = byId("menuResultText");
    const menuResetBtn = byId("menuResetBtn");
    const menuEmptyState = byId("menuEmptyState");
    const menuEmptyResetBtn = byId("menuEmptyResetBtn");
    const addButtons = qsa(".add-to-cart", grid);

    let currentFilter = "all";
    const defaultOrder = Array.from(menuItems);

    function sortItems(mode) {
      const items = Array.from(menuItems);
      if (mode === "price-low") items.sort((a, b) => Number(a.dataset.price) - Number(b.dataset.price));
      else if (mode === "price-high") items.sort((a, b) => Number(b.dataset.price) - Number(a.dataset.price));
      else if (mode === "name-asc") items.sort((a, b) => (a.dataset.name || "").localeCompare(b.dataset.name || ""));
      else {
        defaultOrder.forEach((i) => grid.appendChild(i));
        return;
      }
      items.forEach((i) => grid.appendChild(i));
    }

    function updateResults() {
      const visibleCount = menuItems.filter((i) => !i.classList.contains("menu-item-hidden")).length;
      if (menuResultText) menuResultText.textContent = `Showing ${visibleCount} dish${visibleCount === 1 ? "" : "es"}`;
      if (menuEmptyState) menuEmptyState.classList.toggle("show", visibleCount === 0);
    }

    function applyFilters() {
      const term = (searchInput?.value || "").trim().toLowerCase();
      menuItems.forEach((item) => {
        const categories = item.dataset.category || "";
        const name = (item.dataset.name || "").toLowerCase();
        const okFilter = currentFilter === "all" || categories.includes(currentFilter);
        const okSearch = !term || name.includes(term);
        item.classList.toggle("menu-item-hidden", !(okFilter && okSearch));
      });
      updateResults();
    }

    function reset() {
      currentFilter = "all";
      filterButtons.forEach((b) => b.classList.remove("active"));
      const allBtn = filterButtons.find((b) => b.dataset.filter === "all");
      if (allBtn) allBtn.classList.add("active");
      if (searchInput) searchInput.value = "";
      if (sortSelect) sortSelect.value = "featured";
      sortItems("featured");
      applyFilters();
    }

    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.filter || "all";
        if (target === "veg") { window.location.href = "./category/vegetarian.html"; return; }
        if (target === "nonveg") { window.location.href = "./category/nonveg.html"; return; }
        if (target === "sweet" || target === "dessert") { window.location.href = "./category/desserts.html"; return; }

        filterButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = target;
        applyFilters();
      });
    });

    sortSelect?.addEventListener("change", () => { sortItems(sortSelect.value); applyFilters(); });
    searchInput?.addEventListener("input", applyFilters);
    menuResetBtn?.addEventListener("click", reset);
    menuEmptyResetBtn?.addEventListener("click", reset);

    addButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!requireLogin("Please login first to add items to cart.")) return;
        const root = btn.closest(".menu-item");
        if (!root) return;
        const item = buildItem(root);
        window.FoodieCart.addItem(item, 1);
        updateNavCount();
        const prev = btn.textContent;
        btn.textContent = "Added";
        setTimeout(() => { btn.textContent = prev || "Add To Cart"; }, 900);
      });
    });

    menuItems.forEach((root) => {
      const card = root.querySelector(".card");
      if (!card) return;
      mountFavoriteButton(card, () => buildItem(root));
    });

    applyFilters();
    updateNavCount();
  }

  async function initCategory() {
    const grid = byId("vegItems") || byId("nvItems") || byId("desItems");
    if (!grid) return;

    const isVeg = !!byId("vegItems");
    const isNv = !!byId("nvItems");
    const itemClass = isVeg ? "veg-item" : isNv ? "nv-item" : "des-item";
    const itemSelector = `.${itemClass}`;
    const cardClass = isVeg ? "veg-card" : isNv ? "nv-card" : "des-card";
    const metaClass = isVeg ? "veg-meta" : isNv ? "nv-meta" : "des-meta";
    const badgeClass = isVeg ? "bg-success veg-badge" : isNv ? "bg-danger nv-badge" : "bg-info text-dark des-badge";
    const badgeText = isVeg ? "VEG" : isNv ? "NON-VEG" : "DESSERT";
    const hiddenClass = isVeg ? "veg-item-hidden" : isNv ? "nv-item-hidden" : "des-item-hidden";
    const prefix = isVeg ? "veg" : isNv ? "nonveg" : "dessert";
    const defaultPrepMin = prefix === "dessert" ? 12 : prefix === "veg" ? 18 : 20;

    const filterButtons = qsa(".filter-btn");
    const searchInput = byId(isVeg ? "vegSearch" : isNv ? "nvSearch" : "desSearch");
    const sortSelect = byId(isVeg ? "vegSort" : isNv ? "nvSort" : "desSort");
    const resultText = byId("resultText");
    const resetBtn = byId("resetBtn");
    const emptyState = byId("emptyState");
    const emptyResetBtn = byId("emptyResetBtn");
    const statItems = byId("statItems");
    const statAvg = byId("statAvg");
    const statEta = byId("statEta");
    const miniToast = byId("miniToast");

    let items = qsa(itemSelector, grid);
    let currentFilter = "all";
    let defaultOrder = Array.from(items);

    function refreshItemsCollection() {
      items = qsa(itemSelector, grid);
      defaultOrder = Array.from(items);
    }

    function showToast(t) {
      if (!miniToast) return;
      miniToast.textContent = t;
      miniToast.classList.add("show");
      setTimeout(() => miniToast.classList.remove("show"), 1200);
    }

    function stats() {
      if (!items.length) return;
      const prices = items.map((i) => Number(i.dataset.price) || 0);
      const preps = items.map((i) => Number(i.dataset.prep) || defaultPrepMin);
      if (statItems) statItems.textContent = String(items.length);
      if (statAvg) statAvg.textContent = money(prices.reduce((a, b) => a + b, 0) / Math.max(1, prices.length));
      if (statEta) statEta.textContent = `${Math.round(preps.reduce((a, b) => a + b, 0) / Math.max(1, preps.length))} min`;
    }

    function sortItems(mode) {
      const list = Array.from(items);
      if (mode === "price-low") list.sort((a, b) => Number(a.dataset.price) - Number(b.dataset.price));
      else if (mode === "price-high") list.sort((a, b) => Number(b.dataset.price) - Number(a.dataset.price));
      else if (mode === "name-asc") list.sort((a, b) => (a.dataset.name || "").localeCompare(b.dataset.name || ""));
      else { defaultOrder.forEach((i) => grid.appendChild(i)); return; }
      list.forEach((i) => grid.appendChild(i));
    }

    function updateResults() {
      const visible = items.filter((i) => !i.classList.contains(hiddenClass)).length;
      if (resultText) resultText.textContent = `Showing ${visible} dish${visible === 1 ? "" : "es"}`;
      if (emptyState) emptyState.classList.toggle("show", visible === 0);
    }

    function apply() {
      const term = (searchInput?.value || "").trim().toLowerCase();
      items.forEach((item) => {
        const categories = item.dataset.category || "";
        const name = (item.dataset.name || "").toLowerCase();
        const okFilter = currentFilter === "all" || categories.includes(currentFilter);
        const okSearch = !term || name.includes(term);
        item.classList.toggle(hiddenClass, !(okFilter && okSearch));
      });
      updateResults();
    }

    function buildItem(root) {
      const name = root.dataset.name || "Dish";
      return {
        id: `${prefix}-${slug(name)}`,
        name,
        price: Number(root.dataset.price) || 0,
        category: normalizeMenuCategory((root.dataset.category || prefix).split(" ")[0]),
        image: root.querySelector("img")?.getAttribute("src") || "",
        prepMin: Number(root.dataset.prep) || defaultPrepMin
      };
    }

    function renderBackendCategoryCard(item) {
      const minPrep = Math.max(6, (Number(item.prepMin) || defaultPrepMin) - 4);
      const maxPrep = (Number(item.prepMin) || defaultPrepMin) + 4;
      const description = String(item.description || "").trim() || "Freshly prepared with quality ingredients.";
      return `
        <article class="${cardClass}">
          <img src="${esc(item.image)}" alt="${esc(item.name)}">
          <div class="p-3">
            <span class="badge ${badgeClass} mb-2">${esc(badgeText)}</span>
            <h5>${esc(item.name)}</h5>
            <p class="mb-2">${esc(description)}</p>
            <p class="${metaClass} mb-3"><i class="bi bi-stopwatch"></i> ${minPrep}-${maxPrep} min</p>
            <div class="d-flex justify-content-between align-items-center">
              <strong class="text-success">&#8377;${Number(item.price || 0).toFixed(2)}</strong>
              <button class="btn btn-sm btn-outline-primary add-to-cart">Add To Cart</button>
            </div>
          </div>
        </article>
      `;
    }

    async function appendBackendCategoryItems() {
      try {
        const response = await apiRequest("/menu/list", { method: "POST", body: {} });
        if (!response || !response.success) return;

        const rows = Array.isArray(response.data) ? response.data : [];
        if (!rows.length) return;

        const existingNames = new Set(
          items.map((node) => String(node.dataset.name || "").trim().toLowerCase()).filter(Boolean)
        );

        const additions = [];
        rows.forEach((row) => {
          const name = String(row && row.name || "").trim();
          const price = toNum(row && row.price, 0);
          if (!name || price <= 0) return;

          const normalized = normalizeMenuCategory(row && row.category);
          if (normalized !== prefix) return;

          const key = name.toLowerCase();
          if (existingNames.has(key)) return;
          existingNames.add(key);

          const rawCategory = String(row && row.category || prefix).trim().toLowerCase();
          const node = document.createElement("div");
          node.className = `col-md-6 col-lg-4 ${itemClass}`;
          node.dataset.category = `${prefix} ${rawCategory}`.trim();
          node.dataset.name = name;
          node.dataset.price = String(price);
          node.dataset.prep = String(defaultPrepMin);
          node.innerHTML = renderBackendCategoryCard({
            name: name,
            price: price,
            description: String(row && row.description || "").trim(),
            image: imgSrc(String(row && row.image || "").trim()),
            prepMin: defaultPrepMin
          });
          additions.push(node);
        });

        if (!additions.length) return;
        const fragment = document.createDocumentFragment();
        additions.forEach((node) => fragment.appendChild(node));
        grid.appendChild(fragment);
        refreshItemsCollection();
      } catch (_error) {
        // Keep static category menu if backend/API is unavailable.
      }
    }

    function reset() {
      currentFilter = "all";
      filterButtons.forEach((b) => b.classList.remove("active"));
      const allBtn = filterButtons.find((b) => b.dataset.filter === "all");
      if (allBtn) allBtn.classList.add("active");
      if (searchInput) searchInput.value = "";
      if (sortSelect) sortSelect.value = "featured";
      sortItems("featured");
      apply();
    }

    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter || "all";
        apply();
      });
    });

    sortSelect?.addEventListener("change", () => { sortItems(sortSelect.value); apply(); });
    searchInput?.addEventListener("input", apply);
    resetBtn?.addEventListener("click", reset);
    emptyResetBtn?.addEventListener("click", reset);

    function bindAddButtons() {
      qsa(".add-to-cart", grid).forEach((btn) => {
        if (btn.dataset.cartBound === "1") return;
        btn.dataset.cartBound = "1";
        btn.addEventListener("click", () => {
          if (!requireLogin("Please login first to add items to cart.")) return;
          const root = btn.closest(".veg-item, .nv-item, .des-item");
          if (!root) return;
          const item = buildItem(root);
          window.FoodieCart.addItem(item, 1);
          updateNavCount();
          btn.textContent = "Added";
          setTimeout(() => { btn.textContent = "Add To Cart"; }, 900);
          showToast(`${item.name} added`);
        });
      });
    }

    function bindFavoriteButtons() {
      items.forEach((root) => {
        if (root.dataset.favMounted === "1") return;
        const card = root.querySelector(".veg-card, .nv-card, .des-card, .card");
        if (!card) return;
        root.dataset.favMounted = "1";
        mountFavoriteButton(card, () => buildItem(root));
      });
    }

    await appendBackendCategoryItems();
    bindAddButtons();
    bindFavoriteButtons();

    stats();
    apply();
    updateNavCount();
  }
  function initCart() {
    const cartItemsWrap = byId("cartItemsWrap");
    if (!cartItemsWrap) return;

    const recommendGrid = byId("recommendGrid");
    const clearCartBtn = byId("clearCartBtn");
    const saveCartBtn = byId("saveCartBtn");
    const saveCartState = byId("saveCartState");
    const couponInput = byId("couponInput");
    const applyCouponBtn = byId("applyCouponBtn");
    const couponMsg = byId("couponMsg");
    const deliverySelect = byId("deliverySelect");
    const tipSelect = byId("tipSelect");
    const cartNote = byId("cartNote");
    const itemCount = byId("itemCount");
    const subtotalText = byId("subtotalText");
    const discountText = byId("discountText");
    const taxText = byId("taxText");
    const deliveryText = byId("deliveryText");
    const tipText = byId("tipText");
    const totalText = byId("totalText");
    const etaText = byId("etaText");
    const checkoutBtn = byId("checkoutBtn");
    const cartToast = byId("cartToast");
    const freeDeliveryBar = byId("freeDeliveryBar");
    const freeDeliveryHint = byId("freeDeliveryHint");
    const insightItems = byId("insightItems");
    const insightSavings = byId("insightSavings");
    const insightTotal = byId("insightTotal");
    const cartActionNotice = byId("cartActionNotice");
    const savedForLaterWrap = byId("savedForLaterWrap");
    const couponSuggestions = byId("couponSuggestions");

    let lastRemoved = null;
    let undoTimer = 0;

    const recommended = [
      { id: "garlic-bread", name: "Garlic Bread", price: 280, image: "../assets/Gallery/bread.webp", category: "side", prepMin: 10 },
      { id: "sweet-brownie", name: "Sweet Brownie", price: 320, image: "../assets/Food_items/Choco_Lava_Cake.webp", category: "dessert", prepMin: 12 },
      { id: "green-salad-mini", name: "Mini Green Salad", price: 420, image: "../assets/Food_items/Veggie_Salad.webp", category: "veg", prepMin: 8 }
    ];

    function getSummary() {
      return window.FoodieCart.calculateSummary(window.FoodieCart.getPrefs());
    }

    function applyCheckoutState(summary) {
      if (!checkoutBtn) return;
      const isEmpty = summary.itemCount === 0;
      checkoutBtn.classList.toggle("disabled", isEmpty);
      checkoutBtn.setAttribute("aria-disabled", isEmpty ? "true" : "false");
    }

    function toast(t) {
      if (!cartToast) return;
      cartToast.textContent = t;
      cartToast.classList.add("show");
      setTimeout(() => cartToast.classList.remove("show"), 1300);
    }

    function renderRecommendations() {
      if (!recommendGrid) return;
      recommendGrid.innerHTML = recommended.map((item) => `
        <article class="recommend-card">
          <img src="${imgSrc(item.image)}" alt="${esc(item.name)}">
          <div class="body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <strong>${esc(item.name)}</strong>
              <span class="text-success">${money(item.price)}</span>
            </div>
            <button class="btn btn-sm btn-outline-primary w-100" data-add-recommended="${esc(item.id)}">Add</button>
          </div>
        </article>
      `).join("");
    }

    function renderItems(summary) {
      if (!summary.cart.length) {
        cartItemsWrap.innerHTML = `
          <div class="empty-state">
            <h5 class="mb-2">Your cart is empty</h5>
            <p class="text-muted mb-3">Add your favorite meals from the menu to get started.</p>
            <a href="./menu.html" class="btn btn-primary">Go To Menu</a>
          </div>
        `;
        return;
      }

      cartItemsWrap.innerHTML = summary.cart.map((item) => `
        <article class="cart-item" data-cart-id="${esc(item.id)}">
          <img src="${imgSrc(item.image)}" alt="${esc(item.name)}" class="cart-thumb">
          <div>
            <h6 class="mb-1">${esc(item.name)}</h6>
            <small class="text-muted d-block mb-2 text-uppercase">${esc(item.category || "Meal")}</small>
            <strong class="text-success">${money(item.price)}</strong>
          </div>
          <div class="item-actions d-flex align-items-center gap-2">
            <div class="qty-control">
              <button class="qty-btn" data-qty-action="decrease" aria-label="Decrease quantity">-</button>
              <input class="qty-value-input" data-qty-input="${esc(item.id)}" type="number" min="1" value="${item.quantity}" aria-label="Quantity">
              <button class="qty-btn" data-qty-action="increase" aria-label="Increase quantity">+</button>
            </div>
            <button class="btn btn-sm btn-outline-secondary" data-save-item="${esc(item.id)}" aria-label="Save for later">Save</button>
            <button class="btn btn-sm btn-outline-danger" data-remove-item="${esc(item.id)}" aria-label="Remove item"><i class="bi bi-trash"></i></button>
          </div>
        </article>
      `).join("");
    }

    function showUndoNotice(item) {
      if (!cartActionNotice || !item) return;
      if (undoTimer) clearTimeout(undoTimer);
      cartActionNotice.classList.remove("d-none");
      cartActionNotice.innerHTML = `
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <span>${esc(item.name)} removed from cart.</span>
          <button type="button" class="btn btn-sm btn-outline-light" id="undoRemoveBtn">Undo</button>
        </div>
      `;
      const undoBtn = byId("undoRemoveBtn");
      undoBtn?.addEventListener("click", () => {
        if (!lastRemoved) return;
        window.FoodieCart.addItem(lastRemoved, lastRemoved.quantity || 1);
        lastRemoved = null;
        cartActionNotice.classList.add("d-none");
        renderSummary();
        toast("Item restored");
      });
      undoTimer = setTimeout(() => {
        if (cartActionNotice) cartActionNotice.classList.add("d-none");
        lastRemoved = null;
      }, 5500);
    }

    function renderSavedForLater() {
      if (!savedForLaterWrap) return;
      const saved = window.FoodieCart.readSavedForLater();
      if (!saved.length) {
        savedForLaterWrap.innerHTML = `
          <div class="empty-state py-4">
            <h6 class="mb-1">Nothing saved for later</h6>
            <small class="text-muted">Save items here when you are not ready to order yet.</small>
          </div>
        `;
        return;
      }
      savedForLaterWrap.innerHTML = saved.map((item) => `
        <article class="cart-item saved-item" data-saved-id="${esc(item.id)}">
          <img src="${imgSrc(item.image)}" alt="${esc(item.name)}" class="cart-thumb">
          <div>
            <h6 class="mb-1">${esc(item.name)}</h6>
            <small class="text-muted d-block mb-2 text-uppercase">${esc(item.category || "Meal")}</small>
            <strong class="text-success">${money(item.price)}</strong>
          </div>
          <div class="item-actions d-flex align-items-center gap-2">
            <button class="btn btn-sm btn-outline-primary" data-move-saved="${esc(item.id)}">Move To Cart</button>
            <button class="btn btn-sm btn-outline-danger" data-remove-saved="${esc(item.id)}">Remove</button>
          </div>
        </article>
      `).join("");
    }

    function renderCouponSuggestions(summary) {
      if (!couponSuggestions) return;
      const subtotal = Number(summary?.subtotal || 0);
      const list = Object.keys(window.FoodieCart.coupons || {}).map((code) => {
        const c = window.FoodieCart.coupons[code];
        return {
          code,
          label: c?.label || code,
          minSubtotal: Number(c?.minSubtotal || 0),
          unlocked: subtotal >= Number(c?.minSubtotal || 0)
        };
      }).sort((a, b) => a.minSubtotal - b.minSubtotal);

      couponSuggestions.innerHTML = list.map((entry) => {
        const need = Math.max(0, entry.minSubtotal - subtotal);
        const hint = entry.unlocked ? "Available now" : `${money(need)} more to unlock`;
        return `
          <button type="button" class="coupon-suggestion ${entry.unlocked ? "active" : ""}" data-coupon-suggest="${esc(entry.code)}">
            <span class="fw-semibold">${esc(entry.code)}</span>
            <small>${esc(entry.label)} . ${esc(hint)}</small>
          </button>
        `;
      }).join("");
    }

    function uiFromPrefs() {
      const p = window.FoodieCart.getPrefs();
      if (couponInput) couponInput.value = p.couponCode || "";
      if (deliverySelect) deliverySelect.value = p.deliveryType;
      if (tipSelect) tipSelect.value = p.tipChoice;
      if (cartNote) cartNote.value = readScopedText(Keys.CART_NOTE, "");

      const savedAt = readScopedText(Keys.CART_SAVED_AT, "");
      if (savedAt && saveCartState) saveCartState.textContent = `Saved ${new Date(savedAt).toLocaleString()}`;
    }

    function freeDelivery(summary) {
      const target = 45;
      const pct = Math.min(100, (summary.subtotal / target) * 100);
      if (freeDeliveryBar) freeDeliveryBar.style.width = `${pct}%`;
      if (!freeDeliveryHint) return;
      if (summary.freeDeliveryByAmount) freeDeliveryHint.textContent = "Free delivery unlocked.";
      else freeDeliveryHint.textContent = `${money(Math.max(0, target - summary.subtotal))} more for free delivery.`;
    }

    function renderSummary() {
      const summary = getSummary();
      updateNavCount();

      if (itemCount) itemCount.textContent = String(summary.itemCount);
      if (subtotalText) subtotalText.textContent = money(summary.subtotal);
      if (discountText) discountText.textContent = `-${money(summary.discount)}`;
      if (taxText) taxText.textContent = money(summary.tax);
      if (deliveryText) deliveryText.textContent = money(summary.deliveryFee);
      if (tipText) tipText.textContent = money(summary.tip);
      if (totalText) totalText.textContent = money(summary.total);

      const deliverySavings = summary.freeDeliveryByAmount ? (summary.prefs.deliveryType === "priority" ? 5.99 : 2.99) : 0;
      if (insightItems) insightItems.textContent = String(summary.itemCount);
      if (insightSavings) insightSavings.textContent = money(summary.discount + deliverySavings);
      if (insightTotal) insightTotal.textContent = money(summary.total);

      const etaBase = summary.prefs.deliveryType === "priority" ? 18 : 28;
      if (etaText) etaText.textContent = summary.itemCount ? `${etaBase + Math.min(20, summary.prepMinutes)} min` : "-- min";

      freeDelivery(summary);

      if (couponMsg) {
        couponMsg.textContent = summary.coupon.message || (summary.freeDeliveryByAmount ? "Free delivery unlocked for orders above \u20B945." : "Try SAVE10 for up to \u20B98 off.");
        couponMsg.className = summary.coupon.applied ? "text-success d-block mb-3" : "text-muted d-block mb-3";
      }

      applyCheckoutState(summary);

      renderItems(summary);
      renderSavedForLater();
      renderCouponSuggestions(summary);
    }

    cartItemsWrap.addEventListener("click", (event) => {
      const row = event.target.closest("[data-cart-id]");
      if (!row) return;
      const id = row.getAttribute("data-cart-id");
      if (!id) return;

      if (event.target.closest("[data-remove-item]")) {
        const removed = window.FoodieCart.readCart().find((i) => i.id === id);
        window.FoodieCart.removeItem(id);
        if (removed) {
          lastRemoved = Object.assign({}, removed);
          showUndoNotice(removed);
        }
        renderSavedForLater();
        renderSummary();
        return;
      }

      if (event.target.closest("[data-save-item]")) {
        const result = window.FoodieCart.saveForLater(id);
        if (result.ok) toast(`${result.item.name} saved for later`);
        renderSavedForLater();
        renderSummary();
        return;
      }

      const actionBtn = event.target.closest("[data-qty-action]");
      if (!actionBtn) return;

      const action = actionBtn.getAttribute("data-qty-action");
      const current = window.FoodieCart.readCart().find((i) => i.id === id);
      if (!current) return;
      if (action === "increase" && !requireLogin("Please login first to update cart.")) return;
      const next = action === "increase" ? current.quantity + 1 : current.quantity - 1;
      window.FoodieCart.updateQuantity(id, next);
      renderSummary();
    });

    cartItemsWrap.addEventListener("change", (event) => {
      const input = event.target.closest("[data-qty-input]");
      if (!input) return;
      const id = input.getAttribute("data-qty-input");
      const qty = Math.max(1, Number(input.value) || 1);
      const current = window.FoodieCart.readCart().find((i) => i.id === id);
      if (current && qty > current.quantity && !requireLogin("Please login first to update cart.")) {
        input.value = String(current.quantity);
        return;
      }
      window.FoodieCart.updateQuantity(id, qty);
      renderSummary();
    });

    savedForLaterWrap?.addEventListener("click", (event) => {
      const move = event.target.closest("[data-move-saved]");
      if (move) {
        if (!requireLogin("Please login first to add items to cart.")) return;
        const result = window.FoodieCart.moveSavedToCart(move.getAttribute("data-move-saved") || "");
        if (result.ok) toast(`${result.item.name} moved to cart`);
        renderSavedForLater();
        renderSummary();
        return;
      }
      const remove = event.target.closest("[data-remove-saved]");
      if (!remove) return;
      const id = remove.getAttribute("data-remove-saved") || "";
      window.FoodieCart.removeSavedForLater(id);
      renderSavedForLater();
      toast("Removed from saved list");
    });

    couponSuggestions?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-coupon-suggest]");
      if (!btn) return;
      const code = btn.getAttribute("data-coupon-suggest") || "";
      if (couponInput) couponInput.value = code;
      window.FoodieCart.setPrefs({ couponCode: code });
      renderSummary();
    });

    recommendGrid?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-add-recommended]");
      if (!btn) return;
      if (!requireLogin("Please login first to add items to cart.")) return;
      const item = recommended.find((x) => x.id === btn.getAttribute("data-add-recommended"));
      if (!item) return;
      window.FoodieCart.addItem(item, 1);
      toast(`${item.name} added`);
      renderSummary();
    });

    clearCartBtn?.addEventListener("click", () => { window.FoodieCart.clearCart(); renderSummary(); });
    saveCartBtn?.addEventListener("click", () => {
      writeScopedText(Keys.CART_SAVED_AT, new Date().toISOString());
      if (saveCartState) saveCartState.textContent = `Saved ${new Date().toLocaleString()}`;
      toast("Cart saved");
    });

    applyCouponBtn?.addEventListener("click", () => {
      window.FoodieCart.setPrefs({ couponCode: (couponInput?.value || "").trim().toUpperCase() });
      renderSummary();
    });

    qsa("[data-coupon-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const code = chip.getAttribute("data-coupon-chip") || "";
        if (couponInput) couponInput.value = code;
        window.FoodieCart.setPrefs({ couponCode: code });
        renderSummary();
      });
    });

    deliverySelect?.addEventListener("change", () => { window.FoodieCart.setPrefs({ deliveryType: deliverySelect.value }); renderSummary(); });
    tipSelect?.addEventListener("change", () => { window.FoodieCart.setPrefs({ tipChoice: tipSelect.value }); renderSummary(); });
    cartNote?.addEventListener("input", () => writeScopedText(Keys.CART_NOTE, cartNote.value.trim()));
    checkoutBtn?.addEventListener("click", (event) => {
      if (!requireLogin("Please login first to continue checkout.")) {
        event.preventDefault();
        return;
      }
      const summary = getSummary();
      if (!summary.itemCount) {
        event.preventDefault();
        toast("Your cart is empty");
      }
    });

    uiFromPrefs();
    renderRecommendations();
    renderSavedForLater();
    renderSummary();
  }

  function initCheckout() {
    const form = byId("checkoutForm");
    if (!form) return;

    const checkoutItems = byId("checkoutItems");
    const checkoutEmpty = byId("checkoutEmpty");
    const subtotalText = byId("subtotalText");
    const discountText = byId("discountText");
    const taxText = byId("taxText");
    const deliveryText = byId("deliveryText");
    const tipText = byId("tipText");
    const totalText = byId("totalText");
    const orderSuccess = byId("orderSuccess");
    const trackingId = byId("trackingId");
    const placeOrderBtn = byId("placeOrderBtn");
    const draftInfo = byId("draftInfo");
    const couponBadge = byId("couponBadge");
    const deliveryTime = byId("deliveryTime");
    const stepEls = qsa(".checkout-step");
    const kpiItems = byId("kpiItems");
    const kpiEta = byId("kpiEta");
    const kpiTotal = byId("kpiTotal");
    const validationSummary = byId("validationSummary");
    const checkoutProgressHint = byId("checkoutProgressHint");
    const paymentRadios = qsa('input[name="payment"]', form);

    const f = (id) => byId(id);
    const step = (s) => stepEls.forEach((el) => el.classList.toggle("active", Number(el.getAttribute("data-step") || 0) <= s));

    function ensureGate() {
      let gate = byId("checkoutGateAuto");
      if (gate) return gate;
      gate = document.createElement("div");
      gate.id = "checkoutGateAuto";
      gate.className = "alert alert-warning d-none";
      gate.setAttribute("role", "alert");
      form.insertBefore(gate, form.firstChild);
      return gate;
    }

    function setFormEnabled(enabled) {
      // Allow UI inspection even when empty/not logged in, but prevent edits that imply checkout.
      qsa("input,select,textarea,button", form).forEach((el) => {
        if (el.id === "placeOrderBtn") return;
        if (el.type === "submit") return;
        el.disabled = !enabled;
      });
    }

    function getPayment() {
      return qs('input[name="payment"]:checked', form)?.value || "Card";
    }

    function ensurePaymentNotice() {
      let node = byId("paymentNoticeAuto");
      if (node) return node;
      const anchor = qs(".payment-choices", form) || placeOrderBtn?.parentElement || null;
      if (!anchor || !anchor.parentElement) return null;
      node = document.createElement("div");
      node.id = "paymentNoticeAuto";
      node.className = "alert alert-info d-none mt-3";
      node.setAttribute("role", "alert");
      anchor.parentElement.insertBefore(node, anchor.nextSibling);
      return node;
    }

    function paymentSupported(method) {
      return ["Card", "UPI", "Cash on Delivery"].includes(method);
    }

    function ensureRazorpayScript() {
      if (window.Razorpay) return Promise.resolve(window.Razorpay);
      if (RazorpayScriptPromise) return RazorpayScriptPromise;

      RazorpayScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-razorpay-checkout="1"]');
        if (existing) {
          existing.addEventListener("load", () => resolve(window.Razorpay));
          existing.addEventListener("error", () => reject(new Error("Unable to load Razorpay checkout.")));
          return;
        }

        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.setAttribute("data-razorpay-checkout", "1");
        script.addEventListener("load", () => resolve(window.Razorpay));
        script.addEventListener("error", () => reject(new Error("Unable to load Razorpay checkout.")));
        document.head.appendChild(script);
      });

      return RazorpayScriptPromise;
    }

    async function createRazorpayCheckoutOrder(method, summary) {
      const response = await apiRequest("/orders/razorpay/order", {
        method: "POST",
        body: {
          payment_method: method,
          delivery_fee: summary.deliveryFee,
          discount: summary.discount,
          items: summary.cart
        }
      });
      if (!response || !response.success || !response.data) {
        throw new Error((response && response.message) || "Unable to initialize Razorpay payment.");
      }
      return response.data;
    }

    async function openRazorpayPayment(method, summary) {
      await ensureRazorpayScript();
      if (typeof window.Razorpay !== "function") {
        throw new Error("Razorpay checkout is unavailable right now.");
      }

      const checkout = await createRazorpayCheckoutOrder(method, summary);
      return new Promise((resolve) => {
        let settled = false;
        const closeWith = (result) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        const rzp = new window.Razorpay({
          key: String(checkout.key_id || "").trim(),
          amount: Number(checkout.amount) || Math.round((summary.total || 0) * 100),
          currency: String(checkout.currency || "INR"),
          name: String(checkout.name || "FoodieHub"),
          description: String(checkout.description || `${method} payment`),
          order_id: String(checkout.order_id || "").trim(),
          prefill: checkout.prefill || {},
          theme: { color: "#ff6f4d" },
          modal: {
            ondismiss: function () {
              closeWith({ ok: false, cancelled: true });
            }
          },
          handler: function (response) {
            closeWith({
              ok: true,
              gateway: "Razorpay",
              orderId: String(response.razorpay_order_id || checkout.order_id || "").trim(),
              paymentId: String(response.razorpay_payment_id || "").trim(),
              signature: String(response.razorpay_signature || "").trim(),
              reference: String(response.razorpay_payment_id || "").trim()
            });
          }
        });

        rzp.on("payment.failed", function (response) {
          const message = response?.error?.description || response?.error?.reason || "Razorpay payment failed.";
          closeWith({ ok: false, message });
        });

        rzp.open();
      });
    }

    function setInlineError(id, message) {
      const holder = byId(`inlineError-${id}`);
      if (!holder) return;
      holder.textContent = message || "";
      holder.classList.toggle("d-none", !message);
    }

    function getSummary() {
      return window.FoodieCart.calculateSummary(window.FoodieCart.getPrefs());
    }

    function applyPlaceOrderState(summary) {
      const payment = getPayment();
      const payOk = paymentSupported(payment);
      const session = getAuthSession();
      const authOk = !!session && session.role !== "guest";

      if (placeOrderBtn) {
        placeOrderBtn.disabled = summary.itemCount === 0 || !authOk || !payOk;
      }
      if (checkoutProgressHint) {
        if (!session) checkoutProgressHint.textContent = "Login required to place order.";
        else if (session.role === "guest") checkoutProgressHint.textContent = "Guest users cannot place orders. Please login to continue.";
        else if (!summary.itemCount) checkoutProgressHint.textContent = "Your cart is empty. Add items to continue.";
        else if (!payOk) checkoutProgressHint.textContent = "Selected payment method is unavailable.";
        else if (payment === "Cash on Delivery") checkoutProgressHint.textContent = "Cash on Delivery selected. Pay after delivery.";
        else checkoutProgressHint.textContent = `${payment} Razorpay test checkout enabled. Complete payment to place order.`;
      }

      const notice = ensurePaymentNotice();
      if (notice) {
        if (payment === "Cash on Delivery") {
          notice.classList.add("d-none");
          notice.textContent = "";
        } else {
          notice.classList.add("d-none");
          notice.textContent = "";
        }
      }
    }

    function clearValidationState(ids) {
      ids.forEach((id) => {
        f(id)?.classList.remove("is-valid", "is-invalid");
        setInlineError(id, "");
      });
      validationSummary?.classList.add("d-none");
      if (validationSummary) validationSummary.textContent = "";
    }

    function buildSlots() {
      if (!deliveryTime) return;
      const now = new Date();
      const slots = ["As soon as possible", ...[20, 35, 50, 65, 80].map((m) => {
        const n = new Date(now.getTime() + m * 60000);
        return `Today ${n.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      })];
      deliveryTime.innerHTML = "";
      slots.forEach((label) => {
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label;
        deliveryTime.appendChild(option);
      });
    }

    function saveDraft() {
      const draft = {
        fullName: f("fullName")?.value || "",
        phone: f("phone")?.value || "",
        address: f("address")?.value || "",
        city: f("city")?.value || "",
        zip: f("zip")?.value || "",
        deliveryTime: deliveryTime?.value || "",
        notes: f("notes")?.value || "",
        terms: !!f("termsCheck")?.checked,
        payment: qs('input[name="payment"]:checked')?.value || "Card"
      };
      writeScopedJson(Keys.CHECKOUT_DRAFT, draft);
      if (draftInfo) draftInfo.textContent = "Draft saved";
    }

    function loadDraft() {
      const raw = readScopedText(Keys.CHECKOUT_DRAFT, "");
      if (!raw) {
        const note = readScopedText(Keys.CART_NOTE, "");
        if (note && f("notes")) f("notes").value = note;
        return;
      }
      try {
        const d = JSON.parse(raw);
        if (d.fullName && f("fullName")) f("fullName").value = d.fullName;
        if (d.phone && f("phone")) f("phone").value = d.phone;
        if (d.address && f("address")) f("address").value = d.address;
        if (d.city && f("city")) f("city").value = d.city;
        if (d.zip && f("zip")) f("zip").value = d.zip;
        if (d.notes && f("notes")) f("notes").value = d.notes;
        if (d.terms && f("termsCheck")) f("termsCheck").checked = true;
        if (d.deliveryTime && deliveryTime) deliveryTime.value = d.deliveryTime;
        if (d.payment) {
          const input = qsa('input[name="payment"]').find((x) => x.value === d.payment);
          if (input) input.checked = true;
        }
        if (draftInfo) draftInfo.textContent = "Draft restored";
      } catch (_e) {
        removeScoped(Keys.CHECKOUT_DRAFT);
      }
    }

    function applyProfileDefaults() {
      const profile = window.FoodieCart.readProfile();
      if (profile && profile.name && f("fullName") && !f("fullName").value) f("fullName").value = profile.name;
      if (profile && profile.phone && f("phone") && !f("phone").value) f("phone").value = profile.phone;

      const addresses = window.FoodieCart.readAddresses();
      if (!Array.isArray(addresses) || !addresses.length) return;
      const pick = addresses.find((a) => a.isDefault) || addresses[0];
      if (pick && f("address") && !f("address").value) f("address").value = pick.line;
      if (pick && f("city") && !f("city").value) f("city").value = pick.city;
      if (pick && f("zip") && !f("zip").value) f("zip").value = pick.zip;
    }

    function injectSavedAddressPicker() {
      const addresses = window.FoodieCart.readAddresses();
      if (!Array.isArray(addresses) || !addresses.length) return;
      if (byId("savedAddressSelect")) return;
      const addressInput = f("address");
      if (!addressInput) return;
      const addressCol = addressInput.closest(".col-12");
      if (!addressCol || !addressCol.parentElement) return;

      const col = document.createElement("div");
      col.className = "col-12";
      col.innerHTML = `
        <label for="savedAddressSelect" class="form-label">Saved Address</label>
        <select id="savedAddressSelect" class="form-select">
          <option value="">Select saved address</option>
          ${addresses.map((a) => `<option value="${esc(a.id)}">${esc(a.label)} - ${esc(a.line)}, ${esc(a.city)} ${esc(a.zip)}${a.isDefault ? " (Default)" : ""}</option>`).join("")}
        </select>
      `;

      addressCol.parentElement.insertBefore(col, addressCol);
      const select = byId("savedAddressSelect");
      select?.addEventListener("change", () => {
        const id = select.value;
        const chosen = window.FoodieCart.readAddresses().find((a) => a.id === id);
        if (!chosen) return;
        if (f("address")) f("address").value = chosen.line;
        if (f("city")) f("city").value = chosen.city;
        if (f("zip")) f("zip").value = chosen.zip;
        saveDraft();
      });
    }

    function render() {
      const s = getSummary();
      updateNavCount();
      if (subtotalText) subtotalText.textContent = money(s.subtotal);
      if (discountText) discountText.textContent = `-${money(s.discount)}`;
      if (taxText) taxText.textContent = money(s.tax);
      if (deliveryText) deliveryText.textContent = money(s.deliveryFee);
      if (tipText) tipText.textContent = money(s.tip);
      if (totalText) totalText.textContent = money(s.total);

      if (kpiItems) kpiItems.textContent = String(s.itemCount);
      if (kpiEta) kpiEta.textContent = s.itemCount ? `${s.prepMinutes + (s.prefs.deliveryType === "priority" ? 18 : 28)} min` : "--";
      if (kpiTotal) kpiTotal.textContent = money(s.total);

      if (couponBadge) {
        if (s.coupon.applied) {
          couponBadge.textContent = `Coupon Applied: ${s.coupon.code}`;
          couponBadge.classList.remove("d-none");
        } else {
          couponBadge.classList.add("d-none");
        }
      }

      const gate = ensureGate();
      const session = getAuthSession();
      if (!session) {
        gate.classList.remove("d-none");
        gate.innerHTML = `
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span><strong>Login required</strong> to place an order. You can still review checkout details.</span>
            <a class="btn btn-sm btn-outline-dark" href="${esc(`${loginPath()}?mode=user`)}">Login</a>
          </div>
        `;
        setFormEnabled(false);
      } else if (session.role === "guest") {
        gate.classList.remove("d-none");
        gate.innerHTML = `
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span><strong>Guest users cannot place orders.</strong> Please login with Demo/Google or create an account.</span>
            <a class="btn btn-sm btn-outline-dark" href="${esc(`${loginPath()}?mode=user`)}">Login</a>
          </div>
        `;
        setFormEnabled(false);
      } else if (!s.cart.length) {
        gate.classList.remove("d-none");
        gate.innerHTML = `
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span><strong>Your cart is empty.</strong> Add items from the menu to continue checkout.</span>
            <a class="btn btn-sm btn-outline-dark" href="./menu.html">Go To Menu</a>
          </div>
        `;
        setFormEnabled(false);
      } else {
        gate.classList.add("d-none");
        gate.textContent = "";
        setFormEnabled(true);
      }

      if (!s.cart.length) {
        if (checkoutItems) checkoutItems.innerHTML = "";
        checkoutEmpty?.classList.remove("d-none");
        applyPlaceOrderState(s);
        return;
      }

      checkoutEmpty?.classList.add("d-none");
      applyPlaceOrderState(s);

      if (checkoutItems) {
        checkoutItems.innerHTML = s.cart.map((item) => `
          <article class="checkout-item">
            <div>
              <div class="fw-semibold">${esc(item.name)}</div>
              <small class="text-muted">Qty: ${item.quantity}</small>
            </div>
            <strong>${money(item.price * item.quantity)}</strong>
          </article>
        `).join("");
      }
    }

    function valid() {
      let ok = true;
      const invalidFields = [];
      ["fullName", "phone", "address", "city", "zip", "termsCheck"].forEach((id) => {
        const el = f(id);
        if (!el) return;
        const v = el.checkValidity();
        el.classList.toggle("is-valid", v);
        el.classList.toggle("is-invalid", !v);
        if (!v) {
          ok = false;
          invalidFields.push(id);
        }
        if (id === "termsCheck") {
          setInlineError(id, v ? "" : "You must confirm terms before placing order.");
        } else {
          setInlineError(id, v ? "" : `Please enter a valid ${id.replace(/[A-Z]/g, " $&").toLowerCase().trim()}.`);
        }
      });
      if (!ok && validationSummary) {
        validationSummary.textContent = `Please fix ${invalidFields.length} field${invalidFields.length === 1 ? "" : "s"} before placing order.`;
        validationSummary.classList.remove("d-none");
      } else if (validationSummary) {
        validationSummary.textContent = "";
        validationSummary.classList.add("d-none");
      }
      return ok;
    }

    function ticket() { return `FH-${Math.floor(100000 + Math.random() * 900000)}`; }

    ["fullName", "phone", "address", "city", "zip", "notes", "termsCheck", "deliveryTime"].forEach((id) => {
      const el = f(id);
      if (!el) return;
      el.addEventListener("input", () => {
        saveDraft();
        step(1);
        if (el.classList.contains("is-invalid")) valid();
      });
      el.addEventListener("change", () => {
        saveDraft();
        step(2);
        if (el.classList.contains("is-invalid")) valid();
      });
    });

    paymentRadios.forEach((el) => el.addEventListener("change", () => {
      saveDraft();
      step(2);
      render();
    }));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLogin("Please login first to place your order.")) return;
      if (!valid()) { step(1); return; }
      const s = getSummary();
      if (!s.itemCount) return;

      const payment = getPayment();
      if (!paymentSupported(payment)) {
        notify("Selected payment method is unavailable.", "error");
        step(2);
        render();
        return;
      }
      if (placeOrderBtn) {
        placeOrderBtn.disabled = true;
        placeOrderBtn.textContent = payment === "Cash on Delivery" ? "Placing Order..." : "Awaiting Payment...";
      }
      step(3);

      let paymentResult = null;
      if (payment !== "Cash on Delivery") {
        try {
          paymentResult = await openRazorpayPayment(payment, s);
        } catch (error) {
          if (placeOrderBtn) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.textContent = "Place Order";
          }
          notify((error && error.message) ? error.message : "Unable to start Razorpay checkout.", "error");
          step(2);
          render();
          return;
        }
        if (!paymentResult || !paymentResult.ok) {
          if (placeOrderBtn) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.textContent = "Place Order";
          }
          notify(paymentResult?.message || "Payment cancelled.", "error");
          step(2);
          render();
          return;
        }
        if (placeOrderBtn) placeOrderBtn.textContent = "Finalizing Order...";
      }

      const orderId = ticket();
      const result = await window.FoodieCart.addOrder({
        id: orderId,
        createdAt: new Date().toISOString(),
        status: "Placed",
        payment,
        itemCount: s.itemCount,
        subtotal: s.subtotal,
        discount: s.discount,
        tax: s.tax,
        deliveryFee: s.deliveryFee,
        tip: s.tip,
        total: s.total,
        paymentStatus: payment === "Cash on Delivery" ? "Pending" : "Paid",
        paymentReference: paymentResult?.reference || "",
        paymentGateway: payment === "Cash on Delivery" ? "Cash on Delivery" : "Razorpay",
        razorpayOrderId: paymentResult?.orderId || "",
        razorpayPaymentId: paymentResult?.paymentId || "",
        razorpaySignature: paymentResult?.signature || "",
        items: s.cart,
        fullName: String(f("fullName")?.value || "").trim(),
        phone: String(f("phone")?.value || "").trim(),
        address: String(f("address")?.value || "").trim(),
        city: String(f("city")?.value || "").trim(),
        zip: String(f("zip")?.value || "").trim(),
        notes: String(f("notes")?.value || "").trim()
      });
      if (!result || !result.ok) {
        if (placeOrderBtn) {
          placeOrderBtn.disabled = false;
          placeOrderBtn.textContent = "Place Order";
        }
        notify((result && result.message) || "Failed to place order.", "error");
        step(2);
        return;
      }
      if (trackingId) trackingId.textContent = result?.order?.id || orderId;
      orderSuccess?.classList.remove("d-none");
      window.FoodieCart.clearCart();
      form.reset();
      clearValidationState(["fullName", "phone", "address", "city", "zip", "termsCheck"]);
      removeScoped(Keys.CHECKOUT_DRAFT);
      if (placeOrderBtn) placeOrderBtn.textContent = `Order Confirmed (${payment})`;
      render();
      setTimeout(() => {
        const latest = getSummary();
        if (placeOrderBtn) {
          placeOrderBtn.textContent = "Place Order";
          placeOrderBtn.disabled = latest.itemCount === 0;
        }
        orderSuccess?.classList.add("d-none");
        step(1);
      }, 3500);
    });

    buildSlots();
    loadDraft();
    applyProfileDefaults();
    injectSavedAddressPicker();
    render();
    step(1);

    // Hydrate local cached profile/addresses from SQL so checkout defaults and pickers stay in sync.
    syncProfileFromBackend().then((updated) => {
      if (!updated) return;
      applyProfileDefaults();
      injectSavedAddressPicker();
      render();
    }).catch(() => { });
  }

  function initOrders() {
    const ordersList = byId("ordersList");
    if (!ordersList) return;

    const orderSearch = byId("orderSearch");
    const orderSearchReset = byId("orderSearchReset");
    const orderResultText = byId("orderResultText");
    const ordersEmpty = byId("ordersEmpty");
    const ordersEmptyTitle = ordersEmpty?.querySelector("h4");
    const ordersEmptyText = ordersEmpty?.querySelector("p");
    const ordersEmptyAction = ordersEmpty?.querySelector("a");
    const orderToast = byId("orderToast");
    const timelineSteps = ["Placed", "Preparing", "Out for Delivery", "Delivered"];
    const defaultEmptyTitle = "No orders found";
    const defaultEmptyText = "Place your first order from the menu and it will appear here.";
    const defaultEmptyActionText = "Start Ordering";
    const defaultEmptyActionHref = "./menu.html";

    function formatDate(value) {
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return "--";
      return d.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function getStageIndex(order) {
      const status = normalizeOrderStatus(order?.status);
      if (status === "Delivered") return 3;
      if (status === "Out for Delivery") return 2;
      if (status === "Preparing") return 1;
      if (status === "Placed") return 0;
      if (status === "Cancelled") return -1;
      const created = Date.parse(order?.createdAt || "");
      if (!Number.isFinite(created)) return 0;
      const elapsedMinutes = (Date.now() - created) / 60000;
      if (elapsedMinutes >= 3) return 3;
      if (elapsedMinutes >= 2) return 2;
      if (elapsedMinutes >= 1) return 1;
      return 0;
    }

    function getStatusClass(stage) {
      if (stage < 0) return "bg-danger-subtle text-danger-emphasis border-danger-subtle";
      if (stage >= 3) return "bg-success-subtle text-success-emphasis border-success-subtle";
      if (stage === 2) return "bg-primary-subtle text-primary-emphasis border-primary-subtle";
      if (stage === 1) return "bg-warning-subtle text-warning-emphasis border-warning-subtle";
      return "bg-secondary-subtle text-secondary-emphasis border-secondary-subtle";
    }

    function showToast(message) {
      if (!orderToast) return;
      orderToast.textContent = message;
      orderToast.classList.add("show");
      if (orderToast.__hideTimer) clearTimeout(orderToast.__hideTimer);
      orderToast.__hideTimer = setTimeout(() => orderToast.classList.remove("show"), 1400);
    }

    function itemPreview(items) {
      if (!Array.isArray(items) || !items.length) return "No item details available.";
      const first = items.slice(0, 3).map((item) => esc(item.name)).join(", ");
      const extra = items.length > 3 ? ` +${items.length - 3} more` : "";
      return `${first}${extra}`;
    }

    function timelineHtml(stage) {
      if (stage < 0) {
        return `
          <div class="order-timeline-step active">
            <span class="dot"></span>
            <small>Cancelled</small>
          </div>
        `;
      }
      return timelineSteps.map((label, index) => `
        <div class="order-timeline-step ${index <= stage ? "active" : ""}">
          <span class="dot"></span>
          <small>${esc(label)}</small>
        </div>
      `).join("");
    }

    function applyAuthEmptyStateIfNeeded() {
      const session = getAuthSession();
      const blocked = !session || session.role === "guest";
      if (!blocked) {
        if (orderSearch) orderSearch.disabled = false;
        if (orderSearchReset) orderSearchReset.disabled = false;
        if (ordersEmptyTitle) ordersEmptyTitle.textContent = defaultEmptyTitle;
        if (ordersEmptyText) ordersEmptyText.textContent = defaultEmptyText;
        if (ordersEmptyAction) {
          ordersEmptyAction.textContent = defaultEmptyActionText;
          ordersEmptyAction.setAttribute("href", defaultEmptyActionHref);
        }
        return false;
      }

      if (orderSearch) {
        orderSearch.disabled = true;
        orderSearch.value = "";
      }
      if (orderSearchReset) orderSearchReset.disabled = true;
      if (orderResultText) {
        orderResultText.textContent = "Showing 0 orders";
      }

      if (ordersEmptyTitle) {
        ordersEmptyTitle.textContent = "No orders available";
      }
      if (ordersEmptyText) {
        ordersEmptyText.textContent = session
          ? "Guest mode does not show order history. Login as user to view your orders."
          : "Please login as user to view your order history.";
      }
      if (ordersEmptyAction) {
        const loginHref = `${loginPath()}?mode=user`;
        ordersEmptyAction.textContent = session ? "Switch to User Login" : "Login";
        ordersEmptyAction.setAttribute("href", loginHref);
      }

      ordersList.innerHTML = "";
      ordersEmpty?.classList.remove("d-none");
      return true;
    }

    function getFilteredOrders() {
      const term = (orderSearch?.value || "").trim().toLowerCase();
      const orders = window.FoodieCart.readOrders();
      if (!term) return orders;
      return orders.filter((order) => String(order.id || "").toLowerCase().includes(term));
    }

    function reorder(orderId) {
      if (!requireLogin("Please login first to reorder items.")) return;
      const order = window.FoodieCart.readOrders().find((x) => x.id === orderId);
      if (!order || !Array.isArray(order.items) || !order.items.length) return;
      order.items.forEach((item) => window.FoodieCart.addItem(item, item.quantity || 1));
      updateNavCount();
      showToast(`Reordered ${order.itemCount} item${order.itemCount === 1 ? "" : "s"}`);
    }

    function bindReorderButtons() {
      qsa(".order-reorder-btn", ordersList).forEach((btn) => {
        btn.addEventListener("click", () => {
          const orderId = btn.getAttribute("data-order-id") || "";
          reorder(orderId);
        });
      });
    }

    function render() {
      if (applyAuthEmptyStateIfNeeded()) return;
      const rows = getFilteredOrders();
      if (orderResultText) {
        orderResultText.textContent = `Showing ${rows.length} order${rows.length === 1 ? "" : "s"}`;
      }

      if (!rows.length) {
        ordersList.innerHTML = "";
        ordersEmpty?.classList.remove("d-none");
        return;
      }

      ordersEmpty?.classList.add("d-none");
      ordersList.innerHTML = rows.map((order) => {
        const stage = getStageIndex(order);
        const status = normalizeOrderStatus(order.status);
        const badgeClass = getStatusClass(stage);
        return `
          <article class="order-card">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-3 flex-wrap">
              <div>
                <h5 class="mb-1">Order ${esc(order.id)}</h5>
                <small class="text-muted">${formatDate(order.createdAt)}</small>
              </div>
              <span class="badge border ${badgeClass}">${esc(status)}</span>
            </div>
            <div class="row g-2 mb-3">
              <div class="col-sm-4">
                <small class="text-muted d-block">Order ID</small>
                <strong>${esc(order.id)}</strong>
              </div>
              <div class="col-sm-4">
                <small class="text-muted d-block">Date</small>
                <strong>${esc(formatDate(order.createdAt))}</strong>
              </div>
              <div class="col-sm-4">
                <small class="text-muted d-block">Total</small>
                <strong>${money(order.total)}</strong>
              </div>
            </div>
            <div class="order-items-preview">${itemPreview(order.items)}</div>
            <div class="order-timeline mt-3 ${stage < 0 ? "order-timeline-cancelled" : ""}">${timelineHtml(stage)}</div>
            <div class="d-flex justify-content-between align-items-center mt-3 gap-2 flex-wrap">
              <small class="text-muted">${esc(order.payment)} . ${order.itemCount} item${order.itemCount === 1 ? "" : "s"}</small>
              <button type="button" class="btn btn-sm btn-outline-primary order-reorder-btn" data-order-id="${esc(order.id)}">Reorder</button>
            </div>
          </article>
        `;
      }).join("");
      bindReorderButtons();
    }

    orderSearch?.addEventListener("input", render);
    orderSearchReset?.addEventListener("click", () => {
      if (orderSearch) orderSearch.value = "";
      render();
      orderSearch?.focus();
    });

    async function refreshOrders() {
      await window.FoodieCart.syncOrders();
      window.FoodieCart.autoAdvanceOrderStatuses();
      render();
    }

    refreshOrders();
    setInterval(() => {
      window.FoodieCart.autoAdvanceOrderStatuses();
      render();
    }, 15000);
    setInterval(refreshOrders, 20000);
    updateNavCount();
  }

  function initContact() {
    const form = byId("contactForm");
    if (!form) return;

    const success = byId("contactSuccess");
    const submitBtn = byId("contactSubmitBtn");
    const spinner = submitBtn?.querySelector(".spinner-border") || null;
    const submitLabel = submitBtn?.querySelector(".submit-label") || null;
    const topic = byId("topic");
    const topicHint = byId("topicHint");
    const message = byId("message");
    const messageCount = byId("messageCount");
    const draftState = byId("draftState");
    const draftNotice = byId("draftNotice");
    const ticketIdText = byId("ticketIdText");
    const faqSearch = byId("faqSearch");
    const faqItems = qsa("#faqAccordion .accordion-item");
    const faqEmptyState = byId("faqEmptyState");
    const copyButtons = qsa(".contact-copy");
    const supportClock = byId("supportClock");
    const supportStatus = byId("supportStatus");
    const trackInput = byId("trackInput");
    const trackBtn = byId("trackBtn");
    const trackResult = byId("trackResult");

    const getField = (id) => byId(id);

    function setTopicHint() {
      if (!topic || !topicHint) return;
      const map = {
        "Order Issue": "Please share your order ID and what went wrong.",
        "Payment": "Share payment mode, amount, and issue details.",
        "Delivery": "Tell us expected slot and latest delivery status.",
        "Partnership": "Share brand details and city coverage.",
        "General": "Tell us how we can help."
      };
      topicHint.textContent = map[topic.value] || map.General;
    }

    function countMsg() {
      if (!message || !messageCount) return;
      messageCount.textContent = `${message.value.length} / 500`;
    }

    function saveDraft() {
      const d = {
        name: getField("name")?.value || "",
        phone: getField("phone")?.value || "",
        email: getField("email")?.value || "",
        topic: topic?.value || "",
        orderId: getField("order_id")?.value || "",
        priority: getField("priority")?.value || "",
        message: message?.value || ""
      };
      writeScopedJson(Keys.CONTACT_DRAFT, d);
      if (draftState) draftState.textContent = "Draft saved";
    }

    function loadDraft() {
      const raw = readScopedText(Keys.CONTACT_DRAFT, "");
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d.name && getField("name")) getField("name").value = d.name;
        if (d.phone && getField("phone")) getField("phone").value = d.phone;
        if (d.email && getField("email")) getField("email").value = d.email;
        if (d.topic && topic) topic.value = d.topic;
        if (d.orderId && getField("order_id")) getField("order_id").value = d.orderId;
        if (d.priority && getField("priority")) getField("priority").value = d.priority;
        if (d.message && message) message.value = d.message;
        draftNotice?.classList.remove("d-none");
        setTimeout(() => draftNotice?.classList.add("d-none"), 3000);
      } catch (_e) {
        removeScoped(Keys.CONTACT_DRAFT);
      }
    }

    function ticket() {
      const suffix = Math.floor(10000 + Math.random() * 90000);
      return `FH-${suffix}`;
    }

    function copyText(value, btn) {
      if (!value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(() => {
          const prev = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => { btn.textContent = prev; }, 1400);
        });
      } else {
        const temp = document.createElement("input");
        temp.value = value;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
    }

    function supportLive() {
      const now = new Date();
      if (supportClock) supportClock.textContent = now.toLocaleTimeString();
      const h = now.getHours();
      const open = h >= 9 && h < 24;
      if (supportStatus) {
        supportStatus.innerHTML = `<span class="status-dot" style="background:${open ? "#20c997" : "#ffc107"};box-shadow:0 0 0 4px ${open ? "rgba(32, 201, 151, 0.18)" : "rgba(255, 193, 7, 0.18)"};"></span><span>Support currently ${open ? "online" : "limited"}</span>`;
      }
    }

    function filterFaq() {
      const term = (faqSearch?.value || "").trim().toLowerCase();
      let shown = 0;
      faqItems.forEach((item) => {
        const visible = !term || item.textContent.toLowerCase().includes(term);
        item.classList.toggle("faq-hidden", !visible);
        if (visible) shown += 1;
      });
      faqEmptyState?.classList.toggle("d-none", shown > 0);
    }

    trackBtn?.addEventListener("click", () => {
      const value = (trackInput?.value || "").trim();
      if (!value) {
        if (trackResult) trackResult.textContent = "Enter a ticket ID to check status.";
        return;
      }
      const statuses = [
        "Ticket received. Support agent will review shortly.",
        "Assigned to support team. Expect an update in 30 minutes.",
        "In progress. We may contact you for more details.",
        "Resolved. Please check your registered email/phone."
      ];
      if (trackResult) trackResult.textContent = statuses[value.length % statuses.length];
    });

    copyButtons.forEach((btn) => btn.addEventListener("click", () => copyText(btn.getAttribute("data-copy") || "", btn)));

    topic?.addEventListener("change", () => { setTopicHint(); saveDraft(); });
    message?.addEventListener("input", () => { countMsg(); saveDraft(); });
    ["name", "phone", "email", "order_id", "priority"].forEach((id) => getField(id)?.addEventListener("input", saveDraft));
    faqSearch?.addEventListener("input", filterFaq);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.classList.add("was-validated");
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      spinner?.classList.remove("d-none");
      if (submitLabel) submitLabel.textContent = "Submitting...";

      setTimeout(() => {
        form.reset();
        form.classList.remove("was-validated");
        spinner?.classList.add("d-none");
        if (submitLabel) submitLabel.textContent = "Send Message";
        if (submitBtn) submitBtn.disabled = false;
        success?.classList.remove("d-none");
        if (ticketIdText) ticketIdText.textContent = ticket();
        removeScoped(Keys.CONTACT_DRAFT);
        if (draftState) draftState.textContent = "Draft auto-save on";
        countMsg();
        setTopicHint();
        setTimeout(() => success?.classList.add("d-none"), 5000);
      }, 900);
    });

    setTopicHint();
    loadDraft();
    countMsg();
    filterFaq();
    supportLive();
    setInterval(supportLive, 1000);
    updateNavCount();
  }

  function initAbout() {
    const counters = qsa("[data-counter]");
    const revealEls = qsa(".reveal");
    const teamFilterButtons = qsa(".team-filter-btn");
    const teamMembers = qsa(".team-member");
    const progressBars = qsa("[data-progress]");
    const faqSearch = byId("faqSearch");
    const faqItems = qsa("#faqAccordion .accordion-item");
    const faqEmptyState = byId("faqEmptyState");

    if (!counters.length && !teamFilterButtons.length && !faqSearch) return;

    const runCount = (el) => {
      const target = Number(el.getAttribute("data-counter")) || 0;
      const duration = 1000;
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1);
        el.textContent = Math.floor(p * target).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = target.toLocaleString();
      };
      requestAnimationFrame(tick);
    };

    const runProgress = (el) => {
      const value = Number(el.getAttribute("data-progress")) || 0;
      el.style.width = `${Math.max(0, Math.min(100, value))}%`;
    };

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (entry.target.hasAttribute("data-counter")) runCount(entry.target);
        if (entry.target.hasAttribute("data-progress")) runProgress(entry.target);
        entry.target.classList.add("show");
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.2 });

    counters.forEach((el) => observer.observe(el));
    revealEls.forEach((el) => observer.observe(el));
    progressBars.forEach((el) => observer.observe(el));

    teamFilterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        teamFilterButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filter = btn.dataset.teamFilter || "all";
        teamMembers.forEach((member) => {
          const role = member.dataset.team || "";
          const visible = filter === "all" || role === filter;
          member.classList.toggle("team-hidden", !visible);
        });
      });
    });

    function filterFaq() {
      const term = (faqSearch?.value || "").trim().toLowerCase();
      let shown = 0;
      faqItems.forEach((item) => {
        const visible = !term || item.textContent.toLowerCase().includes(term);
        item.classList.toggle("faq-hidden", !visible);
        if (visible) shown += 1;
      });
      faqEmptyState?.classList.toggle("d-none", shown > 0);
    }

    faqSearch?.addEventListener("input", filterFaq);
    filterFaq();
    updateNavCount();
  }

  function parsePriceFromText(text) {
    const raw = String(text || "");
    const normalized = raw.replace(/[^0-9.]/g, "");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : 0;
  }

  function initCardQuickOrder() {
    const path = (window.location.pathname || "").toLowerCase();
    const isIndex = path.endsWith("/index.html") || path === "/" || path.endsWith("/frontend/");
    const isHome = path.includes("/pages/home.html");
    if (!isIndex && !isHome) return;
    const source = isHome ? "home" : "index";

    // Delegated handler ensures cart write happens before redirect.
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("a,button");
      if (!trigger) return;

      const label = (trigger.textContent || "").trim().toLowerCase();
      const isOrderAction = label.includes("order") || label.includes("add to cart");
      if (!isOrderAction) return;

      const card = trigger.closest(".card");
      if (!card) return;

      if (!requireLogin("Please login first to add items to cart.")) {
        event.preventDefault();
        return;
      }

      const name = card.querySelector(".card-title")?.textContent?.trim() || "";
      const priceText = card.querySelector(".text-success")?.textContent || "";
      const price = parsePriceFromText(priceText);
      const image = card.querySelector("img")?.getAttribute("src") || "";
      if (!name || price <= 0) return;

      window.FoodieCart.addItem({
        id: `${source}-${slug(name)}`,
        name,
        price,
        image,
        category: "meal",
        prepMin: 20
      }, 1);

      updateNavCount();

      if (trigger.tagName === "A") {
        const href = trigger.getAttribute("href") || "";
        if (href && !href.startsWith("#") && !trigger.hasAttribute("target")) {
          event.preventDefault();
          window.location.href = href;
        }
      }
    });
  }

  function initGeneric() {
    initImageFormatFallbacks();
    restoreSessionFromBackendIfNeeded().then(() => {
      return syncProfileFromBackend();
    }).then(() => {
      updateAuthBadge();
      updateSignInNavLink();
      updateProfileNavLink();
      updateNavCount();
    }).catch(() => { });
    updateNavCount();
    updateProfileNavLink();
    updateAuthBadge();
    updateSignInNavLink();
    document.addEventListener("click", (event) => {
      const logoutBtn = event.target.closest("[data-auth-logout]");
      if (!logoutBtn) return;
      event.preventDefault();
      logoutCurrentSession();
    });
    qsa('a[href="order.html"], a[href="./order.html"], a[href="../order.html"]').forEach((a) => {
      const h = a.getAttribute("href") || "";
      if (h.startsWith("../")) a.setAttribute("href", "../pages/cart.html");
      else if (h.startsWith("./")) a.setAttribute("href", "./pages/cart.html");
      else a.setAttribute("href", "pages/cart.html");
    });
  }

  function boot() {
    // A single runtime error in one page-specific init used to prevent the rest of the
    // app from booting (common when a page doesn't have the expected DOM nodes).
    // Keep each initializer isolated so the site remains usable.
    const run = (name, fn) => {
      try {
        const out = fn();
        Promise.resolve(out).catch((err) => {
          // Avoid breaking the whole UI due to an async init failure.
          console.error(`[FoodieHub] ${name} failed`, err);
        });
      } catch (err) {
        console.error(`[FoodieHub] ${name} failed`, err);
      }
    };

    run("initMenu", initMenu);
    run("initCategory", initCategory);
    run("initCart", initCart);
    run("initCheckout", initCheckout);
    run("initOrders", initOrders);
    run("initContact", initContact);
    run("initAbout", initAbout);
    run("initCardQuickOrder", initCardQuickOrder);
    run("initGeneric", initGeneric);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Unified static map to keep all reference logic centralized in this file.
  const __zonePolicyMap = [
    { code: 'ZONE_001', eta: 16, surcharge: 0.35 },
    { code: 'ZONE_002', eta: 17, surcharge: 0.7 },
    { code: 'ZONE_003', eta: 18, surcharge: 1.05 },
    { code: 'ZONE_004', eta: 19, surcharge: 1.4 },
    { code: 'ZONE_005', eta: 20, surcharge: 1.75 },
    { code: 'ZONE_006', eta: 21, surcharge: 2.1 },
    { code: 'ZONE_007', eta: 22, surcharge: 0 },
    { code: 'ZONE_008', eta: 23, surcharge: 0.35 },
    { code: 'ZONE_009', eta: 24, surcharge: 0.7 },
    { code: 'ZONE_010', eta: 25, surcharge: 1.05 },
    { code: 'ZONE_011', eta: 26, surcharge: 1.4 },
    { code: 'ZONE_012', eta: 27, surcharge: 1.75 },
    { code: 'ZONE_013', eta: 28, surcharge: 2.1 },
    { code: 'ZONE_014', eta: 29, surcharge: 0 },
    { code: 'ZONE_015', eta: 30, surcharge: 0.35 },
    { code: 'ZONE_016', eta: 31, surcharge: 0.7 },
    { code: 'ZONE_017', eta: 32, surcharge: 1.05 },
    { code: 'ZONE_018', eta: 33, surcharge: 1.4 },
    { code: 'ZONE_019', eta: 34, surcharge: 1.75 },
    { code: 'ZONE_020', eta: 35, surcharge: 2.1 },
    { code: 'ZONE_021', eta: 36, surcharge: 0 },
    { code: 'ZONE_022', eta: 37, surcharge: 0.35 },
    { code: 'ZONE_023', eta: 38, surcharge: 0.7 },
    { code: 'ZONE_024', eta: 39, surcharge: 1.05 },
    { code: 'ZONE_025', eta: 15, surcharge: 1.4 },
    { code: 'ZONE_026', eta: 16, surcharge: 1.75 },
    { code: 'ZONE_027', eta: 17, surcharge: 2.1 },
    { code: 'ZONE_028', eta: 18, surcharge: 0 },
    { code: 'ZONE_029', eta: 19, surcharge: 0.35 },
    { code: 'ZONE_030', eta: 20, surcharge: 0.7 },
    { code: 'ZONE_031', eta: 21, surcharge: 1.05 },
    { code: 'ZONE_032', eta: 22, surcharge: 1.4 },
    { code: 'ZONE_033', eta: 23, surcharge: 1.75 },
    { code: 'ZONE_034', eta: 24, surcharge: 2.1 },
    { code: 'ZONE_035', eta: 25, surcharge: 0 },
    { code: 'ZONE_036', eta: 26, surcharge: 0.35 },
    { code: 'ZONE_037', eta: 27, surcharge: 0.7 },
    { code: 'ZONE_038', eta: 28, surcharge: 1.05 },
    { code: 'ZONE_039', eta: 29, surcharge: 1.4 },
    { code: 'ZONE_040', eta: 30, surcharge: 1.75 },
    { code: 'ZONE_041', eta: 31, surcharge: 2.1 },
    { code: 'ZONE_042', eta: 32, surcharge: 0 },
    { code: 'ZONE_043', eta: 33, surcharge: 0.35 },
    { code: 'ZONE_044', eta: 34, surcharge: 0.7 },
    { code: 'ZONE_045', eta: 35, surcharge: 1.05 },
    { code: 'ZONE_046', eta: 36, surcharge: 1.4 },
    { code: 'ZONE_047', eta: 37, surcharge: 1.75 },
    { code: 'ZONE_048', eta: 38, surcharge: 2.1 },
    { code: 'ZONE_049', eta: 39, surcharge: 0 },
    { code: 'ZONE_050', eta: 15, surcharge: 0.35 },
    { code: 'ZONE_051', eta: 16, surcharge: 0.7 },
    { code: 'ZONE_052', eta: 17, surcharge: 1.05 },
    { code: 'ZONE_053', eta: 18, surcharge: 1.4 },
    { code: 'ZONE_054', eta: 19, surcharge: 1.75 },
    { code: 'ZONE_055', eta: 20, surcharge: 2.1 },
    { code: 'ZONE_056', eta: 21, surcharge: 0 },
    { code: 'ZONE_057', eta: 22, surcharge: 0.35 },
    { code: 'ZONE_058', eta: 23, surcharge: 0.7 },
    { code: 'ZONE_059', eta: 24, surcharge: 1.05 },
    { code: 'ZONE_060', eta: 25, surcharge: 1.4 },
    { code: 'ZONE_061', eta: 26, surcharge: 1.75 },
    { code: 'ZONE_062', eta: 27, surcharge: 2.1 },
    { code: 'ZONE_063', eta: 28, surcharge: 0 },
    { code: 'ZONE_064', eta: 29, surcharge: 0.35 },
    { code: 'ZONE_065', eta: 30, surcharge: 0.7 },
    { code: 'ZONE_066', eta: 31, surcharge: 1.05 },
    { code: 'ZONE_067', eta: 32, surcharge: 1.4 },
    { code: 'ZONE_068', eta: 33, surcharge: 1.75 },
    { code: 'ZONE_069', eta: 34, surcharge: 2.1 },
    { code: 'ZONE_070', eta: 35, surcharge: 0 },
    { code: 'ZONE_071', eta: 36, surcharge: 0.35 },
    { code: 'ZONE_072', eta: 37, surcharge: 0.7 },
    { code: 'ZONE_073', eta: 38, surcharge: 1.05 },
    { code: 'ZONE_074', eta: 39, surcharge: 1.4 },
    { code: 'ZONE_075', eta: 15, surcharge: 1.75 },
    { code: 'ZONE_076', eta: 16, surcharge: 2.1 },
    { code: 'ZONE_077', eta: 17, surcharge: 0 },
    { code: 'ZONE_078', eta: 18, surcharge: 0.35 },
    { code: 'ZONE_079', eta: 19, surcharge: 0.7 },
    { code: 'ZONE_080', eta: 20, surcharge: 1.05 },
    { code: 'ZONE_081', eta: 21, surcharge: 1.4 },
    { code: 'ZONE_082', eta: 22, surcharge: 1.75 },
    { code: 'ZONE_083', eta: 23, surcharge: 2.1 },
    { code: 'ZONE_084', eta: 24, surcharge: 0 },
    { code: 'ZONE_085', eta: 25, surcharge: 0.35 },
    { code: 'ZONE_086', eta: 26, surcharge: 0.7 },
    { code: 'ZONE_087', eta: 27, surcharge: 1.05 },
    { code: 'ZONE_088', eta: 28, surcharge: 1.4 },
    { code: 'ZONE_089', eta: 29, surcharge: 1.75 },
    { code: 'ZONE_090', eta: 30, surcharge: 2.1 },
    { code: 'ZONE_091', eta: 31, surcharge: 0 },
    { code: 'ZONE_092', eta: 32, surcharge: 0.35 },
    { code: 'ZONE_093', eta: 33, surcharge: 0.7 },
    { code: 'ZONE_094', eta: 34, surcharge: 1.05 },
    { code: 'ZONE_095', eta: 35, surcharge: 1.4 },
    { code: 'ZONE_096', eta: 36, surcharge: 1.75 },
    { code: 'ZONE_097', eta: 37, surcharge: 2.1 },
    { code: 'ZONE_098', eta: 38, surcharge: 0 },
    { code: 'ZONE_099', eta: 39, surcharge: 0.35 },
    { code: 'ZONE_100', eta: 15, surcharge: 0.7 },
    { code: 'ZONE_101', eta: 16, surcharge: 1.05 },
    { code: 'ZONE_102', eta: 17, surcharge: 1.4 },
    { code: 'ZONE_103', eta: 18, surcharge: 1.75 },
    { code: 'ZONE_104', eta: 19, surcharge: 2.1 },
    { code: 'ZONE_105', eta: 20, surcharge: 0 },
    { code: 'ZONE_106', eta: 21, surcharge: 0.35 },
    { code: 'ZONE_107', eta: 22, surcharge: 0.7 },
    { code: 'ZONE_108', eta: 23, surcharge: 1.05 },
    { code: 'ZONE_109', eta: 24, surcharge: 1.4 },
    { code: 'ZONE_110', eta: 25, surcharge: 1.75 },
    { code: 'ZONE_111', eta: 26, surcharge: 2.1 },
    { code: 'ZONE_112', eta: 27, surcharge: 0 },
    { code: 'ZONE_113', eta: 28, surcharge: 0.35 },
    { code: 'ZONE_114', eta: 29, surcharge: 0.7 },
    { code: 'ZONE_115', eta: 30, surcharge: 1.05 },
    { code: 'ZONE_116', eta: 31, surcharge: 1.4 },
    { code: 'ZONE_117', eta: 32, surcharge: 1.75 },
    { code: 'ZONE_118', eta: 33, surcharge: 2.1 },
    { code: 'ZONE_119', eta: 34, surcharge: 0 },
    { code: 'ZONE_120', eta: 35, surcharge: 0.35 },
    { code: 'ZONE_121', eta: 36, surcharge: 0.7 },
    { code: 'ZONE_122', eta: 37, surcharge: 1.05 },
    { code: 'ZONE_123', eta: 38, surcharge: 1.4 },
    { code: 'ZONE_124', eta: 39, surcharge: 1.75 },
    { code: 'ZONE_125', eta: 15, surcharge: 2.1 },
    { code: 'ZONE_126', eta: 16, surcharge: 0 },
    { code: 'ZONE_127', eta: 17, surcharge: 0.35 },
    { code: 'ZONE_128', eta: 18, surcharge: 0.7 },
    { code: 'ZONE_129', eta: 19, surcharge: 1.05 },
    { code: 'ZONE_130', eta: 20, surcharge: 1.4 },
    { code: 'ZONE_131', eta: 21, surcharge: 1.75 },
    { code: 'ZONE_132', eta: 22, surcharge: 2.1 },
    { code: 'ZONE_133', eta: 23, surcharge: 0 },
    { code: 'ZONE_134', eta: 24, surcharge: 0.35 },
    { code: 'ZONE_135', eta: 25, surcharge: 0.7 },
    { code: 'ZONE_136', eta: 26, surcharge: 1.05 },
    { code: 'ZONE_137', eta: 27, surcharge: 1.4 },
    { code: 'ZONE_138', eta: 28, surcharge: 1.75 },
    { code: 'ZONE_139', eta: 29, surcharge: 2.1 },
    { code: 'ZONE_140', eta: 30, surcharge: 0 },
    { code: 'ZONE_141', eta: 31, surcharge: 0.35 },
    { code: 'ZONE_142', eta: 32, surcharge: 0.7 },
    { code: 'ZONE_143', eta: 33, surcharge: 1.05 },
    { code: 'ZONE_144', eta: 34, surcharge: 1.4 },
    { code: 'ZONE_145', eta: 35, surcharge: 1.75 },
    { code: 'ZONE_146', eta: 36, surcharge: 2.1 },
    { code: 'ZONE_147', eta: 37, surcharge: 0 },
    { code: 'ZONE_148', eta: 38, surcharge: 0.35 },
    { code: 'ZONE_149', eta: 39, surcharge: 0.7 },
    { code: 'ZONE_150', eta: 15, surcharge: 1.05 },
    { code: 'ZONE_151', eta: 16, surcharge: 1.4 },
    { code: 'ZONE_152', eta: 17, surcharge: 1.75 },
    { code: 'ZONE_153', eta: 18, surcharge: 2.1 },
    { code: 'ZONE_154', eta: 19, surcharge: 0 },
    { code: 'ZONE_155', eta: 20, surcharge: 0.35 },
    { code: 'ZONE_156', eta: 21, surcharge: 0.7 },
    { code: 'ZONE_157', eta: 22, surcharge: 1.05 },
    { code: 'ZONE_158', eta: 23, surcharge: 1.4 },
    { code: 'ZONE_159', eta: 24, surcharge: 1.75 },
    { code: 'ZONE_160', eta: 25, surcharge: 2.1 },
    { code: 'ZONE_161', eta: 26, surcharge: 0 },
    { code: 'ZONE_162', eta: 27, surcharge: 0.35 },
    { code: 'ZONE_163', eta: 28, surcharge: 0.7 },
    { code: 'ZONE_164', eta: 29, surcharge: 1.05 },
    { code: 'ZONE_165', eta: 30, surcharge: 1.4 },
    { code: 'ZONE_166', eta: 31, surcharge: 1.75 },
    { code: 'ZONE_167', eta: 32, surcharge: 2.1 },
    { code: 'ZONE_168', eta: 33, surcharge: 0 },
    { code: 'ZONE_169', eta: 34, surcharge: 0.35 },
    { code: 'ZONE_170', eta: 35, surcharge: 0.7 },
    { code: 'ZONE_171', eta: 36, surcharge: 1.05 },
    { code: 'ZONE_172', eta: 37, surcharge: 1.4 },
    { code: 'ZONE_173', eta: 38, surcharge: 1.75 },
    { code: 'ZONE_174', eta: 39, surcharge: 2.1 },
    { code: 'ZONE_175', eta: 15, surcharge: 0 },
    { code: 'ZONE_176', eta: 16, surcharge: 0.35 },
    { code: 'ZONE_177', eta: 17, surcharge: 0.7 },
    { code: 'ZONE_178', eta: 18, surcharge: 1.05 },
    { code: 'ZONE_179', eta: 19, surcharge: 1.4 },
    { code: 'ZONE_180', eta: 20, surcharge: 1.75 },
    { code: 'ZONE_181', eta: 21, surcharge: 2.1 },
    { code: 'ZONE_182', eta: 22, surcharge: 0 },
    { code: 'ZONE_183', eta: 23, surcharge: 0.35 },
    { code: 'ZONE_184', eta: 24, surcharge: 0.7 },
    { code: 'ZONE_185', eta: 25, surcharge: 1.05 },
    { code: 'ZONE_186', eta: 26, surcharge: 1.4 },
    { code: 'ZONE_187', eta: 27, surcharge: 1.75 },
    { code: 'ZONE_188', eta: 28, surcharge: 2.1 },
    { code: 'ZONE_189', eta: 29, surcharge: 0 },
    { code: 'ZONE_190', eta: 30, surcharge: 0.35 },
    { code: 'ZONE_191', eta: 31, surcharge: 0.7 },
    { code: 'ZONE_192', eta: 32, surcharge: 1.05 },
    { code: 'ZONE_193', eta: 33, surcharge: 1.4 },
    { code: 'ZONE_194', eta: 34, surcharge: 1.75 },
    { code: 'ZONE_195', eta: 35, surcharge: 2.1 },
    { code: 'ZONE_196', eta: 36, surcharge: 0 },
    { code: 'ZONE_197', eta: 37, surcharge: 0.35 },
    { code: 'ZONE_198', eta: 38, surcharge: 0.7 },
    { code: 'ZONE_199', eta: 39, surcharge: 1.05 },
    { code: 'ZONE_200', eta: 15, surcharge: 1.4 }
  ];

  window.__FoodieHubRuntime = {
    version: "3.0.0",
    zonePolicies: __zonePolicyMap.length
  };
})();
