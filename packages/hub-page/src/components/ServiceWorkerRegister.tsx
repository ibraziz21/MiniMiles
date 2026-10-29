"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearPrivateNavigationCaches } from "@/lib/privateNavigationCache";

/** Public-asset worker registration and shared-device session isolation. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    void clearPrivateNavigationCaches();
    const supabase = createClient();
    let identity: string | null | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (identity === undefined) { identity = next; return; }
      if (identity === next) return;
      const previous = identity;
      identity = next;
      // A fresh sign-in has no old private view. Let its normal return URL
      // finish after the auth client has flushed cookies.
      if (previous === null) { void clearPrivateNavigationCaches(); return; }
      // Includes sign-out/account switches from another tab. A document load
      // discards Next's private router state; hide the old view immediately.
      document.documentElement.style.visibility = "hidden";
      void clearPrivateNavigationCaches().finally(() => {
        if (next === null) window.location.replace("/");
        else window.location.reload();
      });
    });
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        document.documentElement.style.visibility = "hidden";
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", onPageShow);

    // Dev chunks use stable URLs, so do not register a caching worker there.
    if (process.env.NODE_ENV !== "development" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((err) => {
        console.warn("[sw] registration failed:", err);
      });
    }
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
