// Registers the service worker only in production — never in dev, which
// avoids the classic Next.js dev-mode stale-SW debugging trap (spec §11).

export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  function register() {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure is non-fatal — the app functions fully without a service worker.
    });
  }

  // document.readyState can already be "complete" by the time this effect
  // runs (the native "load" event fires independently of React hydration
  // timing) — addEventListener("load", ...) at that point would never fire.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
