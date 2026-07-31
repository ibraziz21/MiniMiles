"use client";

// Card for the account-first Hub quest catalog
// (merchant-shopping-quests-spec.md §6 "Card states"). Renders the 8 states
// from the spec exactly: signed out / needs action / wallet required /
// verifying / claimable / claiming / completed / failed-with-non-repeating-retry.
import { useState } from "react";
import { CheckCircle2, Loader2, ArrowRight, AlertTriangle, Wallet } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import clsx from "clsx";
import type { HubQuestStatus } from "@/lib/akiba/questStatus";

export function HubQuestCard({
  quest,
  isSignedIn,
  onClaimed,
}: {
  quest: HubQuestStatus;
  isSignedIn: boolean;
  onClaimed: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  async function handleClaim() {
    if (!quest.rewardId) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch("/api/quests/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: quest.rewardId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setClaimError(data.error ?? "Claim failed. Try again.");
        setClaiming(false);
        return;
      }
      onClaimed();
    } catch {
      setClaimError("Something went wrong. Try again.");
      setClaiming(false);
    }
  }

  const state = claiming ? "claiming" : quest.state;
  const isCompleted = state === "completed";

  return (
    <div
      className={clsx(
        "flex flex-col rounded-2xl border bg-white p-4 transition sm:p-5",
        isCompleted
          ? "border-green-200 bg-green-50/20"
          : "border-akiba-line hover:border-akiba-teal/40 hover:shadow-chip",
      )}
    >
      <h3 className="font-semibold leading-snug text-akiba-ink">{quest.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-akiba-muted">{quest.description}</p>

      <div className="mt-4 flex items-center justify-between">
        <MilesAmount amount={quest.miles} size="sm" prefix="+" className="font-semibold text-akiba-teal" />
        {quest.frequency === "weekly" && (
          <span className="rounded-full bg-akiba-card px-2.5 py-0.5 text-xs font-medium text-akiba-muted">
            Weekly
          </span>
        )}
      </div>

      {claimError && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{claimError}</div>
      )}

      <CardCta
        quest={quest}
        state={state}
        isSignedIn={isSignedIn}
        onClaim={handleClaim}
      />
    </div>
  );
}

function CardCta({
  quest,
  state,
  isSignedIn,
  onClaim,
}: {
  quest: HubQuestStatus;
  state: HubQuestStatus["state"];
  isSignedIn: boolean;
  onClaim: () => void;
}) {
  const baseBtn = "mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition";

  if (!isSignedIn) {
    return (
      <a href="/login" className={clsx(baseBtn, "bg-akiba-ink text-white hover:bg-akiba-teal")}>
        Sign in to start
      </a>
    );
  }

  switch (state) {
    case "wallet_required":
      return (
        <a href="/me" className={clsx(baseBtn, "bg-akiba-ink text-white hover:bg-akiba-teal")}>
          <Wallet className="h-4 w-4" /> Link wallet to play
        </a>
      );
    case "verifying":
      return (
        <div className={clsx(baseBtn, "bg-akiba-card text-akiba-muted")}>
          <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
        </div>
      );
    case "claiming":
      return (
        <div className={clsx(baseBtn, "cursor-not-allowed bg-akiba-teal/60 text-white")}>
          <Loader2 className="h-4 w-4 animate-spin" /> Claiming…
        </div>
      );
    case "claimable":
      return (
        <button
          onClick={onClaim}
          className={clsx(baseBtn, "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]")}
        >
          Claim <MilesAmount amount={quest.miles} size="sm" className="text-white" /> Miles
        </button>
      );
    case "completed":
      return (
        <div className={clsx(baseBtn, "bg-green-100 text-green-700")}>
          <CheckCircle2 className="h-4 w-4" />
          Claimed · <MilesAmount amount={quest.miles} size="sm" prefix="+" className="text-green-700" />
        </div>
      );
    case "reward_failed":
      return (
        <button
          onClick={onClaim}
          className={clsx(baseBtn, "bg-red-50 text-red-700 hover:bg-red-100")}
        >
          <AlertTriangle className="h-4 w-4" /> Reward needs attention · Retry
        </button>
      );
    case "needs_action":
    default:
      return (
        <a href={quest.actionHref} className={clsx(baseBtn, "bg-akiba-teal text-white hover:bg-akiba-teal/90")}>
          Start quest <ArrowRight className="h-4 w-4" />
        </a>
      );
  }
}
