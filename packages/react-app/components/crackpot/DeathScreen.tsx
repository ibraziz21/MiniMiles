"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { type ThemeConfig, type CrackPotVersion, CRACKPOT_PEGS } from "@/lib/crackpotTypes";
import { TokenAmount } from "./TokenAmount";

type DeathScreenProps = {
  potLost: number;
  version: CrackPotVersion;
  theme: ThemeConfig;
  bestLockedCount: number | null;      // this player's best
  communityBestLocked: number | null;  // best across all players
  totalAttempts: number;
  nextCycleIn: number;
  onClose: () => void;
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Shake keyframes: rapid horizontal displacement
const SHAKE_KEYFRAMES = [0, -10, 10, -8, 8, -5, 5, -2, 2, 0];

export function DeathScreen({ potLost, version, theme, bestLockedCount, communityBestLocked, totalAttempts, nextCycleIn, onClose }: DeathScreenProps) {
  const [visible, setVisible] = useState(false);
  const [shake, setShake] = useState(false);
  const isUsdt = version === "usdt";

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    // Trigger shake 300ms after appearing
    const s = setTimeout(() => setShake(true), 330);
    return () => { clearTimeout(t); clearTimeout(s); };
  }, []);

  const nearMiss = bestLockedCount !== null && bestLockedCount >= CRACKPOT_PEGS - 1;
  const lostDisplay = isUsdt ? `$${(potLost / 100).toFixed(2)}` : potLost.toLocaleString();

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-6 transition-all duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ background: "rgba(0,0,0,0.88)" }}
    >
      <motion.div
        animate={shake ? { x: SHAKE_KEYFRAMES } : {}}
        transition={shake ? { duration: 0.55, ease: "easeOut" } : {}}
        onAnimationComplete={() => setShake(false)}
        className="w-full max-w-sm"
      >
        <motion.div
          initial={{ scale: 0.88, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: "spring", damping: 22, stiffness: 240 }}
          className="rounded-3xl bg-slate-900 p-8 text-center shadow-2xl"
        >
          {/* Imploded pot */}
          <motion.div
            className="text-6xl mb-3 opacity-70"
            animate={{ scale: [1, 0.7, 1.05, 1], opacity: [1, 0.4, 0.7, 0.7] }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            💀
          </motion.div>

          <h2 className="text-2xl font-black text-white mb-1">Pot Imploded</h2>

          {/* Lost amount */}
          <div className="flex items-center justify-center gap-1.5 mb-5">
            <TokenAmount
              amount={lostDisplay}
              isUsdt={isUsdt}
              symbolSize={16}
              textClass="text-slate-400 text-base font-medium"
              gap="gap-1.5"
            />
            <span className="text-slate-500 text-sm">gone. Nobody cracked it.</span>
          </div>

          {/* Player's best */}
          {bestLockedCount !== null && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className={`rounded-2xl py-4 px-5 mb-5 border ${nearMiss
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-slate-700 bg-slate-800"}`}
            >
              <div className={`text-3xl font-black ${nearMiss ? "text-amber-400" : "text-slate-300"}`}>
                {bestLockedCount}/{CRACKPOT_PEGS}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {nearMiss ? "SO CLOSE — one position away" : "best positions locked"}
              </div>
              {nearMiss && (
                <div className="mt-2 text-xs text-amber-400/80">
                  Next cycle starts fresh. You know the strategy now.
                </div>
              )}
            </motion.div>
          )}

          {/* Community near-miss */}
          {communityBestLocked !== null && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="rounded-2xl border border-slate-700 bg-slate-800 py-3 px-4 mb-4"
            >
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Community · {totalAttempts} attempt{totalAttempts !== 1 ? "s" : ""} this cycle
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Closest anyone got</span>
                <span className={`text-lg font-black ${communityBestLocked >= CRACKPOT_PEGS - 1 ? "text-amber-400" : "text-slate-400"}`}>
                  {communityBestLocked}/{CRACKPOT_PEGS} 🔒
                </span>
              </div>
              {/* Community bar */}
              <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-amber-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${(communityBestLocked / CRACKPOT_PEGS) * 100}%` }}
                  transition={{ delay: 0.7, duration: 0.5 }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                {communityBestLocked === 0
                  ? "Nobody found a single lock. The code was brutal."
                  : communityBestLocked === 1
                  ? "Only 1 position cracked across everyone. Tough cycle."
                  : communityBestLocked < CRACKPOT_PEGS - 1
                  ? "Progress, but no one finished. Come back tomorrow."
                  : communityBestLocked === CRACKPOT_PEGS - 1
                  ? `Someone had ${CRACKPOT_PEGS - 1}/${CRACKPOT_PEGS} and couldn't close. So close it hurts.`
                  : "Someone had it all locked — ran out of time."}
              </p>
            </motion.div>
          )}

          {/* Next cycle */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="rounded-xl bg-slate-800 py-3 px-4 mb-6 text-sm text-slate-300"
          >
            New pot starts in <span className="font-bold text-white">{formatTime(nextCycleIn)}</span>
          </motion.div>

          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl font-bold text-white bg-slate-700 hover:bg-slate-600 transition-all active:scale-[0.98]"
          >
            Back to Home
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
