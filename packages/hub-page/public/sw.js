/**
 * Akiba Hub service worker.
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
            "<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h2>You're offline</h2><p>Reconnect to load Akiba Hub.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html" } },
          );
        }
      })(),
    );
  }
});
