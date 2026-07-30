/**
 * Akiba Pass service worker.
 *
 * Goal: the Akiba Pass QR on /me must render at the till even with no signal.
 *
 * Strategy:
 *  - Navigations (HTML): network-first with cache fallback. Every successful
 *    page load refreshes the cache, so offline shows the last good version
 *    (including the user's pass ID → QR renders from bundled JS).
 *  - Static assets (/_next/static, fonts, icons): cache-first — immutable.
 *  - Everything else (API calls, auth): network only, never cached.
 */
const PAGE_CACHE = "akiba-pages-v1";
const ASSET_CACHE = "akiba-assets-v1";
const OFFLINE_PATHS = ["/me", "/"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== PAGE_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/logo.svg" ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch API or auth routes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // Page navigations: network-first, cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          // Last resort: any cached offline-capable page
          for (const path of OFFLINE_PATHS) {
            const fallback = await caches.match(path);
            if (fallback) return fallback;
          }
          return new Response(
            "<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h2>You're offline</h2><p>Reconnect to load Akiba Pass.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html" } },
          );
        }
      })(),
    );
  }
});

// ── Web Push (web-push-notifications-spec.md §9) ───────────────────────────
const FALLBACK_NOTIFICATION = {
  title: "Akiba update",
  body: "You have a new Akiba update.",
  url: "/me/notifications",
};

function isRelativeSameOriginPath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//");
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }

  const valid = payload && payload.v === 1 && isRelativeSameOriginPath(payload.url);
  const title = valid ? payload.title : FALLBACK_NOTIFICATION.title;
  const body = valid ? payload.body : FALLBACK_NOTIFICATION.body;
  const url = valid ? payload.url : FALLBACK_NOTIFICATION.url;
  const tag = valid && payload.notificationId ? `notification:${payload.notificationId}` : "notification:fallback";

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag,
        data: { url },
      });

      if ("setAppBadge" in self.navigator) {
        try {
          await self.navigator.setAppBadge();
        } catch {
          // Not supported/allowed on this platform; not fatal.
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const url = (event.notification.data && event.notification.data.url) || "/me/notifications";
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) {
          await existing.navigate(url);
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
