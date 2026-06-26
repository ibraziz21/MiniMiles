"use client";

import { useState } from "react";
import { Clock, CheckCircle2, Loader2, ExternalLink, Wallet } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import clsx from "clsx";

export type Quest = {
  id: string;
  title: string;
  description: string;
  miles_reward: number;
  partner_name: string;
  partner_slug: string;
  partner_logo?: string;
  chain?: string;
  difficulty?: "easy" | "medium" | "hard";
  ends_at?: string;
  action_url?: string;
  completed?: boolean;
};

export type ChainMeta = {
  label: string;
  emoji: string;
  badgeCls: string;
  iconBg: string;
  logoSrc: string | null;
};

type ClaimStatus = "idle" | "loading" | "success" | "error";

function claimErrorMessage(status: number, msg?: string): string {
  if (status === 401) return "Sign in to claim";
  if (status === 400 && msg?.toLowerCase().includes("minipay")) return "Link a MiniPay wallet first";
  if (status === 409) return "Already claimed — check your rewards balance";
  if (status === 422) return "Not eligible for this quest";
  if (status === 429) return "Try again later";
  if (status === 503) return msg ?? "Quest claims are coming soon for this quest.";
  return msg ?? "Claim failed. Please try again.";
}

const DIFFICULTY_BADGE: Record<string, string> = {
  easy:   "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  hard:   "bg-red-50 text-red-700",
};

export function QuestCard({
  quest: q,
  chainMeta: meta,
  isSignedIn,
}: {
  quest: Quest;
  chainMeta: ChainMeta;
  isSignedIn: boolean;
}) {
  const [claimStatus, setClaimStatus]   = useState<ClaimStatus>(q.completed ? "success" : "idle");
  const [claimError,  setClaimError]    = useState<string | null>(null);
  const [milesEarned, setMilesEarned]   = useState<number | null>(null);

  async function handleClaim() {
    if (!isSignedIn) {
      window.location.href = "/login";
      return;
    }
    setClaimStatus("loading");
    setClaimError(null);

    try {
      const res = await fetch("/api/quests/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quest_id: q.id }),
      });

      const data = await res.json() as { error?: string; miles_awarded?: number; miles_reward?: number };

      if (!res.ok) {
        setClaimStatus("error");
        setClaimError(claimErrorMessage(res.status, data.error));
        return;
      }

      setMilesEarned(data.miles_awarded ?? data.miles_reward ?? q.miles_reward);
      setClaimStatus("success");
    } catch {
      setClaimStatus("error");
      setClaimError("Something went wrong. Please try again.");
    }
  }

  const alreadyDone = claimStatus === "success";

  return (
    <div
      className={clsx(
        "flex flex-col rounded-2xl border bg-white p-4 transition sm:p-5",
        alreadyDone
          ? "border-green-200 bg-green-50/20"
          : "border-akiba-line hover:border-akiba-teal/40 hover:shadow-chip"
      )}
    >
      {/* Chain badge */}
      {q.chain && (
        <span className={clsx("mb-2 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", meta.badgeCls)}>
          {meta.label}
        </span>
      )}

      {/* Difficulty + completed badges */}
      {(q.difficulty) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {q.difficulty && (
            <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", DIFFICULTY_BADGE[q.difficulty] ?? "bg-akiba-card text-akiba-muted")}>
              {q.difficulty}
            </span>
          )}
        </div>
      )}

      <h3 className="font-semibold leading-snug text-akiba-ink">{q.title}</h3>
      <p className="mt-0.5 text-[11px] font-medium text-akiba-muted/70">{q.partner_name}</p>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-akiba-muted">{q.description}</p>

      {/* Reward + expiry */}
      <div className="mt-4 flex items-center justify-between">
        <MilesAmount amount={q.miles_reward} size="sm" prefix="+" className="font-semibold text-akiba-teal" />
        {q.ends_at && (
          <span className="flex items-center gap-1 text-xs text-akiba-muted">
            <Clock className="h-3 w-3" />
            {new Date(q.ends_at).toLocaleDateString("en-KE", {
              month: "short", day: "numeric", year: "numeric",
            })}
          </span>
        )}
      </div>

      {/* Error feedback */}
      {claimStatus === "error" && claimError && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {claimError}
          {claimError === "Sign in to claim" && (
            <a href="/login" className="ml-1 underline">Sign in</a>
          )}
          {claimError === "Link a MiniPay wallet first" && (
            <a href="/me" className="ml-1 underline">Go to profile</a>
          )}
        </div>
      )}

      {/* CTA — action_url takes priority over claim flow */}
      {q.action_url && !alreadyDone ? (
        <a
          href={q.action_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-akiba-ink py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-teal"
        >
          Start quest <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : alreadyDone ? (
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-green-100 py-2.5 text-sm font-semibold text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          {milesEarned != null
            ? `Claimed · +${milesEarned} miles`
            : "Completed"}
        </div>
      ) : (
        <button
          onClick={handleClaim}
          disabled={claimStatus === "loading"}
          className={clsx(
            "mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition",
            claimStatus === "loading"
              ? "cursor-not-allowed bg-akiba-teal/60 text-white"
              : "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]"
          )}
        >
          {claimStatus === "loading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Claiming…
            </>
          ) : (
            <>
              <Wallet className="h-4 w-4" />
              {isSignedIn ? "Claim quest" : "Sign in to claim"}
            </>
          )}
        </button>
      )}
    </div>
  );
}
