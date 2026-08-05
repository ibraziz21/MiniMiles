"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing, Loader2, Sparkles, Store, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  isPushSupported,
  isStandaloneApp,
  subscribeDevice,
} from "@/lib/push/browser";
import {
  PUSH_PROMPT_DISMISS_KEY,
  shouldOfferPushPrompt,
  wasPushPromptRecentlyDismissed,
} from "@/lib/push/prompt";

const SHOW_DELAY_MS = 1_200;

type PushInfo = {
  vapid_public_key: string | null;
};

export function PushOptInPrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === "/me/notifications") {
      setVisible(false);
      return;
    }

    let cancelled = false;
    let showTimer: number | undefined;
    const supabase = createClient();

    async function evaluate() {
      if (showTimer) window.clearTimeout(showTimer);
      setVisible(false);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user || !isPushSupported() || !isStandaloneApp()) return;

      const permission = Notification.permission;
      if (permission === "denied") return;

      const response = await fetch("/api/me/push");
      if (!response.ok || cancelled) return;
      const info = (await response.json()) as PushInfo;

      let hasSubscription = false;
      if (permission === "granted") {
        const registration = await navigator.serviceWorker.ready;
        hasSubscription = Boolean(await registration.pushManager.getSubscription());
      }

      const recentlyDismissed = wasPushPromptRecentlyDismissed(
        window.localStorage.getItem(PUSH_PROMPT_DISMISS_KEY),
      );
      const shouldShow = shouldOfferPushPrompt({
        signedIn: true,
        supported: true,
        standalone: true,
        permission,
        hasSubscription,
        hasVapidKey: Boolean(info.vapid_public_key),
        recentlyDismissed,
      });

      if (!shouldShow || cancelled) return;
      setVapidPublicKey(info.vapid_public_key);
      showTimer = window.setTimeout(() => {
        if (!cancelled) setVisible(true);
      }, SHOW_DELAY_MS);
    }

    function checkEligibility() {
      void evaluate().catch(() => {
        if (!cancelled) setVisible(false);
      });
    }

    checkEligibility();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setVisible(false);
        return;
      }
      // Keep Supabase calls outside the auth callback itself.
      window.setTimeout(checkEligibility, 0);
    });

    return () => {
      cancelled = true;
      if (showTimer) window.clearTimeout(showTimer);
      subscription.unsubscribe();
    };
  }, [pathname]);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible]);

  function dismiss() {
    window.localStorage.setItem(PUSH_PROMPT_DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function enableNotifications() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      await subscribeDevice(vapidPublicKey);
      setVisible(false);
    } catch {
      if (Notification.permission === "denied") {
        setError("Notifications are blocked. You can enable them later in your phone settings.");
      } else {
        setError("We couldn’t turn notifications on. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-opt-in-title"
      aria-describedby="push-opt-in-description"
    >
      <button
        type="button"
        className="absolute inset-0 bg-akiba-ink/55 backdrop-blur-sm"
        onClick={dismiss}
        aria-label="Dismiss notification invitation"
      />

      <div className="relative w-full overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-w-md sm:rounded-[2rem]">
        <div className="relative overflow-hidden bg-gradient-to-br from-akiba-teal via-[#247d91] to-[#315a78] px-6 pb-8 pt-7 text-white">
          <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 -left-10 h-36 w-36 rounded-full bg-white/10" />
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-akiba-teal shadow-lg shadow-black/10">
              <BellRing className="h-7 w-7" />
            </div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
              <Sparkles className="h-3.5 w-3.5" />
             You're Early...
            </div>
            <h2 id="push-opt-in-title" className="font-sterling text-3xl font-semibold leading-tight">
              Big things are coming to Akiba
            </h2>
            <p id="push-opt-in-description" className="mt-3 max-w-sm text-sm leading-6 text-white/85">
              New features, fresh rewards, and more merchants are on the way. Turn on notifications for
              the updates that matter.
            </p>
          </div>
        </div>

        <div className="space-y-5 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 sm:pb-6">
          <div className="flex items-start gap-3 rounded-2xl bg-akiba-paper p-4">
            <Store className="mt-0.5 h-5 w-5 shrink-0 text-akiba-teal" />
            <div>
              <p className="text-sm font-semibold text-akiba-ink">Useful updates, never noise</p>
              <p className="mt-1 text-xs leading-5 text-akiba-muted">
                Order and voucher alerts are available now. Feature and merchant announcements will stay
                optional when they launch.
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={enableNotifications}
              disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-akiba-teal px-5 font-sterling text-base font-semibold text-white transition hover:bg-[#1E7E8D] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              {busy ? "Turning them on…" : "Keep me in the loop"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="min-h-11 w-full rounded-full text-sm font-medium text-akiba-muted transition hover:text-akiba-ink disabled:opacity-60"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
