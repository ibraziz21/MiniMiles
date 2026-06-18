"use client";

import { X, Gift, Confetti } from "@phosphor-icons/react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AKIBA_TOKEN_SYMBOL, GameSession, RewardClass, REWARD_META, TIER_META } from "@/lib/clawTypes";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  session: GameSession | null;
  onKeep: () => void;
  onBurn: () => void;
  burning: boolean;
};

export function VoucherWinSheet({ open, onOpenChange, session, onKeep, onBurn, burning }: Props) {
  if (!session) return null;

  const rc          = session.rewardClass;
  const reward      = REWARD_META[rc];
  const tierMeta    = TIER_META[session.tierId] ?? TIER_META[0];
  const isLegendary = rc === RewardClass.Legendary;

  // Legendary = amber/gold palette, Rare = cyan palette
  const accent   = isLegendary ? "#F59E0B" : "#06B6D4";
  const accentBg = isLegendary ? "#FEF3C7" : "#ECFEFF";
  const badgeBg  = isLegendary ? "#FFFBEB" : "#F0FDFF";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 overflow-hidden"
        style={{ background: accentBg }}
      >
        {/* Close */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center border border-gray-100 shadow-sm"
        >
          <X size={14} weight="bold" className="text-gray-500" />
        </button>

        {/* Top glow strip */}
        <div
          className="absolute top-0 left-0 right-0 h-1 rounded-t-3xl"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
        />

        <div className="px-5 pt-8 pb-10 flex flex-col items-center">

          {/* Badge */}
          <div
            className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest mb-5"
            style={{ background: badgeBg, color: accent, border: `1px solid ${accent}33` }}
          >
            {isLegendary ? "⭐ Legendary Drop" : "🎟️ Rare Win"}
          </div>

          {/* Voucher card */}
          <div
            className="w-full rounded-3xl shadow-lg overflow-hidden mb-6"
            style={{
              background: `linear-gradient(135deg, ${accent}22 0%, white 60%, ${accent}11 100%)`,
              border: `1.5px solid ${accent}44`,
            }}
          >
            {/* Card top strip */}
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ background: `${accent}18`, borderBottom: `1px dashed ${accent}33` }}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: accent }}>
                  {isLegendary ? "Full-Value Merchant Voucher" : "20% Merchant Voucher"}
                </p>
                <p className="text-3xl font-black mt-0.5" style={{ color: accent }}>
                  {isLegendary ? "100% off" : "20% off"}
                </p>
                {isLegendary && (
                  <p className="text-[11px] text-gray-400 mt-0.5">Up to capped value</p>
                )}
              </div>
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: `${accent}18` }}
              >
                {reward.emoji}
              </div>
            </div>

            {/* Card bottom meta */}
            <div className="px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400">Tier</p>
                <p className="text-sm font-bold" style={{ color: tierMeta.accent }}>{tierMeta.name}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-400">Valid for</p>
                <p className="text-sm font-bold text-gray-700">14 days</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400">Use at</p>
                <p className="text-sm font-bold text-gray-700">Any merchant</p>
              </div>
            </div>
          </div>

          {/* Tagline */}
          <p className="text-sm text-gray-500 text-center leading-relaxed mb-6 max-w-xs">
            {isLegendary
              ? "You've won a full-value voucher — use it at any partnered merchant."
              : `Use this 20% voucher at any merchant, or burn it now for an ${AKIBA_TOKEN_SYMBOL} fallback.`}
          </p>

          {/* Actions */}
          <div className="w-full space-y-3">
            {/* Keep */}
            <button
              onClick={onKeep}
              className="w-full h-13 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-md active:scale-[0.98] transition-transform"
              style={{
                background: `linear-gradient(135deg, ${accent}, ${isLegendary ? "#D97706" : "#0891B2"})`,
                boxShadow: `0 4px 14px ${accent}55`,
                height: 52,
              }}
            >
              <Confetti size={18} weight="fill" />
              Keep my voucher
            </button>

            {!isLegendary && (
              <button
                onClick={onBurn}
                disabled={burning}
                className="w-full rounded-2xl text-sm font-semibold border flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                style={{
                  height: 48,
                  borderColor: `${accent}44`,
                  color: accent,
                  background: "white",
                }}
              >
                <Gift size={15} weight="bold" className="shrink-0" />
                <span>Burn for {AKIBA_TOKEN_SYMBOL} fallback</span>
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
