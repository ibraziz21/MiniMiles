// components/dice/DicePotCard.tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import {
  DiceRoundView,
  DiceRoundStateName,
  DiceTier,
  MilesTier,
  UsdTier,
  USD_TIER_META,
  MILES_TIER_BONUS_USD,
  shortAddress,
  isUsdTierType,
} from "@/lib/diceTypes";
import { akibaMilesSymbol } from "@/lib/svg";
import { RoundLeaderboard } from "./RoundLeaderboard";

type DicePotCardProps = {
  round: DiceRoundView | null;
  selectedTier: DiceTier;
  potSize: number;
  selectedNumber: number | null;
  myNumber: number | null;
  isFinished: boolean;
  hasJoinedActive: boolean;
  hasJoinedLastResolved: boolean;
  displayState: DiceRoundStateName;
  onSelectNumber: (n: number) => void;
  onJoin: () => void;
  onApprove: () => void;
  canJoin: boolean;
  isJoining: boolean;
  isApproving: boolean;
  isApproved: boolean;
  isLoading: boolean;
  isDrawing: boolean;
  myAddress: string | null;
};

export function DicePotCard({
  round,
  selectedTier,
  potSize,
  selectedNumber,
  myNumber,
  isFinished,
  hasJoinedActive,
  displayState,
  onSelectNumber,
  onJoin,
  onApprove,
  canJoin,
  isJoining,
  isApproving,
  isApproved,
  isLoading,
  isDrawing,
  myAddress,
}: DicePotCardProps) {
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  const isUsd = isUsdTierType(selectedTier);
  const usdMeta = isUsd ? USD_TIER_META[selectedTier as UsdTier] : null;
  const milesTierBonus = !isUsd ? MILES_TIER_BONUS_USD[selectedTier as MilesTier] : undefined;

  const filledCount = isFinished ? 0 : round?.filledSlots ?? 0;
  const slotsLeft = 6 - filledCount;
  const waitingForCount = Math.max(0, 6 - (round?.filledSlots ?? 0));
  const hasSelectionButNotJoined = !!selectedNumber && !hasJoinedActive;

  const fillPercent = Math.min(100, Math.max(0, (filledCount / 6) * 100));

  const isResolved = displayState === "resolved";

  // Pot value
  const potValueLine = isUsd && usdMeta
    ? `$${usdMeta.payout.toFixed(2)} USDT + ${usdMeta.miles} Miles`
    : milesTierBonus
    ? `${potSize.toLocaleString()} Miles + $${milesTierBonus.toFixed(2)} USDT`
    : `${potSize.toLocaleString()} Miles`;

  const entryLine = isUsd && usdMeta
    ? `$${usdMeta.entry.toFixed(2)} USDT`
    : `${selectedTier.toLocaleString()} Miles`;

  // Colors
  const accentGradient = isUsd
    ? "from-blue-400 via-blue-300 to-indigo-400"
    : "from-emerald-400 via-emerald-300 to-emerald-500";
  const numberBubbleCls = isUsd
    ? "from-blue-500 via-blue-400 to-indigo-400"
    : "from-emerald-500 via-emerald-400 to-teal-400";
  const joinBtnCls = isUsd
    ? "bg-gradient-to-r from-blue-500 to-indigo-400 text-white shadow-md shadow-blue-200 hover:brightness-110 active:scale-[0.98]"
    : "bg-gradient-to-r from-emerald-500 to-teal-400 text-white shadow-md shadow-emerald-200 hover:brightness-110 active:scale-[0.98]";

  // Single-button USD approve→join label
  function usdBtnLabel() {
    if (isApproving) return "Approving USDT…";
    if (!isApproved) return "Approve USDT to Join";
    if (isJoining) return "Joining…";
    return "Join Pot";
  }
  function usdBtnAction() {
    if (!isApproved) { onApprove(); return; }
    onJoin();
  }
  const usdBtnDisabled = isApproving || isJoining || (!isApproved && !canJoin) || (isApproved && !canJoin);
  const usdBtnStyle = usdBtnDisabled
    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
    : isApproved
    ? joinBtnCls
    : "bg-gradient-to-r from-slate-700 to-slate-600 text-white shadow-md hover:brightness-110 active:scale-[0.98]";

  return (
    <section className="relative rounded-3xl border border-slate-100 bg-white/95 shadow-[0_8px_24px_rgba(16,185,129,0.12)]">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accentGradient}`} />
      <div className="pointer-events-none absolute -top-6 -right-4 h-14 w-14 rounded-full bg-emerald-100/60 blur-2xl" />

      <div className="p-3 space-y-2">

        {/* ── Pot header: value + fill ───────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-slate-400">Pot</p>
            {isUsd && usdMeta ? (
              <div className="flex items-center gap-1">
                <span className="text-[15px] font-bold text-slate-900">${usdMeta.payout.toFixed(2)}</span>
                <span className="text-[10px] text-slate-500">USDT</span>
                <span className="text-slate-300 text-[10px]">+</span>
                <Image src={akibaMilesSymbol} alt="M" className="h-3 w-3" />
                <span className="text-[12px] font-semibold text-slate-700">{usdMeta.miles}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Image src={akibaMilesSymbol} alt="M" className="h-3.5 w-3.5" />
                <span className="text-[15px] font-bold text-slate-900">{potSize.toLocaleString()}</span>
                {milesTierBonus && (
                  <span className="text-[10px] font-semibold text-blue-600">+ ${milesTierBonus.toFixed(2)}</span>
                )}
              </div>
            )}
          </div>

          <div className="text-right space-y-1">
            <p className="text-[11px] font-semibold text-slate-700">
              {isResolved ? "0" : filledCount}
              <span className="text-slate-400 font-normal text-[10px]"> / 6</span>
              <span className="ml-1 text-[9px] text-slate-400">players</span>
            </p>
            <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all bg-gradient-to-r ${accentGradient}`}
                style={{ width: `${fillPercent}%` }}
              />
            </div>
            <p className="text-[9px] text-emerald-600">
              {isResolved ? "New pot" : slotsLeft > 0 ? `${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left` : "Full"}
            </p>
          </div>
        </div>

        {/* ── Numbers grid ─────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }, (_, idx) => {
            const n = idx + 1;
            const slotData = !isFinished && round ? round.slots.find((s) => s.number === n) ?? null : null;
            const player = slotData?.player ?? null;
            const isMine = hasJoinedActive && myNumber === n;
            const isTakenByOther = !!player && !isMine;
            const isSelected = selectedNumber === n && !hasJoinedActive && !isTakenByOther;
            const disabled = isTakenByOther || hasJoinedActive;

            const base = "group relative aspect-[4/3] rounded-2xl border text-center flex flex-col items-center justify-center transition-all overflow-hidden";

            const cls = isMine
              ? isUsd
                ? "border-blue-500 bg-blue-50 shadow-[0_0_0_1px_rgba(59,130,246,0.4)]"
                : "border-emerald-500 bg-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]"
              : isTakenByOther
              ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
              : isSelected
              ? isUsd
                ? "border-blue-500 bg-blue-50/60 scale-[1.01]"
                : "border-emerald-500 bg-emerald-50/60 scale-[1.01]"
              : "border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/60 active:scale-[0.98]";

            return (
              <button
                key={n}
                disabled={disabled}
                onClick={() => onSelectNumber(n)}
                className={`${base} ${cls}`}
              >
                <div className="relative z-10 flex flex-col items-center justify-center gap-0.5">
                  <div className={`h-7 w-7 rounded-full bg-gradient-to-br ${numberBubbleCls} flex items-center justify-center shadow`}>
                    <span className="text-[14px] font-extrabold text-white drop-shadow-sm">{n}</span>
                  </div>
                  {isMine && (
                    <span className={`text-[8px] uppercase tracking-wide font-semibold ${isUsd ? "text-blue-700" : "text-emerald-700"}`}>
                      You
                    </span>
                  )}
                  {isTakenByOther && player && (
                    <span className="text-[7px] text-slate-500">{shortAddress(player)}</span>
                  )}
                  {!player && !isMine && !isResolved && (
                    <span className={`text-[8px] font-medium ${isUsd ? "text-blue-600" : "text-emerald-600"}`}>
                      Free
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Collapsible leaderboard ───────────────────── */}
        {round && round.roundId !== 0n && round.state !== "none" && round.filledSlots > 0 && (
          <div className="rounded-xl border border-slate-100 overflow-hidden">
            <button
              onClick={() => setLeaderboardOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-50 hover:bg-slate-100 transition"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Round #{round.roundId.toString()} · {round.filledSlots}/6 players
              </span>
              <span className="text-slate-400 text-[11px]">{leaderboardOpen ? "▲" : "▼"}</span>
            </button>
            {leaderboardOpen && (
              <RoundLeaderboard round={round} myAddress={myAddress} isDrawing={isDrawing} />
            )}
          </div>
        )}

        {/* ── Join / status section ─────────────────────── */}
        <div className="border-t border-slate-100 pt-2 space-y-1.5">
          {!hasJoinedActive ? (
            <>
              {hasSelectionButNotJoined && (
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>#{selectedNumber} picked · Entry</span>
                  <span className="font-semibold text-slate-800">{entryLine}</span>
                </div>
              )}
              {!selectedNumber && (
                <p className="text-[10px] text-slate-400 text-center">Pick a free number above to join</p>
              )}

              {/* USD: single approve→join button */}
              {isUsd ? (
                <div className="space-y-1">
                  <button
                    onClick={usdBtnAction}
                    disabled={usdBtnDisabled}
                    className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold tracking-tight transition-all ${usdBtnStyle}`}
                  >
                    {usdBtnLabel()}
                  </button>
                  {isApproved && (
                    <p className="text-[9px] text-emerald-600 text-center">✓ USDT approved — ready to join</p>
                  )}
                </div>
              ) : (
                <button
                  onClick={onJoin}
                  disabled={!canJoin}
                  className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold tracking-tight transition-all ${
                    canJoin ? joinBtnCls : "bg-slate-200 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  {isJoining ? "Joining…" : hasSelectionButNotJoined ? "Join pot" : "Choose a number"}
                </button>
              )}
            </>
          ) : hasJoinedActive ? (
            <div className="text-center space-y-0.5">
              <p className="text-[11px] text-slate-600">
                You're in with <span className="font-bold text-slate-900">#{myNumber}</span>
                {waitingForCount > 0 ? ` — waiting for ${waitingForCount} more` : " — Pot full!"}.
              </p>
              {isDrawing && (
                <p className="text-[10px] text-amber-600 font-medium">🎲 Drawing winner…</p>
              )}
            </div>
          ) : null}

          {isLoading && (
            <p className="text-[9px] text-slate-400 text-center">Syncing…</p>
          )}
        </div>
      </div>
    </section>
  );
}
