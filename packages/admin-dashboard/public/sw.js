// AkibaMiles Admin service worker — conservative by design.
//
// Mirrors src/lib/sw-cache-policy.ts (tested in src/__tests__/sw-cache-rules.test.ts).
// Service workers can't import from src/, so this file duplicates that
// decision logic rather than bundling it; keep the two in sync by hand.
//
// Default is "don't cache" (spec §11.2): authenticated HTML/RSC, /api/**,
// evidence/receipt/signed-URL responses, and mutation requests are never
// written to Cache Storage. Only revisioned static assets/icons (cache-first)
// and the public login shell (stale-while-revalidate) are cached at all.

const STATIC_CACHE = "akiba-admin-static-v1";

const SIGNED_URL_MARKERS = ["signature=", "token=", "expires=", "x-amz-", "sig="];

function isSignedUrl(search) {
  const query = search.replace(/^\?/, "").toLowerCase();
  return SIGNED_URL_MARKERS.some((marker) => query.includes(marker));
}

function getCacheStrategy(pathname, search) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/data/")) return "network-only";
  if (isSignedUrl(search)) return "network-only";
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/")) return "cache-first";
  if (pathname === "/login" || pathname.startsWith("/svg/")) return "stale-while-revalidate";
  return "network-only";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(["/offline.html"])),
  );
  // Deliberately do NOT self.skipWaiting() here — a new worker stays in the
  // "waiting" state until the client explicitly approves activation via the
  // SKIP_WAITING message below, so UpdateAvailableToast has something real
  // to detect and a deliberate Reload to gate (spec §11.4).
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
    ),
  );
  // clients.claim() is required so an approved update (SKIP_WAITING) can
  // actually take control of the already-open tab — but claim() also fires
  // "controllerchange" on the very first-ever registration (no real update,
  // nothing to reload for), so the client only reacts to that event when it
  // explicitly requested the skip (see UpdateAvailableToast's guard).
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  const strategy = getCacheStrategy(url.pathname, url.search);

  if (strategy === "network-only") {
    // Explicitly do not call event.respondWith — let the browser handle it
    // normally, so nothing here can accidentally serve a stale authenticated
    // response or a stale write-action result (spec §11.2/§11.3).
    if (event.request.mode === "navigate") {
      event.respondWith(
        fetch(event.request).catch(() => caches.match("/offline.html")),
      );
    }
    return;
  }

  if (strategy === "cache-first") {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (strategy === "stale-while-revalidate") {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        });
        return cached ?? fetchPromise;
      }),
    );
  }
});
