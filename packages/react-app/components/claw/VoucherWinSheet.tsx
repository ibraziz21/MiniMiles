"use client";

import { X, Gift, CurrencyDollar, ShareNetwork } from "@phosphor-icons/react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AKIBA_TOKEN_SYMBOL, GameSession, RewardClass, SessionStatus, REWARD_META, TIER_META } from "@/lib/clawTypes";

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

  const rc       = session.rewardClass;
  const reward   = REWARD_META[rc];
  const tierMeta = TIER_META[session.tierId] ?? TIER_META[0];
  const isLegendary = rc === RewardClass.Legendary;

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: "I won at Akiba Claw!",
        text: `I just won a ${reward.label} on Akiba Claw! 🎰`,
      }).catch(() => {});
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 overflow-hidden bg-white"
        style={{
          background: `linear-gradient(160deg, ${reward.color}14 0%, #ffffff 50%)`,
        }}
      >
        {/* Close */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center border border-gray-100"
        >
          <span className="text-gray-500"><X size={14} weight="bold" /></span>
        </button>

        <div className="px-5 pt-8 pb-10 flex flex-col items-center text-center">
          {/* Trophy animation */}
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center mb-4 text-5xl animate-bounce"
            style={{
              background: `${reward.color}18`,
              boxShadow: `0 0 40px ${reward.color}44`,
            }}
          >
            {reward.emoji}
          </div>

          {/* Win headline */}
          <div
            className="text-xs font-bold uppercase tracking-widest mb-1"
            style={{ color: reward.color }}
          >
            {isLegendary ? "Legendary Drop!" : "Rare Win!"}
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-1">
            {isLegendary ? "Full-Value Voucher" : "20% Voucher"}
          </h2>
          <p className="text-sm text-gray-500 mb-1">
            {tierMeta.name} tier · Session #{session.sessionId.toString()}
          </p>
          <p className="text-sm text-gray-400 leading-relaxed mb-6 max-w-xs">
            {isLegendary
              ? "You've won a capped full-value merchant voucher. Keep it to use in a merchant store, or burn it for a USDT fallback."
              : `You've won a 20% off merchant voucher. Keep it to use in a merchant store, or burn it for an ${AKIBA_TOKEN_SYMBOL} fallback.`}
          </p>

          {/* Voucher preview card */}
          <div
            className="w-full rounded-2xl p-4 border mb-6"
            style={{
              borderColor: `${reward.color}44`,
              background: `${reward.color}0A`,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="text-left">
                <p className="text-xs text-gray-400">Discount</p>
                <p className="text-xl font-black" style={{ color: reward.color }}>
                  {isLegendary ? "100% off" : "20% off"}
                </p>
                {isLegendary && (
                  <p className="text-xs text-gray-400">Up to capped value</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Valid for</p>
                <p className="text-sm font-bold text-gray-700">14 days</p>
                <p className="text-xs text-gray-400">Any merchant</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="w-full space-y-2.5">
            {/* Keep */}
            <button
              onClick={onKeep}
              className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
              style={{ background: reward.color }}
            >
              Keep my voucher →
            </button>

            {/* Burn fallback */}
            <button
              onClick={onBurn}
              disabled={burning}
              className="w-full h-12 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
              style={{
                borderColor: `${reward.color}44`,
                color: reward.color,
                background: `${reward.color}08`,
              }}
            >
              {isLegendary ? (
                <>
                  <CurrencyDollar size={16} weight="bold" />
                  Burn for USDT instead
                </>
              ) : (
                <>
                  <Gift size={16} weight="bold" />
                  Burn for {AKIBA_TOKEN_SYMBOL} instead
                </>
              )}
            </button>

            {/* Share */}
            <button
              onClick={handleShare}
              className="w-full h-10 rounded-xl text-xs font-medium text-gray-400 flex items-center justify-center gap-1.5"
            >
              <ShareNetwork size={14} />
              Share your win
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
