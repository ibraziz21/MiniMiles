"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type CrackPotVersion, CRACKPOT_PEGS } from "@/lib/crackpotTypes";

type FeedData = {
  entries: { address: string; startedAt: string; attemptNumber: number }[];
  activePlayers: number;
  totalAttempts: number;
  bestLocked: number | null;
  watchingCount: number;
  lastWinner: { address: string; guesses: number; potBalance: number } | null;
};

type LiveFeedProps = {
  version: CrackPotVersion;
  accentColor: string;
  onWinnerDetected?: (winner: FeedData["lastWinner"]) => void;
};

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)  return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

// Stable hue from any display label (works for usernames and addresses alike).
function labelHue(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) & 0xffff;
  }
  return hash % 360;
}

export function LiveFeed({ version, accentColor, onWinnerDetected }: LiveFeedProps) {
  const [data, setData] = useState<FeedData | null>(null);
  const [newEntryKey, setNewEntryKey] = useState<string | null>(null);
  const prevTopRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/crackpot/feed?version=${version}`);
        if (!res.ok || cancelled) return;
        const fresh: FeedData = await res.json();
        setData(fresh);

        // Detect new entry — animate it in
        const topEntry = fresh.entries[0]?.startedAt ?? null;
        if (topEntry && topEntry !== prevTopRef.current) {
          setNewEntryKey(topEntry);
          prevTopRef.current = topEntry;
        }

        // Surface winner to parent
        if (fresh.lastWinner) onWinnerDetected?.(fresh.lastWinner);
      } catch { /* silent */ }
    }

    poll();
    const id = setInterval(poll, 8_000); // fast poll — social data
    return () => { cancelled = true; clearInterval(id); };
  }, [version, onWinnerDetected]);

  if (!data) return null;

  const { entries, activePlayers, totalAttempts, bestLocked, watchingCount } = data;

  return (
    <div className="w-full space-y-2">
      {/* Social stats bar */}
      <div className="flex items-center gap-3 text-[11px] text-slate-400 px-1">
        {activePlayers > 0 && (
          <span className="flex items-center gap-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
            </span>
            <span className="font-semibold text-green-600">{activePlayers}</span> guessing now
          </span>
        )}
        {watchingCount > 0 && (
          <span>{watchingCount} watching</span>
        )}
        {totalAttempts > 0 && (
          <span>{totalAttempts} attempt{totalAttempts !== 1 ? "s" : ""} this cycle</span>
        )}
        {bestLocked !== null && bestLocked > 0 && (
          <span className="ml-auto font-medium" style={{ color: bestLocked >= 3 ? "#f59e0b" : undefined }}>
            Best: {bestLocked}/{CRACKPOT_PEGS} 🔒
          </span>
        )}
      </div>

      {/* Entry ticker */}
      {entries.length > 0 && (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Live attempts</span>
            <span className="text-[10px] text-slate-400">{entries.length} recent</span>
          </div>
          <div className="divide-y divide-slate-50 max-h-[140px] overflow-y-auto">
            <AnimatePresence initial={false}>
              {entries.slice(0, 6).map((entry, i) => {
                const isNew = entry.startedAt === newEntryKey;
                return (
                  <motion.div
                    key={entry.startedAt}
                    initial={isNew ? { backgroundColor: `${accentColor}20`, opacity: 0, height: 0 } : false}
                    animate={{ backgroundColor: "transparent", opacity: 1, height: "auto" }}
                    transition={{ duration: 0.35 }}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {/* Identicon-style dot */}
                      <div
                        className="w-5 h-5 rounded-full shrink-0"
                        style={{
                          background: `hsl(${labelHue(entry.address)}deg 60% 65%)`,
                        }}
                      />
                      <span className="text-xs font-medium text-slate-600 truncate max-w-[140px]">{entry.address}</span>
                      {entry.attemptNumber > 1 && (
                        <span className="text-[9px] bg-slate-100 text-slate-400 rounded-full px-1.5 py-0.5 font-medium">
                          attempt {entry.attemptNumber}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-300 shrink-0">{timeAgo(entry.startedAt)}</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
