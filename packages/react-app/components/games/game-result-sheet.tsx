"use client";

import Link from "next/link";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Trophy, ArrowCounterClockwise, Star, XCircle, CheckCircle, CircleNotch, Medal } from "@phosphor-icons/react";
import type { GameResult } from "@/lib/games/types";
import { MilesAmount } from "./miles-amount";

const PRIZE_BY_RANK: Record<number, string> = { 1: "$5", 2: "$3", 3: "$2" };

function SettlementBadge({ status }: { status: "idle" | "submitting" | "settled" | "rejected" | "error" }) {
  if (status === "submitting") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-[#FFF8E1] border border-[#F59E0B33] px-3 py-1.5 text-xs font-semibold text-[#B45309]">
        <CircleNotch size={13} className="animate-spin" />
        Verifying result
      </div>
    );
  }
  if (status === "settled") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-[#F0FFF6] border border-[#138A4533] px-3 py-1.5 text-xs font-semibold text-[#138A45]">
        <CheckCircle size={13} weight="fill" />
        Reward sent
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-[#FFECEC] border border-[#C43D3D33] px-3 py-1.5 text-xs font-semibold text-[#C43D3D]">
        <XCircle size={13} weight="fill" />
        Result rejected
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-[#FFF8E1] border border-[#F59E0B33] px-3 py-1.5 text-xs font-semibold text-[#B45309]">
        <CircleNotch size={13} />
        Reward pending
      </div>
    );
  }
  return null;
}

export function GameResultSheet({
  open,
  onOpenChange,
  result,
  settlementStatus,
  weeklyRank,
  onPlayAgain,
}: {
  open:             boolean;
  onOpenChange:     (open: boolean) => void;
  result:           GameResult | null;
  settlementStatus: "idle" | "submitting" | "settled" | "rejected" | "error";
  weeklyRank?:      number | null;
  onPlayAgain:      () => void;
}) {
  const hasReward    = result && (result.rewardMiles || result.rewardStable);
  const isTopThree   = weeklyRank != null && weeklyRank >= 1 && weeklyRank <= 3;
  const estimatedPrize = isTopThree ? PRIZE_BY_RANK[weeklyRank!] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl bg-white px-0 pb-8" aria-describedby={undefined}>
        <SheetTitle className="sr-only">Round result</SheetTitle>
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-[#E0E0E0]" />
        </div>

        {result && (
          <>
            {/* Score hero */}
            <div className="mx-5 mt-3 rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] px-5 py-6 text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
              <div className="absolute -left-4 -bottom-4 h-16 w-16 rounded-full bg-white/10" />
              <div className="relative z-10">
                <Trophy size={28} weight="fill" className="mx-auto mb-1 text-yellow-300" />
                <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Score</p>
                <p className="text-6xl font-bold text-white mt-1">{result.score}</p>
                <p className="mt-1 text-xs text-white/70 font-poppins">
                  {result.completed ? "Round completed" : "Round submitted"} · {(result.elapsedMs / 1000).toFixed(1)}s
                </p>
              </div>
            </div>

            {/* Settlement badge */}
            <div className="flex justify-center mt-3">
              <SettlementBadge status={settlementStatus} />
            </div>

            {/* Reward row */}
            <div className="mx-5 mt-4 rounded-xl border border-[#F0F0F0] bg-[#FAFAFA] px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#817E7E] font-poppins">Reward</p>
                <div className="text-base font-bold text-[#1A1A1A] mt-0.5 flex items-center gap-1 flex-wrap">
                  {hasReward ? (
                    <MilesAmount value={result.rewardMiles ?? 0} size={16} />
                  ) : (
                    <span className="text-sm font-medium text-[#817E7E]">No reward this round</span>
                  )}
                </div>
              </div>
              {hasReward && (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100">
                  <Star size={18} weight="fill" className="text-amber-500" />
                </div>
              )}
            </div>

            {/* Weekly rank */}
            {weeklyRank != null && (
              <div className={`mx-5 mt-2 rounded-xl border px-4 py-3 flex items-center justify-between ${
                isTopThree
                  ? "bg-[#FFF6D8] border-[#B7791F22]"
                  : "bg-[#FAFAFA] border-[#F0F0F0]"
              }`}>
                <div>
                  <p className="text-xs text-[#817E7E] font-poppins">
                    {isTopThree ? "Current weekly rank" : "Weekly rank"}
                  </p>
                  <p className="text-base font-bold text-[#1A1A1A] mt-0.5">#{weeklyRank}</p>
                </div>
                {isTopThree && estimatedPrize && (
                  <div className="text-right">
                    <p className="text-xs text-[#B7791F] font-poppins">Estimated prize</p>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Medal size={14} weight="fill" className="text-amber-500" />
                      <p className="text-base font-bold text-[#B7791F]">{estimatedPrize}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="mx-5 mt-1.5 text-xs text-[#817E7E] font-poppins">
              Only your best verified score counts on the leaderboard.
            </p>
          </>
        )}

        {/* Actions */}
        <div className="mx-5 mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#238D9D] py-3.5 text-sm font-bold text-white"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
            Play again
          </button>
          <Link
            href="/games"
            className="flex items-center justify-center gap-2 rounded-xl bg-[#238D9D1A] px-4 py-3.5 text-sm font-bold text-[#238D9D]"
          >
            <Trophy size={16} weight="bold" />
            Leaderboard
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
