"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, ChevronRight, ClipboardList, Lock } from "lucide-react";
import { akibaMilesSymbol } from "@/lib/svg";
import type { PollSummary } from "@/types/polls";

interface VerifiedInsightsProps {
  /** Called when the user wants to open a poll — host component manages the sheet */
  onOpenPoll: (pollId: string) => void;
  /** Trigger a re-fetch (e.g. after a successful submission) */
  refreshKey?: number;
}

// ── Poll card ─────────────────────────────────────────────────────────────────

function PollCard({
  poll,
  onOpen,
}: {
  poll: PollSummary;
  onOpen: () => void;
}) {
  const completed = poll.completed;
  const profileLocked = !poll.eligible && poll.ineligible_reason === "profile_incomplete";
  const ineligible = !poll.eligible && !completed;

  // Profile-locked polls render as a non-interactive block with a deep-link CTA
  if (profileLocked) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-xl p-2 bg-amber-100">
            <Lock className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-gray-900 leading-tight">
              {poll.title}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <Image src={akibaMilesSymbol} width={14} height={14} alt="Miles" />
              <span className="text-xs font-medium text-[#238D9D]">
                {poll.reward_points}
              </span>
            </div>
            <p className="text-xs text-amber-700 mt-2 leading-snug">
              Complete your profile to unlock Verified Insights.
            </p>
            <Link
              href="/profile"
              className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-[#238D9D] hover:underline"
            >
              Go to Profile <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={completed || ineligible}
      className={`w-full text-left rounded-2xl border p-4 flex items-start gap-3 transition-colors ${
        completed
          ? "border-[#238D9D]/30 bg-[#E6FAFA]/40"
          : ineligible
          ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
          : "border-gray-200 bg-white hover:border-[#238D9D]/50 active:bg-[#E6FAFA]/30"
      }`}
    >
      {/* Icon column */}
      <div
        className={`shrink-0 rounded-xl p-2 ${
          completed ? "bg-[#E6FAFA]" : "bg-[#F5F5F5]"
        }`}
      >
        {completed ? (
          <CheckCircle2 className="h-5 w-5 text-[#238D9D]" />
        ) : (
          <ClipboardList className="h-5 w-5 text-gray-500" />
        )}
      </div>

      {/* Text column */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 leading-tight">
          {poll.title}
        </p>
        {poll.description && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
            {poll.description}
          </p>
        )}

        {/* Reward row */}
        <div className="flex items-center gap-1 mt-2">
          <Image src={akibaMilesSymbol} width={14} height={14} alt="Miles" />
          <span className="text-xs font-medium text-[#238D9D]">
            {poll.reward_points}
          </span>
          {completed && (
            <span className="ml-2 text-xs text-[#238D9D] font-medium">
              · Earned
            </span>
          )}
          {ineligible && (
            <span className="ml-2 text-xs text-gray-400">
              · Not eligible
            </span>
          )}
        </div>
      </div>

      {/* Chevron */}
      {!completed && !ineligible && (
        <ChevronRight className="shrink-0 h-4 w-4 text-gray-400 mt-1" />
      )}
    </button>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

const VerifiedInsights = ({ onOpenPoll, refreshKey }: VerifiedInsightsProps) => {
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPolls = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch("/api/polls")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.polls)) setPolls(data.polls);
        else setError("Could not load polls.");
      })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls, refreshKey]);

  if (loading) {
    return (
      <div className="mt-6">
        <SectionHeader />
        <div className="space-y-3 mt-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-100 bg-gray-50 h-20 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6">
        <SectionHeader />
        <p className="text-sm text-gray-400 mt-2">{error}</p>
      </div>
    );
  }

  if (polls.length === 0) return null;

  return (
    <div className="mt-6">
      <SectionHeader />
      <div className="space-y-3 mt-3">
        {polls.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            onOpen={() => onOpenPoll(poll.id)}
          />
        ))}
      </div>
    </div>
  );
};

function SectionHeader() {
  return (
    <div className="flex items-center gap-2 mb-1">
      <h3 className="text-lg font-medium">Verified Insights</h3>
      <span className="inline-flex items-center rounded-full bg-[#E6FAFA] px-2 py-0.5 text-[10px] font-medium text-[#238D9D] uppercase tracking-wide">
        New
      </span>
    </div>
  );
}

export default VerifiedInsights;
