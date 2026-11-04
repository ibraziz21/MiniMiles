"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isAndroid, isStandaloneApp } from "@/lib/push/browser";
import { APP_INSTALL_DISMISS_KEY, shouldOfferAppInstall, wasRecentlyDismissed } from "@/lib/mobile/installPrompt";
import { PlayStoreLink } from "@/components/PlayStoreLink";

export function AndroidAppNudge({ slot }: { slot: string }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    function refresh() {
      let stored: string | null = null;
      try { stored = localStorage.getItem(APP_INSTALL_DISMISS_KEY); } catch { /* Best effort. */ }
      setVisible(shouldOfferAppInstall({ android: isAndroid(), standalone: isStandaloneApp(), recentlyDismissed: wasRecentlyDismissed(stored), pathname }));
    }
    refresh();
    window.addEventListener("akiba:app-install-dismissed", refresh);
    return () => window.removeEventListener("akiba:app-install-dismissed", refresh);
  }, [pathname]);
  return visible ? <PlayStoreLink slot={slot} /> : null;
}
