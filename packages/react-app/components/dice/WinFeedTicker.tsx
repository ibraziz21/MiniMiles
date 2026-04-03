"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { akibaMilesSymbolAlt, usdtSymbol } from "@/lib/svg";

type Pot = { miles: number; usdt: number };

type WinEntry = {
  roundId: string;
  tier: number;
  winner: string;
  displayName: string;
  winningNumber: number;
  pot: Pot;
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const POLL_INTERVAL = 30_000;

export function WinFeedTicker() {
  const [wins, setWins] = useState<WinEntry[]>([]);
  const [visible, setVisible] = useState(true);
  const seenRef = useRef<Set<string>>(new Set());

  async function fetchWins() {
    try {
      const res = await fetch("/api/dice/recent-wins");
      if (!res.ok) return;
      const data = await res.json();
      const fresh: WinEntry[] = (data.wins ?? []).filter(
        (w: WinEntry) => !seenRef.current.has(w.roundId)
      );
      if (fresh.length === 0) return;
      fresh.forEach((w) => seenRef.current.add(w.roundId));
      setWins((prev) => [...fresh, ...prev].slice(0, 20));
    } catch {
      // non-critical
    }
  }

  useEffect(() => {
    fetchWins();
    const id = setInterval(fetchWins, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  if (!visible || wins.length === 0) return null;

  const items = wins.length >= 3 ? wins : [...wins, ...wins, ...wins];

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-[#0f4a52] via-[#165f6a] to-[#0f4a52] border border-[#238D9D]/30 shadow-md">
      {/* Fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 z-10 bg-gradient-to-r from-[#0f4a52] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 z-10 bg-gradient-to-l from-[#0f4a52] to-transparent" />

      {/* Close button */}
      <button
        onClick={() => setVisible(false)}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 text-[#238D9D]/70 hover:text-white text-[11px] leading-none transition"
        aria-label="Hide win feed"
      >
        ✕
      </button>

      {/* Live pill */}
      <div className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1 bg-[#238D9D]/40 rounded-full px-2 py-0.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/80">Live</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[#238D9D] animate-pulse" />
      </div>

      {/* Scrolling track */}
      <div
        className="flex items-center py-2 pl-20 pr-10 gap-6"
        style={{
          width: "max-content",
          animation: `win-ticker-scroll ${items.length * 4}s linear infinite`,
        }}
      >
        {items.map((w, i) => (
          <TickerItem key={`${w.roundId}-${i}`} win={w} />
        ))}
      </div>

      <style>{`
        @keyframes win-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function PotDisplay({ pot }: { pot: Pot }) {
  return (
    <span className="inline-flex items-center gap-1 font-bold text-yellow-300">
      {pot.miles > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Image src={akibaMilesSymbolAlt} alt="Miles" width={13} height={13} className="inline" />
          <span>{pot.miles.toLocaleString()}</span>
        </span>
      )}
      {pot.miles > 0 && pot.usdt > 0 && (
        <span className="text-white/50 font-normal">+</span>
      )}
      {pot.usdt > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Image src={usdtSymbol} alt="USDT" width={13} height={13} className="inline" />
          <span>${pot.usdt.toFixed(2)}</span>
        </span>
      )}
    </span>
  );
}

function TickerItem({ win }: { win: WinEntry }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-white">
      <span className="text-base">🎲</span>
      <span className="text-[#238D9D] font-semibold">
        {win.displayName ? `@${win.displayName}` : shortAddr(win.winner)}
      </span>
      <span className="text-white/70">just won</span>
      <PotDisplay pot={win.pot} />
      <span className="text-white/30 text-[10px] ml-1">· #{win.roundId}</span>
    </span>
  );
}
