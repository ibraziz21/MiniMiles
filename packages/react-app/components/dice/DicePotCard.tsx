// components/dice/DicePotCard.tsx
"use client";

import Image from "next/image";
import {
  DiceRoundView,
  DiceRoundStateName,
  DiceTier,
  shortAddress,
  stateLabel,
  statePillClasses,
} from "@/lib/diceTypes";
import { akibaMilesSymbol } from "@/lib/svg";

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
  canJoin: boolean;
  isJoining: boolean;
  isLoading: boolean;
};

export function DicePotCard({
  round,
  selectedTier,
  potSize,
  selectedNumber,
  myNumber,
  isFinished,
  hasJoinedActive,
  hasJoinedLastResolved, // kept for future if you need it
  displayState,
  onSelectNumber,
  onJoin,
  canJoin,
  isJoining,
  isLoading,
}: DicePotCardProps) {
  const filledCount = isFinished ? 0 : round?.filledSlots ?? 0;
  const slotsLeft = 6 - filledCount;

  const label = stateLabel(displayState);
  const pillCls = statePillClasses(displayState);

  const waitingForCount = Math.max(0, 6 - (round?.filledSlots ?? 0));
  const hasSelectionButNotJoined = !!selectedNumber && !hasJoinedActive;
  const hasNoSelection = !selectedNumber && !hasJoinedActive;

  const fillPercent = Math.min(100, Math.max(0, (filledCount / 6) * 100));

  return (
    <section className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-white/95 p-3 shadow-[0_10px_24px_rgba(16,185,129,0.16)]">
      {/* subtle glows */}
      <div className="pointer-events-none absolute -top-8 -right-6 h-16 w-16 rounded-full bg-emerald-100/70 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-4 h-16 w-16 rounded-full bg-teal-100/60 blur-2xl" />
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-500" />

      {/* top: pot + players + state */}
      <div className="relative flex items-start justify-between pt-2 pb-2">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Pot value
          </p>
          <div className="flex items-center gap-1.5">
            <Image src={akibaMilesSymbol} alt="Miles" className="h-3.5 w-3.5" />
            <span className="text-[18px] font-semibold tracking-tight text-slate-900">
              {potSize.toLocaleString()}
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            One winning number gets the full pot.
          </p>
        </div>

        <div className="text-right space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Players
          </p>
          <p className="text-[13px] font-semibold">
            {filledCount}
            <span className="text-slate-400 text-[11px]"> / 6</span>
          </p>
          <p className="text-[11px] text-emerald-600">
            {slotsLeft > 0 ? `${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left` : "Pot full"}
          </p>

          {/* progress bar */}
          <div className="mt-0.5 h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400 transition-all"
              style={{ width: `${fillPercent}%` }}
            />
          </div>

          {/* state pill */}
          <div className="mt-1 flex justify-end">
            <div
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${pillCls}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              <span>{label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* micro explainer – single line */}
      {!hasJoinedActive && hasNoSelection && (
        <p className="mb-2 rounded-2xl bg-emerald-50/80 border border-emerald-100 px-2.5 py-1 text-[10px] text-emerald-900">
          Step 1: tap a <span className="font-semibold">Free slot</span>. Step 2: hit{" "}
          <span className="font-semibold">Join pot</span>.
        </p>
      )}

      {/* numbers grid */}
      <div className="relative grid grid-cols-3 gap-1.5 pt-1">
        {Array.from({ length: 6 }, (_, idx) => {
          const n = idx + 1;

          const slotData =
            !isFinished && round
              ? round.slots.find((s) => s.number === n) ?? null
              : null;

          const player = slotData?.player ?? null;
          const isMine = hasJoinedActive && myNumber === n;
          const isTakenByOther = !!player && !isMine;
          const isSelected =
            selectedNumber === n && !hasJoinedActive && !isTakenByOther;

          const disabled = isTakenByOther || hasJoinedActive;

          const base =
            "group relative aspect-[4/3] rounded-2xl border text-center flex flex-col items-center justify-center text-[15px] font-semibold transition-all overflow-hidden";

          const cls = isMine
            ? "border-emerald-500 bg-slate-900/5 shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_8px_18px_rgba(16,185,129,0.35)]"
            : isTakenByOther
            ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
            : isSelected
            ? "border-emerald-500 bg-slate-900/5 shadow-[0_0_0_1px_rgba(16,185,129,0.5),0_8px_20px_rgba(16,185,129,0.4)] scale-[1.01]"
            : "border-slate-200 bg-slate-50 text-slate-900 hover:border-emerald-300 hover:bg-emerald-50/90 hover:shadow-[0_6px_16px_rgba(16,185,129,0.22)] active:scale-[0.98]";

          return (
            <button
              key={n}
              disabled={disabled}
              onClick={() => onSelectNumber(n)}
              className={`${base} ${cls}`}
            >
              {!isTakenByOther && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.13),_transparent_60%)]" />
              )}

              <div className="relative z-10 flex flex-col items-center justify-center gap-0.5">
                {/* Number chip */}
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-9 w-9 rounded-full bg-gradient-to-br from-slate-50 via-white to-slate-100 shadow-inner" />
                  <div className="relative h-7 w-7 rounded-full bg-gradient-to-br from-emerald-500 via-emerald-400 to-teal-400 flex items-center justify-center shadow">
                    <span className="text-white text-[15px] font-extrabold drop-shadow-sm">
                      {n}
                    </span>
                  </div>
                </div>

                {/* labels */}
                {isMine && (
                  <span className="text-[9px] uppercase tracking-wide text-emerald-700 font-semibold">
                    Your number
                  </span>
                )}

                {isTakenByOther && player && (
                  <span className="text-[8px] text-slate-500">
                    {shortAddress(player)}
                  </span>
                )}

                {!player && !isMine && (
                  <span className="text-[9px] text-emerald-700 font-medium">
                    Free slot
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* join / status */}
      <div className="relative mt-2 border-t border-slate-100 pt-2 space-y-1.25">
        {!hasJoinedActive ? (
          <>
            {hasSelectionButNotJoined && (
              <p className="text-[10px] text-slate-500">
                You picked <span className="font-semibold">#{selectedNumber}</span>. Joining
                costs{" "}
                <span className="font-semibold">
                  {selectedTier.toLocaleString()} Miles
                </span>
                .
              </p>
            )}

            {!hasSelectionButNotJoined && hasNoSelection && (
              <p className="text-[10px] text-slate-500">
                Pick your lucky number above to unlock the button.
              </p>
            )}

            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Entry per player</span>
              <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                <Image src={akibaMilesSymbol} alt="Miles" className="h-3 w-3" />
                {selectedTier.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Pot when full (6 players)</span>
              <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                <Image src={akibaMilesSymbol} alt="Miles" className="h-3 w-3" />
                {potSize.toLocaleString()}
              </span>
            </div>

            {/* 🧃 Properly fed button */}
            <button
              onClick={onJoin}
              disabled={!canJoin}
              className={`mt-1.5 w-full rounded-full px-4 py-2.5 text-sm font-semibold tracking-tight transition-all
                ${
                  canJoin
                    ? "bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 text-white shadow-md shadow-emerald-300 hover:brightness-110 active:scale-[0.98]"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
            >
              {isJoining
                ? "Joining…"
                : hasSelectionButNotJoined
                ? "Join pot"
                : "Choose a number to join"}
            </button>

            <p className="text-[9px] text-slate-400 pt-0.5">
              Miles used to join are spent for this pot — only the winning number gets the
              reward.
            </p>
          </>
        ) : (
          <div className="space-y-0.5">
            <p className="text-[10px] text-slate-500">
              You joined with <span className="font-semibold">#{myNumber}</span>. Waiting for{" "}
              <span className="font-semibold">{waitingForCount}</span> more player
              {waitingForCount === 1 ? "" : "s"}.
            </p>
            <p className="text-[9px] text-slate-400">
              When all 6 slots are filled, the dice rolls on-chain. If your number hits, you
              win{" "}
              <span className="font-semibold">
                {potSize.toLocaleString()} Miles
              </span>
              .
            </p>
          </div>
        )}
      </div>

      {isLoading && (
        <p className="text-[9px] text-slate-400 pt-0.5">Syncing round…</p>
      )}
    </section>
  );
}
