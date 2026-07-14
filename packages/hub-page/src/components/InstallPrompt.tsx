"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

const DISMISS_KEY = "akiba_install_dismissed_v1";
const SNOOZE_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !("MSStream" in window);
}

function wasRecentlyDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  if (Number.isNaN(dismissedAt)) return false;
  return Date.now() - dismissedAt < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Prompts users to add Akiba Pass to their home screen. Android/desktop
 * Chrome fires `beforeinstallprompt`, which we defer and trigger from a
 * branded banner; iOS Safari has no such event, so we show manual
 * "Share → Add to Home Screen" steps instead.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    if (isIOS()) {
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
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
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
            Add Akiba Pass to your home screen
          </p>
          {showIosSteps ? (
            <p className="mt-0.5 text-sm text-akiba-muted">
              Tap <Share className="inline h-3.5 w-3.5 align-[-2px]" /> Share, then{" "}
              <SquarePlus className="inline h-3.5 w-3.5 align-[-2px]" /> &ldquo;Add to Home
              Screen&rdquo;.
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-akiba-muted">
              Install for quick access to your pass, rewards, and quests — even offline.
            </p>
          )}
          {!showIosSteps && (
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
