/* REOS service worker.
 *
 * Goals:
 *  - Network-first for all navigation + API requests (always fresh data)
 *  - Cache-first for hashed _next/static assets (immutable by design)
 *  - Offline fallback HTML when the network is fully down
 *  - Web Push handler that opens the right tab on click
 *
 * Cache version is bumped at deploy time via a build-time replace if
 * needed; for now, "v1" is fine because Next's _next/static URLs are
 * hashed — old hashes age out of the cache naturally.
 */

const CACHE_NAME = "reos-v1";
const OFFLINE_URL = "/offline.html";

// Pre-cache the offline shell + the home icon. Everything else gets
// added on-demand as users browse.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]);
      } catch (err) {
        // Pre-cache best-effort; don't block install on a flaky network.
        // eslint-disable-next-line no-console
        console.warn("[SW] precache failed:", err);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET — POSTs to /api never get cached (would corrupt data)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip cross-origin (Stripe Checkout, OpenAI proxies, etc.)
  if (url.origin !== self.location.origin) return;

  // Hashed Next static assets — cache-first, fall back to network
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Navigations — network first, offline page as fallback
  const isNav =
    req.mode === "navigate" ||
    (req.headers.get("accept") ?? "").includes("text/html");
  if (isNav) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ?? new Response("Offline", { status: 503 })
          );
        }
      })(),
    );
    return;
  }

  // Everything else — pure network. Don't cache API calls.
});

// === Push notifications ===
// Server sends payload as JSON: { title, body, url?, tag?, icon? }
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "REOS", body: event.data.text() };
  }
  const title = payload.title || "REOS";
  const opts = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "reos",
    data: { url: payload.url || "/today" },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/today";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of all) {
        if (c.url.includes(url) && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })(),
  );
});
