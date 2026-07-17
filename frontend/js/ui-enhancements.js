(function () {
  "use strict";

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function pathPrefix() {
    const path = (window.location.pathname || "").toLowerCase();
    if (path.includes("/pages/category/")) return "../../";
    if (path.includes("/pages/")) return "../";
    if (path.includes("/account/")) return "../";
    return "";
  }

  function normalizePath(value) {
    let path = String(value || "").toLowerCase();
    if (!path) return "/";
    path = path.replace(/\\/g, "/");
    if (path.endsWith("/")) path += "index.html";
    return path;
  }

  function enforceDarkTheme() {
    document.documentElement.setAttribute("data-theme", "dark");
    sessionStorage.removeItem("foodiehub_theme_v1");
  }

  function initNavActiveState() {
    const currentPath = normalizePath(window.location.pathname);
    qsa(".navbar .nav-link[href]").forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;
      let targetPath = "";
      try {
        targetPath = normalizePath(new URL(href, window.location.href).pathname);
      } catch (_error) {
        return;
      }
      const active = targetPath === currentPath;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function initSkipLink() {
    if (byId("content-start")) return;
    const main = document.querySelector("main") || document.querySelector("#top") || document.body.firstElementChild;
    if (main && !main.id) main.id = "content-start";

    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#content-start";
    skip.textContent = "Skip to content";
    document.body.insertBefore(skip, document.body.firstChild);
  }

  function initLazyImages() {
    const images = qsa("img");
    images.forEach((img, index) => {
      if (!img.hasAttribute("loading")) {
        img.setAttribute("loading", index < 2 ? "eager" : "lazy");
      }
      if (!img.hasAttribute("decoding")) {
        img.setAttribute("decoding", "async");
      }
    });
  }

  function initRevealMotion() {
    const targets = qsa("section, .card, .orders-surface, .cart-surface, .checkout-surface, .veg-panel, .auth-shell")
      .filter((node) => !node.closest("#googleChooserModal"));
    targets.forEach((node) => node.classList.add("fx-reveal"));

    if (!("IntersectionObserver" in window)) {
      targets.forEach((node) => node.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    targets.forEach((node) => observer.observe(node));
  }

  function initToastSystem() {
    let wrap = byId("foodieToastWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "foodie-toast-wrap";
      wrap.id = "foodieToastWrap";
      document.body.appendChild(wrap);
    }

    function toast(message, type, timeout) {
      const msg = String(message || "").trim();
      if (!msg) return;
      const toastType = type === "success" || type === "error" ? type : "info";
      const ttl = Number(timeout) > 0 ? Number(timeout) : 2200;
      const node = document.createElement("div");
      node.className = `foodie-toast ${toastType}`;
      node.textContent = msg;
      wrap.appendChild(node);
      setTimeout(() => {
        node.style.opacity = "0";
        node.style.transform = "translateY(8px)";
        setTimeout(() => node.remove(), 180);
      }, ttl);
    }

    window.FoodieUI = Object.assign({}, window.FoodieUI || {}, { toast });
  }

  function initNetworkStatus() {
    if (byId("uiNetworkBadge")) return;
    const badge = document.createElement("div");
    badge.id = "uiNetworkBadge";
    badge.className = "ui-network-badge";
    document.body.appendChild(badge);

    function sync(isEvent) {
      const online = navigator.onLine;
      badge.textContent = online ? "Online" : "Offline";
      badge.classList.toggle("offline", !online);

      if (!isEvent || !window.FoodieUI || typeof window.FoodieUI.toast !== "function") return;
      window.FoodieUI.toast(online ? "Back online" : "No internet connection", online ? "success" : "error");
    }

    window.addEventListener("online", () => sync(true));
    window.addEventListener("offline", () => sync(true));
    sync(false);
  }

  function initQuickSearchHotkey() {
    const findSearch = () => byId("menuSearch") || byId("searchInput") || byId("faqSearch");
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      const input = findSearch();
      if (!input) return;
      event.preventDefault();
      input.focus();
      if (typeof input.select === "function") input.select();
    });
  }

  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const host = String(window.location.hostname || "").toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (isLocal) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      }).catch(() => { });
      return;
    }
    const prefix = pathPrefix();
    const swPath = `${prefix}sw.js`;
    navigator.serviceWorker.register(swPath).then((reg) => {
      // If a new SW takes control, reload once to pick up fresh cached assets.
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      // Proactively check for updates on each visit.
      try { reg.update(); } catch (_e) { }
    }).catch(() => { });
  }

  function boot() {
    enforceDarkTheme();
    initNavActiveState();
    initSkipLink();
    initLazyImages();
    initRevealMotion();
    initToastSystem();
    initNetworkStatus();
    initQuickSearchHotkey();
    initServiceWorker();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

