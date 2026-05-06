"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { shortAddress } from "@/lib/diceTypes";
import type { DiceTier } from "@/lib/diceTypes";
import { akibaMilesSymbolAlt, usdtSymbolAlt } from "@/lib/svg";

type Pot = { miles: number; usdt: number };

type HistoryRound = {
  roundId: string;
  winningNumber: number;
  winner: string;
  displayName: string;
  pot: Pot;
};

function PotDisplay({ pot }: { pot: Pot }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700">
      {pot.miles > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Image src={akibaMilesSymbolAlt} alt="Miles" width={12} height={12} />
          <span>{pot.miles.toLocaleString()}</span>
        </span>
      )}
      {pot.miles > 0 && pot.usdt > 0 && <span className="text-slate-400 font-normal">+</span>}
      {pot.usdt > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Image src={usdtSymbolAlt} alt="USDT" width={12} height={12} />
          <span>${pot.usdt.toFixed(2)}</span>
        </span>
      )}
    </span>
  );
}

const NUMBER_COLORS: Record<number, string> = {
  1: "bg-rose-500",
  2: "bg-orange-500",
  3: "bg-amber-500",
  4: "bg-teal-500",
  5: "bg-blue-500",
  6: "bg-violet-500",
};

function shortWinner(displayName: string, winner: string) {
  return displayName ? `@${displayName}` : shortAddress(winner);
}

export function RoundHistoryFeed({ tier }: { tier: DiceTier }) {
  const [rounds, setRounds] = useState<HistoryRound[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Reset when tier changes
    setRounds([]);
    setOpen(false);
  }, [tier]);

  async function load() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dice/round-history?tier=${tier}`);
      if (!res.ok) return;
      const data = await res.json();
      setRounds(data.rounds ?? []);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!open && rounds.length === 0) load();
    setOpen((o) => !o);
  }

  if (rounds.length === 0 && !open && !loading) {
    // Peek-load silently to know if there's anything to show
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Recent rounds
          </span>
          {rounds.length > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
              {rounds.length}
            </span>
          )}
        </div>
        <span className="text-slate-400 text-[11px]">
          {loading ? "…" : open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {loading && (
            <div className="px-3 py-3 text-[11px] text-slate-400 text-center">Loading…</div>
          )}
          {!loading && rounds.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-slate-400 text-center">No completed rounds yet.</div>
          )}
          {rounds.map((r) => (
            <div key={r.roundId} className="flex items-center gap-2.5 px-3 py-2">
              {/* Winning number bubble */}
              <div className={`h-7 w-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[12px] font-extrabold shadow-sm ${NUMBER_COLORS[r.winningNumber] ?? "bg-slate-400"}`}>
                {r.winningNumber}
              </div>

              {/* Winner info */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-800 truncate">
                  {shortWinner(r.displayName, r.winner)}
                </p>
                <p className="text-[9px] text-slate-400">Round #{r.roundId}</p>
              </div>

              {/* Pot value */}
              <PotDisplay pot={r.pot} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
