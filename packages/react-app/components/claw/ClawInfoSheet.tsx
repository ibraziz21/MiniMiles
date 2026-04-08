"use client";

import { X } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AKIBA_TOKEN_SYMBOL, TIER_META } from "@/lib/clawTypes";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

const ODDS_TABLE = [
  { label: "Miss",       emoji: "💨", basic: "60.0%", boosted: "58.0%", premium: "55.0%" },
  { label: AKIBA_TOKEN_SYMBOL, emoji: "🪙", basic: "32.0%", boosted: "32.0%", premium: "32.0%" },
  { label: "Voucher",    emoji: "🎟️", basic: "6.0%",  boosted: "7.0%",  premium: "9.0%"  },
  { label: "USDT",       emoji: "💎", basic: "1.8%",  boosted: "2.6%",  premium: "3.6%"  },
  { label: "Legendary",  emoji: "⭐", basic: "0.2%",  boosted: "0.4%",  premium: "0.4%"  },
];

const REWARD_LEGEND = [
  {
    emoji: "🪙",
    title: `Common — ${AKIBA_TOKEN_SYMBOL}`,
    desc: "AkibaMiles credited directly to your wallet balance.",
    color: "#22C55E",
  },
  {
    emoji: "💎",
    title: "Epic — USDT",
    desc: "USDT paid directly to your wallet address.",
    color: "#8B5CF6",
  },
  {
    emoji: "🎟️",
    title: "Rare — 20% Voucher",
    desc: `A 20% off merchant voucher. Burn any time for an ${AKIBA_TOKEN_SYMBOL} fallback.`,
    color: "#06B6D4",
  },
  {
    emoji: "⭐",
    title: "Legendary — Full Voucher",
    desc: "Capped full-value voucher (100% off up to max). Burn for a USDT fallback.",
    color: "#F59E0B",
  },
];

const CONTRACTS = [
  { label: "AkibaClawGame",       addr: "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3" },
  { label: "MerkleBatchRng",      addr: "0x249Ce901411809a8A0fECa6102D9F439bbf3751e" },
  { label: "AkibaVoucherRegistry",addr: "0xdBFF182cc08e946FF92C5bA575140E41Ea8e63bC" },
  { label: "AkibaRewardVault",    addr: "0xE7eAF0c4070Dc3bcb9AF085353e67bdb3d22228F" },
];

export function ClawInfoSheet({ open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] p-0 flex flex-col bg-white">
        <SheetHeader className="px-4 pt-4 pb-2 flex flex-row items-center justify-between shrink-0 border-b border-gray-100">
          <SheetTitle className="text-base font-bold">How it works</SheetTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
          >
            <X size={15} weight="bold" />
          </button>
        </SheetHeader>

        <div className="overflow-y-auto flex-1 pb-10 space-y-6 pt-4 px-4">
          {/* Beta note */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <p className="text-xs text-amber-700 font-medium">
              🧪 Beta — Odds and rewards shown below are indicative. Onchain tier configs are authoritative.
            </p>
          </div>

          {/* Odds table */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 mb-3">Odds by Tier</h3>
            <div className="rounded-2xl border border-gray-100 overflow-hidden bg-white">
              {/* Header */}
              <div className="grid grid-cols-4 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <div className="px-3 py-2">Outcome</div>
                {[0, 1, 2].map((id) => (
                  <div
                    key={id}
                    className="px-2 py-2 text-center"
                    style={{ color: TIER_META[id].accent }}
                  >
                    {TIER_META[id].name}
                  </div>
                ))}
              </div>
              {/* Rows */}
              {ODDS_TABLE.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-4 border-t border-gray-50 text-sm"
                >
                  <div className="px-3 py-2.5 flex items-center gap-1.5 font-medium text-gray-700">
                    <span>{row.emoji}</span>
                    <span className="text-xs">{row.label}</span>
                  </div>
                  <div className="px-2 py-2.5 text-center text-xs text-gray-500">{row.basic}</div>
                  <div className="px-2 py-2.5 text-center text-xs text-gray-500">{row.boosted}</div>
                  <div className="px-2 py-2.5 text-center text-xs text-gray-500">{row.premium}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Reward legend */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 mb-3">Reward Legend</h3>
            <div className="space-y-2">
              {REWARD_LEGEND.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl p-3 border"
                  style={{ borderColor: `${r.color}33`, background: `${r.color}08` }}
                >
                  <span className="text-xl shrink-0">{r.emoji}</span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: r.color }}>
                      {r.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Contracts */}
          <section>
            <h3 className="text-sm font-bold text-gray-700 mb-3">Contracts (Celo)</h3>
            <div className="space-y-1.5">
              {CONTRACTS.map((c, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                  <span className="text-xs font-medium text-gray-600">{c.label}</span>
                  <span className="text-[10px] font-mono text-gray-400">
                    {c.addr.slice(0, 6)}…{c.addr.slice(-4)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
