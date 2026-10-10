"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Shown only post-login (the dashboard shell is only mounted behind auth, see
 * (dashboard)/layout.tsx) and only when the browser actually reports install
 * eligibility — never blocks any action behind it (spec §11.1).
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  return (
    <div className="fixed inset-x-4 bottom-20 z-30 flex items-center gap-3 rounded-card border border-border bg-surface p-3 shadow-lg lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-80">
      <Download className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">Install AkibaMiles Admin</p>
        <p className="text-ink-muted">Add it to your device for quicker access.</p>
      </div>
      <Button
        size="sm"
        onClick={async () => {
          await deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          setDeferredPrompt(null);
        }}
      >
        Install
      </Button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss install prompt"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-subtle hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
