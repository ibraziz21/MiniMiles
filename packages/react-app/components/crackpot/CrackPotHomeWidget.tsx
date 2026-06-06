"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { TokenAmount } from "./TokenAmount";

type CycleSnap = {
  potBalance: number;
  potBalanceUsdt?: number;
  version: "miles" | "usdt";
  secondsRemaining: number;
  status: "active" | "cracked" | "dead";
  potState: string;
};

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function PotTicker({ cycle }: { cycle: CycleSnap }) {
  const [tick, setTick] = useState(cycle.secondsRemaining);
  const isUsdt = cycle.version === "usdt";
  const isCritical = tick < 300; // last 5 minutes

  useEffect(() => {
    setTick(cycle.secondsRemaining);
    const id = setInterval(() => setTick((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [cycle.secondsRemaining]);

  const displayAmount = isUsdt
    ? `$${(cycle.potBalanceUsdt ?? cycle.potBalance / 100).toFixed(2)}`
    : cycle.potBalance.toLocaleString();

  return (
    <div className="flex items-center justify-between gap-3">
      {/* Pot amount */}
      <div className="flex items-center gap-2 min-w-0">
        <motion.div
          key={cycle.potBalance}
          initial={{ scale: 1.15, color: "#f59e0b" }}
          animate={{ scale: 1, color: "#ffffff" }}
          transition={{ duration: 0.4 }}
        >
          <TokenAmount
            amount={displayAmount}
            isUsdt={isUsdt}
            symbolSize={18}
            textClass="text-2xl font-black text-white"
            gap="gap-1.5"
          />
        </motion.div>
        <span className="text-xs text-white/60 font-medium">in the pot</span>
      </div>

      {/* Countdown */}
      <div className="text-right shrink-0">
        <p className="text-[10px] text-white/50 uppercase tracking-wide">resets in</p>
        <motion.p
          className={`text-base font-bold tabular-nums ${isCritical ? "text-red-300" : "text-white"}`}
          animate={isCritical ? { opacity: [1, 0.5, 1] } : {}}
          transition={isCritical ? { repeat: Infinity, duration: 1 } : {}}
        >
          {formatCountdown(tick)}
        </motion.p>
      </div>
    </div>
  );
}

export function CrackPotHomeWidget() {
  const [milesCycle, setMilesCycle] = useState<CycleSnap | null>(null);
  const [loading, setLoading] = useState(true);
  const [socialStats, setSocialStats] = useState<{ watchingCount: number; activePlayers: number; totalAttempts: number } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [cycleRes, feedRes] = await Promise.all([
          fetch("/api/crackpot/cycle/current?version=miles"),
          fetch("/api/crackpot/feed?version=miles"),
        ]);
        if (cycleRes.ok) {
          const data = await cycleRes.json();
          if (data.cycle) setMilesCycle(data.cycle);
        }
        if (feedRes.ok) {
          const feed = await feedRes.json();
          setSocialStats({ watchingCount: feed.watchingCount ?? 0, activePlayers: feed.activePlayers ?? 0, totalAttempts: feed.totalAttempts ?? 0 });
        }
      } catch {
        // silently skip — widget is non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);

  if (loading || !milesCycle) return null;

  const potState = milesCycle.potState;
  const glowColor =
    potState === "burning" ? "rgba(239,68,68,0.4)"
    : potState === "hot"   ? "rgba(251,146,60,0.3)"
    : potState === "growing" ? "rgba(34,197,94,0.2)"
    : "rgba(35,141,157,0.2)";

  const pulseClass =
    potState === "burning" ? "animate-bounce"
    : potState === "hot"   ? "animate-pulse"
    : "";

  return (
    <Link href="/crackpot" className="block mx-4 mt-4">
      <motion.div
        whileTap={{ scale: 0.98 }}
        className="relative overflow-hidden rounded-2xl px-4 py-3.5"
        style={{
          background: "linear-gradient(135deg, #1a2a3a 0%, #0f1f2e 100%)",
          boxShadow: `0 4px 24px ${glowColor}`,
        }}
      >
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-4 right-16 h-14 w-14 rounded-full bg-white/5" />

        {/* Header row */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className={`text-2xl ${pulseClass}`}>
              {potState === "burning" ? "🔥"
                : potState === "hot" ? "🌡️"
                : potState === "cracked" ? "💥"
                : "🫙"}
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                CrackPot · Live
              </p>
              <p className="text-sm font-bold text-white leading-tight">
                Crack the code. Win the pot.
              </p>
            </div>
          </div>
          <div className="rounded-full bg-white/15 border border-white/20 px-3 py-1.5">
            <span className="text-[12px] font-bold text-white">Enter →</span>
          </div>
        </div>

        {/* Live pot ticker */}
        <div className="rounded-xl bg-white/8 border border-white/10 px-3 py-2.5">
          <PotTicker cycle={milesCycle} />
        </div>

        {/* Social strip */}
        {socialStats && (socialStats.watchingCount > 0 || socialStats.activePlayers > 0 || socialStats.totalAttempts > 0) && (
          <div className="flex items-center gap-3 mt-2 px-1">
            {socialStats.activePlayers > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-white/50">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
                </span>
                <span className="text-green-400 font-semibold">{socialStats.activePlayers}</span> guessing now
              </span>
            )}
            {socialStats.watchingCount > 1 && (
              <span className="text-[10px] text-white/40">
                {socialStats.watchingCount} watching
              </span>
            )}
            {socialStats.totalAttempts > 0 && (
              <span className="text-[10px] text-white/40 ml-auto">
                {socialStats.totalAttempts} attempts this cycle
              </span>
            )}
          </div>
        )}

        {/* Pulse dot — live indicator */}
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
          </span>
          <span className="text-[9px] text-white/40 font-medium">LIVE</span>
        </div>
      </motion.div>
    </Link>
  );
}
