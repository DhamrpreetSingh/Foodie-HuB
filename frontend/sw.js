// Bump this whenever changing cached assets so clients pick up updates immediately.
const CACHE_NAME = "foodiehub-static-v14";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./css/advanced-ui.css",
  "./js/ui-enhancements.js",
  "./bootstrap/bootstrap.min.css",
  "./bootstrap/bootstrap.bundle.min.js",
  "./assets/Main/logo.webp",
  "./pages/home.html",
  "./pages/about.html",
  "./pages/contact.html",
  "./pages/menu.html",
  "./pages/cart.html",
  "./pages/checkout.html",
  "./pages/orders.html",
  "./pages/profile.html",
  "./js/profile.js?v=20260215f",
  "./pages/category/vegetarian.html",
  "./pages/category/nonveg.html",
  "./pages/category/desserts.html",
  "./Account/form.html",
  "./Account/admin-panel.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => { })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const req = event.request;
  const isNavigate = req.mode === "navigate";
  const url = new URL(req.url);

  // Always fetch HTML/navigation fresh so checkout/auth logic updates immediately.
  if (isNavigate || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { });
          return networkResponse;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            return caches.match("./index.html");
          })
        )
    );
    return;
  }

  // Never cache JS. It is the #1 source of "old logic" bugs when a SW is installed.
  // Always go to network for scripts, with a cached fallback only if offline.
  if (url.pathname.includes("/js/")) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { });
        return networkResponse;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (isNavigate) return caches.match("./index.html");
          return new Response("Offline", { status: 503, statusText: "Offline" });
        })
      )
  );
});

