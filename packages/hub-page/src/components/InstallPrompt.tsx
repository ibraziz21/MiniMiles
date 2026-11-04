"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Share, SquarePlus, X } from "lucide-react";

import { isAndroid, isIos, isStandaloneApp } from "@/lib/push/browser";
import { APP_INSTALL_DISMISS_KEY, shouldOfferAppInstall, wasRecentlyDismissed } from "@/lib/mobile/installPrompt";
import { playStoreUrl } from "@/constants/links";
import { TrackedAnchor } from "@/components/TrackedAnchor";

const DISMISS_KEY = "akiba_install_dismissed_v1"; // Preserve iOS/desktop dismissals.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Android offers the native app; iOS retains Share → Add to Home Screen.
 * Desktop keeps the existing browser-driven PWA install flow. */
export function InstallPrompt() {
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [android, setAndroid] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    setShowIosSteps(false);
    setAndroid(false);
    if (pathname === "/welcome") {
      setVisible(false);
      return;
    }
    const androidDevice = isAndroid();
    let stored: string | null = null;
    try { stored = localStorage.getItem(androidDevice ? APP_INSTALL_DISMISS_KEY : DISMISS_KEY); } catch { /* Storage may be unavailable. */ }
    const recentlyDismissed = wasRecentlyDismissed(stored);
    if (androidDevice) {
      setAndroid(true);
      setVisible(shouldOfferAppInstall({ android: true, standalone: isStandaloneApp(), recentlyDismissed, pathname }));
      return;
    }
    if (isStandaloneApp() || recentlyDismissed) return;

    if (isIos()) {
      setShowIosSteps(true);
      setVisible(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [pathname]);

  function dismiss() {
    try { localStorage.setItem(android ? APP_INSTALL_DISMISS_KEY : DISMISS_KEY, String(Date.now())); } catch { /* Dismiss for this visit even without storage. */ }
    window.dispatchEvent(new Event("akiba:app-install-dismissed"));
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-40 px-4 sm:bottom-4 sm:flex sm:justify-center">
      <div className="mx-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-akiba-line bg-white p-4 shadow-lg">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-akiba-teal/10 text-akiba-teal">
          {showIosSteps ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <p className="font-sterling text-sm font-semibold text-akiba-ink">
            {android ? "Akiba is now on Android" : "Add Akiba Pass to your home screen"}
          </p>
          {showIosSteps ? (
            <p className="mt-0.5 text-sm text-akiba-muted">
              Tap <Share className="inline h-3.5 w-3.5 align-[-2px]" /> Share, then{" "}
              <SquarePlus className="inline h-3.5 w-3.5 align-[-2px]" /> &ldquo;Add to Home
              Screen&rdquo;.
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-akiba-muted">
              {android ? "Discover local places, offers and rewards in the Akiba app. Available in Kenya." : "Install for quick access to your pass, rewards, and quests — even offline."}
            </p>
          )}
          {android ? (
            <TrackedAnchor href={playStoreUrl("banner")} event="app_install_tap" eventProps={{ slot: "banner" }} className="mt-2 inline-flex min-h-11 items-center rounded-full bg-akiba-teal px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akiba-teal">Get it on Google Play</TrackedAnchor>
          ) : !showIosSteps && (
            <button
              onClick={install}
              className="mt-2 rounded-full bg-akiba-teal px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Install
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 text-akiba-muted transition hover:bg-akiba-paper hover:text-akiba-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
