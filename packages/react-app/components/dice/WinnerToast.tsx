// components/dice/WinnerToast.tsx
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { shortAddress } from "@/lib/diceTypes";
import { akibaMilesSymbolAlt, usdtSymbolAlt } from "@/lib/svg";

type Pot = { miles: number; usdt: number };

type Props = {
  roundId: bigint;
  winningNumber: number;
  winner: string;
  pot: Pot;
  iWon: boolean;
  onClose: () => void;
};

function PotDisplay({ pot, light }: { pot: Pot; light?: boolean }) {
  const cls = light ? "text-white font-bold" : "text-slate-900 font-bold";
  const sepCls = light ? "text-white/50" : "text-slate-400";
  return (
    <span className={`inline-flex items-center gap-1 ${cls}`}>
      {pot.miles > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Image src={akibaMilesSymbolAlt} alt="" width={13} height={13} className="inline" />
          <span>{pot.miles.toLocaleString()}</span>
        </span>
      )}
      {pot.miles > 0 && pot.usdt > 0 && <span className={`font-normal text-[10px] ${sepCls}`}>+</span>}
      {pot.usdt > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Image src={usdtSymbolAlt} alt="" width={13} height={13} className="inline" />
          <span>${pot.usdt.toFixed(2)}</span>
        </span>
      )}
    </span>
  );
}

export function WinnerToast({ roundId, winningNumber, winner, pot, iWon, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "claiming" | "claimed">("idle");

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!iWon) return;
    const key = `dice_share_claimed_${roundId.toString()}`;
    if (typeof window !== "undefined" && localStorage.getItem(key)) {
      setShareState("claimed");
    }
  }, [roundId, iWon]);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  async function handleShare() {
    if (shareState !== "idle") return;
    setShareState("claiming");

    const milesStr = pot.miles > 0 ? `${pot.miles.toLocaleString()} AkibaMiles` : "";
    const usdtStr = pot.usdt > 0 ? `$${pot.usdt.toFixed(2)} USDT` : "";
    const rewardStr = [milesStr, usdtStr].filter(Boolean).join(" + ");
    const text = encodeURIComponent(
      `I just won ${rewardStr} on Akiba Dice! 🎲🎉 Play at akibamiles.com/dice`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank", "noopener");

    try {
      const res = await fetch("/api/dice/share-win", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: roundId.toString() }),
      });
      const data = await res.json();
      if (data.ok || data.code === "already") {
        const key = `dice_share_claimed_${roundId.toString()}`;
        if (typeof window !== "undefined") localStorage.setItem(key, "1");
        setShareState("claimed");
      } else {
        setShareState("idle");
      }
    } catch {
      setShareState("idle");
    }
  }

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      }`}
    >
      <div className={`rounded-2xl border shadow-xl px-4 py-3 flex items-start gap-3 ${
        iWon
          ? "bg-[#238D9D] border-[#1a7080] text-white shadow-[#238D9D]/40"
          : "bg-white border-slate-200 text-slate-900 shadow-slate-200"
      }`}>
        <span className="text-2xl flex-shrink-0 mt-0.5">{iWon ? "🎉" : "🏆"}</span>

        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${iWon ? "text-white/80" : "text-slate-500"}`}>
            Round #{roundId.toString()} complete
          </p>

          {iWon ? (
            <>
              <p className="text-[14px] font-semibold text-white">You won!</p>
              <p className="text-[12px] mt-0.5">
                <PotDisplay pot={pot} light />
              </p>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-slate-900">Number #{winningNumber} wins</p>
              <p className="text-[11px] mt-0.5 text-slate-500 flex items-center gap-1 flex-wrap">
                <span>{shortAddress(winner)}</span>
                <span>·</span>
                <PotDisplay pot={pot} />
              </p>
            </>
          )}

          {iWon && (
            <button
              onClick={handleShare}
              disabled={shareState !== "idle"}
              className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                shareState === "claimed"
                  ? "bg-white/20 text-white/70 cursor-default"
                  : shareState === "claiming"
                  ? "bg-white/20 text-white/70 cursor-wait"
                  : "bg-white text-[#238D9D] hover:bg-white/90 active:scale-[0.97] shadow-sm"
              }`}
            >
              {shareState === "claimed" ? (
                <>✓ Shared · +10 <Image src={akibaMilesSymbolAlt} alt="" width={11} height={11} className="inline" /> claimed</>
              ) : shareState === "claiming" ? (
                <>Sharing…</>
              ) : (
                <>
                  <span>𝕏</span>
                  Share · earn +10 <Image src={akibaMilesSymbolAlt} alt="" width={11} height={11} className="inline" />
                </>
              )}
            </button>
          )}
        </div>

        <button
          onClick={handleClose}
          className={`flex-shrink-0 text-[13px] leading-none mt-0.5 transition ${
            iWon ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-700"
          }`}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
