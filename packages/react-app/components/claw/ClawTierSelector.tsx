"use client";

import Image from "next/image";
import { TierConfig, TIER_META } from "@/lib/clawTypes";
import { akibaMilesSymbol } from "@/lib/svg";
import { formatUnits } from "viem";

type Props = {
  tiers: (TierConfig | null)[];
  selectedTier: number;
  onSelect: (tierId: number) => void;
};

function milesCostLabel(tier: TierConfig): string {
  return parseFloat(formatUnits(tier.playCost, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function usdtCostLabel(tier: TierConfig): string {
  return `$${parseFloat(formatUnits(tier.playCost, 6)).toFixed(2)}`;
}

export function ClawTierSelector({ tiers, selectedTier, onSelect }: Props) {
  return (
    <div className="px-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Choose tier
      </p>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((tierId) => {
          const tier   = tiers[tierId];
          const meta   = TIER_META[tierId];
          const active = selectedTier === tierId;

          return (
            <button
              key={tierId}
              onClick={() => tier?.active && onSelect(tierId)}
              disabled={!tier?.active}
              className="rounded-2xl p-3 text-left transition-all border-2 disabled:opacity-40"
              style={{
                borderColor: active ? meta.accent : "transparent",
                background: active ? meta.bg : "white",
                boxShadow: active
                  ? `0 0 0 1px ${meta.accent}44, 0 4px 12px ${meta.accent}22`
                  : "0 1px 4px rgba(0,0,0,0.06)",
              }}
            >
              {/* Accent dot */}
              <div
                className="w-5 h-5 rounded-full mb-1.5 flex items-center justify-center"
                style={{ background: `${meta.accent}22` }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: meta.accent }}
                />
              </div>

              <p className="text-xs font-bold text-gray-800 leading-none mb-0.5">
                {meta.name}
              </p>
              <p className="text-[10px] text-gray-400 leading-none">
                {tier ? (tier.payInMiles ? "Pay in AkibaMiles" : "Pay in USDT") : "—"}
              </p>
              {tier ? (
                <div
                  className="text-sm font-extrabold mt-1.5 leading-none flex items-center gap-1"
                  style={{ color: meta.accent }}
                >
                  {tier.payInMiles ? (
                    <>
                      <Image src={akibaMilesSymbol} alt="" width={14} height={14} />
                      <span>{milesCostLabel(tier)}</span>
                    </>
                  ) : (
                    <span>{usdtCostLabel(tier)}</span>
                  )}
                </div>
              ) : (
                <p
                  className="text-sm font-extrabold mt-1.5 leading-none"
                  style={{ color: meta.accent }}
                >
                  —
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
