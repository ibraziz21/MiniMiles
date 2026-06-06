"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { type ThemeConfig, type CrackPotVersion } from "@/lib/crackpotTypes";
import { TokenAmount } from "./TokenAmount";

type WinScreenProps = {
  potWon: number;
  potWonUsdt?: number;
  totalGuesses: number;
  theme: ThemeConfig;
  version: CrackPotVersion;
  cycleId?: string;
  onClose: () => void;
};

export function WinScreen({ potWon, potWonUsdt, totalGuesses, theme, version, cycleId, onClose }: WinScreenProps) {
  const [visible, setVisible] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "sharing" | "shared">("idle");
  const isUsdt = version === "usdt";

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Fire confetti on mount
  useEffect(() => {
    let cancelled = false;
    import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;

      // Initial burst
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.55 },
        colors: [theme.accentColor, "#fbbf24", "#ffffff", "#34d399"],
      });

      // Side cannons after 400ms
      setTimeout(() => {
        if (cancelled) return;
        confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.6 }, colors: [theme.accentColor, "#fbbf24"] });
        confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.6 }, colors: [theme.accentColor, "#ffffff"] });
      }, 400);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [theme.accentColor]);

  const wonDisplay = isUsdt
    ? `$${(potWonUsdt ?? potWon / 100).toFixed(2)}`
    : `+${potWon.toLocaleString()}`;

  const skillLabel =
    totalGuesses <= 3 ? "🧠 Expert solve!" :
    totalGuesses <= 5 ? "⚡ Skilled!" :
    totalGuesses <= 8 ? "👍 Nice work!" : "🎲 You got lucky!";

  async function handleShare() {
    if (shareState !== "idle") return;
    setShareState("sharing");

    const shareText = `I cracked the CrackPot and won ${wonDisplay} in ${totalGuesses} guess${totalGuesses > 1 ? "es" : ""}! 🔥\n\n${theme.label} theme · AkibaMiles app\n\nCan you crack it? → akibamiles.com/crackpot`;

    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
      }
      // Claim bonus Miles
      if (cycleId) {
        await fetch("/api/crackpot/share-win", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId }),
        });
      }
      setShareState("shared");
    } catch {
      setShareState("idle");
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-6 transition-all duration-400 ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ background: "rgba(0,0,0,0.80)" }}
    >
      <motion.div
        initial={{ scale: 0.82, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 260 }}
        className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl"
      >
        {/* Explosion */}
        <motion.div
          className="text-6xl mb-1"
          animate={{ scale: [1, 1.3, 1], rotate: [0, -8, 8, 0] }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          💥
        </motion.div>
        <div className="text-4xl mb-3">{theme.symbols.slice(0, 4).join(" ")}</div>

        <h2 className="text-3xl font-black text-slate-900 mb-0.5">YOU CRACKED IT!</h2>
        <p className="text-slate-400 text-sm mb-1">{skillLabel}</p>
        <p className="text-slate-400 text-xs mb-5">
          {totalGuesses} guess{totalGuesses > 1 ? "es" : ""} · {theme.label} theme
        </p>

        {/* Winnings */}
        <motion.div
          className="rounded-2xl py-5 px-6 mb-6"
          style={{ backgroundColor: `${theme.accentColor}18`, border: `2px solid ${theme.accentColor}40` }}
          animate={{ boxShadow: [`0 0 0px ${theme.accentColor}00`, `0 0 32px ${theme.accentColor}60`, `0 0 0px ${theme.accentColor}00`] }}
          transition={{ duration: 1.2, repeat: 2 }}
        >
          <TokenAmount
            amount={wonDisplay}
            isUsdt={isUsdt}
            symbolSize={40}
            textClass="text-5xl font-black"
            gap="gap-3"
          />
          <div className="text-sm font-medium text-slate-500 mt-2">won</div>
        </motion.div>

        {/* Share card — earns bonus Miles */}
        <motion.button
          onClick={handleShare}
          disabled={shareState === "sharing"}
          whileTap={{ scale: 0.97 }}
          className={`w-full py-3 rounded-2xl font-bold text-sm mb-2 transition-all border-2 flex items-center justify-center gap-2 ${
            shareState === "shared"
              ? "bg-green-50 border-green-300 text-green-700"
              : "bg-white border-slate-200 text-slate-700"
          }`}
        >
          {shareState === "shared" ? (
            <>✓ Shared! +10 <span className="text-[11px]">Miles bonus</span></>
          ) : shareState === "sharing" ? (
            "Sharing…"
          ) : (
            <>📤 Share win · earn +10 <span className="text-[11px] font-normal">Miles</span></>
          )}
        </motion.button>

        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-2xl font-bold text-white transition-all active:scale-[0.98]"
          style={{ backgroundColor: theme.accentColor }}
        >
          Claim & Continue
        </button>
      </motion.div>
    </div>
  );
}
