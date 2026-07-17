(function () {
  "use strict";

  // Minimal auth helper used by:
  // - frontend/Account/form.html
  // - frontend/Account/admin-panel.html
  // - frontend/js/app.js (logout integration)

  const storage = window.sessionStorage;

  const Keys = {
    SESSION: "foodiehub_auth_session_v3",
    PENDING_SIGNUP: "foodiehub_pending_signup_v3",
    GOOGLE_ACCOUNTS: "foodiehub_google_accounts_v2",
    CSRF: "foodiehub_csrf_token_v1"
  };

  const DefaultGoogleAccounts = [
    { id: "g-001", name: "Rahul Sharma", email: "rahul.sharma@gmail.com" },
    { id: "g-002", name: "Ananya Singh", email: "ananya.singh@gmail.com" }
  ];

  const BackendState = { checked: false, enabled: false };

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (_e) { return fallback; }
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function normalizePhone(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizeAge(value) {
    const age = parseInt(String(value || "").trim(), 10);
    return Number.isFinite(age) ? age : NaN;
  }

  function nextId(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  }

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
    return String(storage.getItem(Keys.CSRF) || "").trim();
  }

  function writeCsrfToken(token) {
    const value = String(token || "").trim();
    if (!value) return;
    storage.setItem(Keys.CSRF, value);
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
    const target = `${apiBaseUrl()}${p.startsWith("/") ? "" : "/"}${p}`;
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
    try { payload = await response.json(); } catch (_e) { payload = null; }

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
    } catch (_e) {
      BackendState.enabled = false;
    }
    return BackendState.enabled;
  }

  function getSession() {
    let session = safeParse(storage.getItem(Keys.SESSION), null);

    if (!session || typeof session !== "object") return null;
    const email = normalizeEmail(session.email || "");
    if (!email) return null;

    const role = session.role === "admin" ? "admin" : session.role === "guest" ? "guest" : "user";
    return {
      id: String(session.id || ""),
      username: String(session.username || ""),
      name: String(session.name || "User"),
      email,
      role,
      phone: normalizePhone(session.phone || ""),
      provider: String(session.provider || "password"),
      loginAt: String(session.loginAt || new Date().toISOString())
    };
  }

  function setSession(user) {
    const role = user && (user.role === "admin" ? "admin" : user.role === "guest" ? "guest" : "user");
    const email = normalizeEmail(user && user.email);
    const finalEmail = email || (role === "guest" ? `guest-${Date.now()}@foodiehub.local` : "");
    if (!finalEmail) return null;

    const session = {
      id: String((user && user.id) || ""),
      username: String((user && user.username) || ""),
      name: String((user && user.name) || "User"),
      email: finalEmail,
      role,
      phone: normalizePhone(user && user.phone || ""),
      provider: String((user && user.provider) || "password"),
      loginAt: new Date().toISOString()
    };

    storage.setItem(Keys.SESSION, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    storage.removeItem(Keys.SESSION);
  }

  async function tryRestoreSessionFromBackend() {
    const enabled = await detectBackend();
    if (!enabled) return null;
    try {
      const response = await apiRequest("/users/me", { method: "GET" });
      if (!response || !response.success || !response.data) return null;
      const me = response.data;
      return setSession({
        id: String(me.id || ""),
        username: String(me.username || ""),
        name: String(me.name || "User"),
        email: String(me.email || ""),
        phone: String(me.phone || ""),
        role: me.role === "admin" ? "admin" : me.role === "guest" ? "guest" : "user",
        provider: "server-session"
      });
    } catch (_e) {
      return null;
    }
  }

  async function login(identifier, password, expectedRole) {
    const enabled = await detectBackend();
    if (!enabled) return { ok: false, message: "Backend is required for login." };

    const loginValue = String(identifier || "").trim();
    const p = String(password || "");
    const role = expectedRole === "admin" ? "admin" : "user";

    if (!loginValue || !p) return { ok: false, message: "Enter username/email and password." };

    try {
      const response = await apiRequest("/users/login", {
        method: "POST",
        body: { email: loginValue, password: p }
      });

      if (!response || !response.success || !response.data) {
        return { ok: false, message: (response && response.message) || "Login failed." };
      }

      const account = response.data;
      const accountRole = account.role === "admin" ? "admin" : "user";
      if (accountRole !== role) {
        return { ok: false, message: "Wrong login portal for this account role." };
      }

      const typed = String(loginValue || "").trim().toLowerCase();
      const fallbackEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)
        ? typed
        : (typed ? (typed + "@foodiehub.local") : "");

      const session = setSession({
        id: String(account.id || ""),
        username: String(account.username || ""),
        name: String(account.name || "User"),
        email: String(account.email || fallbackEmail),
        phone: String(account.phone || ""),
        role: accountRole,
        provider: "password"
      });

      return { ok: true, message: response.message || "Login successful.", session };
    } catch (e) {
      return { ok: false, message: e && e.message ? e.message : "Login failed." };
    }
  }

  function normalizeGoogleAccount(account) {
    const a = account || {};
    const email = normalizeEmail(a.email || "");
    const name = normalizeName(a.name || email || "Google User");
    return { id: String(a.id || nextId("g")).trim(), name, email };
  }

  function readGoogleAccounts() {
    const list = safeParse(storage.getItem(Keys.GOOGLE_ACCOUNTS), []);
    const source = Array.isArray(list) && list.length ? list : DefaultGoogleAccounts;
    const map = {};
    source.map(normalizeGoogleAccount).forEach((a) => { if (a.email) map[a.email] = a; });
    return Object.keys(map).map((k) => map[k]);
  }

  function writeGoogleAccounts(accounts) {
    const normalized = Array.isArray(accounts)
      ? accounts.map(normalizeGoogleAccount).filter((a) => a.email)
      : [];
    const map = {};
    normalized.forEach((a) => { map[a.email] = a; });
    storage.setItem(Keys.GOOGLE_ACCOUNTS, JSON.stringify(Object.keys(map).map((k) => map[k])));
  }

  function addGoogleAccount(name, email) {
    const n = normalizeName(name);
    const e = normalizeEmail(email);

    if (!n || !e) return { ok: false, message: "Enter name and email." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, message: "Enter a valid Google email." };

    const accounts = readGoogleAccounts();
    if (accounts.some((a) => a.email === e)) return { ok: false, message: "Google account already exists in chooser." };

    const account = normalizeGoogleAccount({ id: nextId("g"), name: n, email: e });
    accounts.push(account);
    writeGoogleAccounts(accounts);
    return { ok: true, message: "Google account added.", account };
  }

  function validateSignupProfile(name, age, email, phone) {
    const n = normalizeName(name);
    const a = normalizeAge(age);
    const e = normalizeEmail(email);
    const p = normalizePhone(phone);

    if (!n || !Number.isFinite(a) || !e || !p) {
      return { ok: false, message: "Fill all fields: name, age, email, and phone." };
    }
    if (n.length < 2) return { ok: false, message: "Enter a valid full name." };
    if (a < 13 || a > 100) return { ok: false, message: "Age should be between 13 and 100." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, message: "Enter a valid email address." };
    if (p.length < 10 || p.length > 15) return { ok: false, message: "Enter a valid phone number." };

    return { ok: true, value: { name: n, age: a, email: e, phone: p } };
  }

  function getPendingSignup() {
    const pending = safeParse(storage.getItem(Keys.PENDING_SIGNUP), null);
    if (!pending || typeof pending !== "object") return null;
    const expiresAt = Number(pending.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      storage.removeItem(Keys.PENDING_SIGNUP);
      return null;
    }
    return {
      name: normalizeName(pending.name || ""),
      age: normalizeAge(pending.age),
      email: normalizeEmail(pending.email || ""),
      phone: normalizePhone(pending.phone || ""),
      expiresAt
    };
  }

  function clearPendingSignup() {
    storage.removeItem(Keys.PENDING_SIGNUP);
  }

  async function sendSignupOtp(name, age, email, phone) {
    const enabled = await detectBackend();
    if (!enabled) return { ok: false, message: "Backend is required for OTP signup." };

    const checked = validateSignupProfile(name, age, email, phone);
    if (!checked.ok) return checked;
    const profile = checked.value;

    try {
      const response = await apiRequest("/users/signup/send-otp", {
        method: "POST",
        body: {
          name: profile.name,
          age: profile.age,
          email: profile.email,
          phone: profile.phone
        }
      });

      if (!response || !response.success) {
        return { ok: false, message: (response && response.message) || "Failed to send OTP." };
      }

      const ttl = Number(response.data && response.data.expires_in_minutes) || 10;
      const expiresAt = Date.now() + ttl * 60 * 1000;
      storage.setItem(Keys.PENDING_SIGNUP, JSON.stringify({
        name: profile.name,
        age: profile.age,
        email: profile.email,
        phone: profile.phone,
        expiresAt
      }));

      return {
        ok: true,
        message: response.message || "OTP sent to your email address.",
        maskedPhone: String((response.data && response.data.masked_phone) || ""),
        maskedEmail: String((response.data && response.data.masked_email) || profile.email),
        demoOtp: String((response.data && response.data.demo_otp) || ""),
        expiresAt
      };
    } catch (e) {
      return { ok: false, message: e && e.message ? e.message : "Failed to send OTP." };
    }
  }

  async function resendSignupOtp() {
    const pending = getPendingSignup();
    if (!pending) return { ok: false, message: "No active OTP request. Fill signup details first." };
    return sendSignupOtp(pending.name, pending.age, pending.email, pending.phone);
  }

  async function verifySignupOtp(code) {
    const enabled = await detectBackend();
    if (!enabled) return { ok: false, message: "Backend is required for OTP verification." };

    const pending = getPendingSignup();
    if (!pending) return { ok: false, message: "OTP expired or not requested. Please request OTP again." };

    const typed = String(code || "").trim();
    if (!/^\d{6}$/.test(typed)) return { ok: false, message: "Enter a valid 6-digit OTP." };

    try {
      const response = await apiRequest("/users/signup/verify-otp", {
        method: "POST",
        body: { email: pending.email, phone: pending.phone, otp: typed }
      });

      if (!response || !response.success || !response.data) {
        return { ok: false, message: (response && response.message) || "Failed to verify OTP." };
      }

      const account = response.data;
      clearPendingSignup();
      const session = setSession({
        id: String(account.id || ""),
        username: String(account.username || ""),
        name: String(account.name || pending.name || "User"),
        email: String(account.email || pending.email),
        phone: String(account.phone || pending.phone || ""),
        role: account.role === "admin" ? "admin" : "user",
        provider: "email-otp"
      });
      return { ok: true, message: response.message || "OTP verified. Login successful.", session };
    } catch (e) {
      return { ok: false, message: e && e.message ? e.message : "Failed to verify OTP." };
    }
  }

  function startGoogleOAuth() {
    window.location.href = `${apiBaseUrl()}/users/google/start`;
    return { ok: true, message: "Redirecting to Google..." };
  }

  function continueWithGoogle(_selectedEmail) {
    return startGoogleOAuth();
  }

  async function verifyGoogleOtp(email, otp) {
    const enabled = await detectBackend();
    if (!enabled) return { ok: false, message: "Backend is required for Google OTP verification." };

    const e = normalizeEmail(email);
    const code = String(otp || "").trim();
    if (!e || !/^\d{6}$/.test(code)) return { ok: false, message: "Enter valid email and 6-digit OTP." };

    try {
      const response = await apiRequest("/users/google/verify-otp", {
        method: "POST",
        body: { email: e, otp: code }
      });

      if (!response || !response.success || !response.data) {
        return { ok: false, message: (response && response.message) || "Failed to verify OTP." };
      }

      const account = response.data;
      const session = setSession({
        id: String(account.id || ""),
        username: String(account.username || ""),
        name: String(account.name || "User"),
        email: String(account.email || e),
        phone: String(account.phone || ""),
        role: account.role === "admin" ? "admin" : "user",
        provider: "google-otp"
      });
      return { ok: true, message: response.message || "Login successful.", session };
    } catch (err) {
      return { ok: false, message: err && err.message ? err.message : "Failed to verify OTP." };
    }
  }

  function continueAsGuest() {
    const guest = {
      id: nextId("guest"),
      username: "guest",
      name: "Guest User",
      email: `guest-${Date.now()}@foodiehub.local`,
      phone: "",
      role: "guest",
      provider: "guest"
    };

    // Prefer server-backed guest if available; fall back to local session.
    return detectBackend().then((enabled) => {
      if (!enabled) {
        const session = setSession(guest);
        return { ok: true, message: "Guest session started.", session };
      }
      return apiRequest("/users/guest", { method: "POST", body: {} }).then((response) => {
        if (!response || !response.success || !response.data) {
          const session = setSession(guest);
          return { ok: true, message: "Guest session started.", session };
        }
        const me = response.data;
        const session = setSession({
          id: String(me.id || guest.id),
          username: String(me.username || "guest"),
          name: String(me.name || guest.name),
          email: String(me.email || guest.email),
          phone: String(me.phone || ""),
          role: "guest",
          provider: "guest"
        });
        return { ok: true, message: response.message || "Guest session started.", session };
      });
    }).catch(() => {
      const session = setSession(guest);
      return { ok: true, message: "Guest session started.", session };
    });
  }

  function logout(redirectTo) {
    clearSession();
    clearPendingSignup();

    // Best-effort: clear server session too.
    detectBackend().then((enabled) => {
      if (!enabled) return;
      apiRequest("/users/logout", { method: "POST" }).catch(() => { });
    }).catch(() => { });

    if (typeof redirectTo === "string" && redirectTo.trim()) {
      window.location.href = redirectTo;
    }
  }

  function requireRole(role, redirectTo) {
    const required = role === "admin" ? "admin" : "user";
    const session = getSession();
    const ok = !!(session && session.role === required);
    if (!ok && redirectTo) window.location.href = redirectTo;
    return ok;
  }

  window.FoodieAuth = {
    keys: Keys,
    getSession,
    login,
    readGoogleAccounts,
    addGoogleAccount,
    getPendingSignup,
    clearPendingSignup,
    sendSignupOtp,
    resendSignupOtp,
    verifySignupOtp,
    startGoogleOAuth,
    continueWithGoogle,
    verifyGoogleOtp,
    continueAsGuest,
    logout,
    requireRole,
    detectBackend,
    ensureCsrfToken
  };

  detectBackend().then((enabled) => {
    if (!enabled) return;
    if (!getSession()) {
      tryRestoreSessionFromBackend().catch(() => { });
    }
  }).catch(() => { });
})();
