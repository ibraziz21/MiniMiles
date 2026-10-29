/**
 * Public assets only. Never persist HTML, RSC, API responses or session data.
 * An offline navigation receives a neutral page, never a previous user's Pass.
 * Account-bound offline Pass storage requires a separate security design.
 */
const ASSET_CACHE = "akiba-public-assets-v2";

async function purgeLegacyCaches() {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith("akiba-") && key !== ASSET_CACHE)
    .map((key) => caches.delete(key)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Includes akiba-pages-v1 and the old asset cache, whose permissive URL
    // classifier could also have stored HTML. Do not search other caches.
    await purgeLegacyCaches();
    await self.clients.claim();
  })());
});

function isPublicAsset(url) {
  return url.pathname.startsWith("/_next/static/") ||
    (/^\/(fonts|icons)\/.+\.(woff2?|ttf|otf|png|svg|ico|webp)$/.test(url.pathname)) ||
    url.pathname === "/logo.svg";
}

function cacheableAsset(response) {
  return response.ok && !response.redirected &&
    !/private|no-store/i.test(response.headers.get("Cache-Control") || "") &&
    /^(text\/css|(?:text|application)\/(?:javascript|x-javascript)|image\/|font\/|application\/(?:font|x-font|vnd.ms-fontobject|octet-stream))/.test(response.headers.get("Content-Type") || "");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Check mode before asset URLs: navigating to /icons/... is still HTML.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      await purgeLegacyCaches();
      try {
        // Avoid the browser HTTP cache as well as Cache Storage.
        return await fetch(request, { cache: "no-store" });
      } catch {
        return new Response(
          "<!doctype html><html lang='en'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Offline | Akiba</title><body style='font-family:sans-serif;text-align:center;padding:40px'><h1>You're offline</h1><p>Reconnect to open Akiba.</p></body></html>",
          { status: 503, headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
          } },
        );
      }
    })());
    return;
  }

  // RSC/prefetch payloads and all API/auth requests stay network-only, even
  // if a crafted URL looks like an asset. Never use a global caches.match.
  if (request.headers.has("RSC") || request.headers.has("Next-Router-Prefetch") ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") ||
      !isPublicAsset(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached && cacheableAsset(cached)) return cached;
    if (cached) await cache.delete(request);
    // Public assets must not vary by the signed-in account.
    const response = await fetch(request, { credentials: "omit" });
    if (cacheableAsset(response)) await cache.put(request, response.clone());
    return response;
  })());
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
