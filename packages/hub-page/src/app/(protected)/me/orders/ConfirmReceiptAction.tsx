"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Share } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import { track } from "@/lib/analytics/track";
import { isPushSupported, isIos, isIosStandalone, subscribeDevice } from "@/lib/push/browser";
import { DisputeButton } from "./DisputeButton";

// Contextual post-earning permission prompt
// (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §6.7):
// never request OS notification permission on page load or right after a
// scan — the in-app earning confirmation is shown first, and only an
// explicit "Notify me next time" tap may invoke the browser permission
// flow. A denial is respected; this only ever offers once per confirmation.
type PromptState = "hidden" | "offer_subscribe" | "ios_guidance" | "done";

type ConfirmResponse = { ok: boolean; reward?: { issued: boolean; miles: number } };

export function ConfirmReceiptAction({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "busy" | "confirmed" | "error">("idle");
  const [reward, setReward] = useState<{ issued: boolean; miles: number } | null>(null);
  const [prompt, setPrompt] = useState<PromptState>("hidden");
  const [subscribing, setSubscribing] = useState(false);

  async function handleConfirm() {
    setPhase("busy");
    try {
      const res = await fetch(`/api/shop/orders/${orderId}/confirm`, { method: "POST" });
      const json = (await res.json()) as ConfirmResponse;
      if (!res.ok || !json.ok) {
        setPhase("error");
        return;
      }
      setReward(json.reward ?? null);
      setPhase("confirmed");
      if (json.reward?.issued && json.reward.miles > 0) {
        void evaluatePrompt();
      }
    } catch {
      setPhase("error");
    }
  }

  async function evaluatePrompt() {
    if (!isPushSupported()) return;

    if (isIos() && !isIosStandalone()) {
      setPrompt("ios_guidance");
      track("earnings_push_prompt_shown", { surface: "ios_add_to_home_screen" });
      return;
    }

    if (Notification.permission === "denied") return; // denial respected — never re-prompt

    if (Notification.permission === "granted") {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) return; // already subscribed — push happens normally, no prompt needed
      } catch {
        return;
      }
    }

    setPrompt("offer_subscribe");
    track("earnings_push_prompt_shown", { surface: "order_confirmation" });
  }

  async function handleEnablePush() {
    setSubscribing(true);
    try {
      const res = await fetch("/api/me/push");
      const info = (await res.json()) as { vapid_public_key: string | null };
      if (!info.vapid_public_key) throw new Error("push_not_configured");
      await subscribeDevice(info.vapid_public_key);
      track("earnings_push_prompt_accepted");
      setPrompt("done");
    } catch {
      // Permission denial or a subscribe failure — don't retry this session.
      setPrompt("hidden");
    } finally {
      setSubscribing(false);
    }
  }

  function handleDismissPrompt() {
    track("earnings_push_prompt_dismissed");
    setPrompt("hidden");
  }

  function handleClose() {
    setPhase("idle");
    router.refresh();
  }

  if (phase === "confirmed") {
    return (
      <div className="mt-3 rounded-xl border border-akiba-teal/20 bg-akiba-tint p-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-akiba-teal" />
          <p className="text-sm font-medium text-akiba-ink">Order confirmed</p>
        </div>

        {reward?.issued && reward.miles > 0 && (
          <p className="mt-1 flex items-center gap-1 text-sm text-akiba-ink">
            You earned <MilesAmount amount={reward.miles} size="sm" />
          </p>
        )}

        {prompt === "offer_subscribe" && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white/70 p-2">
            <p className="text-xs text-akiba-muted">Get notified next time you earn Miles</p>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={handleDismissPrompt} className="text-xs font-medium text-akiba-muted hover:text-akiba-ink">
                Not now
              </button>
              <button
                onClick={handleEnablePush}
                disabled={subscribing}
                className="whitespace-nowrap rounded-full bg-akiba-teal px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
              >
                {subscribing ? "…" : "Notify me next time"}
              </button>
            </div>
          </div>
        )}

        {prompt === "ios_guidance" && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-white/70 p-2">
            <Share className="mt-0.5 h-3.5 w-3.5 shrink-0 text-akiba-teal" />
            <p className="text-xs text-akiba-muted">
              Add Akiba to your Home Screen to get notified next time you earn Miles: tap Share in Safari, then
              &quot;Add to Home Screen&quot;.
            </p>
          </div>
        )}

        {prompt === "done" && <p className="mt-2 text-xs text-akiba-teal">Notifications on — we&apos;ll let you know next time.</p>}

        <button onClick={handleClose} className="mt-2 text-xs font-medium text-akiba-muted hover:text-akiba-ink">
          Done
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={phase === "busy"}
        className="mt-3 w-full rounded-xl bg-akiba-teal py-2 text-xs font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-60"
      >
        {phase === "busy" ? "Confirming…" : "Confirm received"}
      </button>
      {phase === "error" && <p className="mt-1 text-xs text-red-500">Couldn&apos;t confirm — please try again.</p>}
      <DisputeButton orderId={orderId} />
    </>
  );
}
