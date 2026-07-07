"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker (public/sw.js) so the Akiba Pass
 * renders at the till without signal. No-ops where SW is unsupported.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] registration failed:", err);
    });
  }, []);

  return null;
}
