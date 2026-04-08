"use client";

import { Spinner, CheckCircle, Gift, CurrencyDollar } from "@phosphor-icons/react";
import { AKIBA_TOKEN_SYMBOL, GameSession, RewardClass, SessionStatus, REWARD_META } from "@/lib/clawTypes";
import { formatUnits } from "viem";

type Props = {
  session: GameSession | null;
  onBurn: (sessionId: bigint) => void;
  burning: boolean;
};

export function ClawActionBanner({ session, onBurn, burning }: Props) {
  if (!session || session.status === SessionStatus.None) return null;

  const status  = session.status;
  const rc      = session.rewardClass;
  const reward  = REWARD_META[rc];
  const isVoucher = rc === RewardClass.Rare || rc === RewardClass.Legendary;
  const isClaimed = status === SessionStatus.Claimed;
  const isBurned  = status === SessionStatus.Burned;

  // Format reward amount for display
  const rewardDisplay = () => {
    if (rc === RewardClass.Common) {
      return `${parseFloat(formatUnits(session.rewardAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${AKIBA_TOKEN_SYMBOL}`;
    }
    if (rc === RewardClass.Epic) {
      return `$${parseFloat(formatUnits(session.rewardAmount, 6)).toFixed(2)} USDT`;
    }
    return "";
  };

  return (
    <div
      className="mx-4 rounded-2xl p-3.5 border"
      style={{
        background:
          status === SessionStatus.Pending
            ? "rgba(6,182,212,0.07)"
            : isBurned
            ? "rgba(107,114,128,0.07)"
            : `${reward.color}11`,
        borderColor:
          status === SessionStatus.Pending
            ? "rgba(6,182,212,0.2)"
            : isBurned
            ? "rgba(107,114,128,0.2)"
            : `${reward.color}33`,
      }}
    >
      {/* Pending: settling in progress */}
      {status === SessionStatus.Pending && (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center shrink-0">
            <span className="animate-spin text-cyan-500 inline-flex"><Spinner size={18} /></span>
          </div>
          <div>
            <p className="text-sm font-semibold text-cyan-700">Revealing your prize…</p>
            <p className="text-xs text-cyan-500 mt-0.5">No action needed — claw is moving</p>
          </div>
        </div>
      )}

      {/* Settled: background processing */}
      {status === SessionStatus.Settled && (
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-lg"
            style={{ background: `${reward.color}22` }}
          >
            {reward.emoji}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: reward.color }}>
              {isVoucher ? "Issuing your voucher…" : "Sending your reward…"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {isVoucher
                ? "Voucher is being written to the chain"
                : "Your reward will arrive shortly"}
            </p>
          </div>
        </div>
      )}

      {/* Claimed */}
      {isClaimed && (
        <div>
          <div className="flex items-center gap-2.5 mb-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-lg"
              style={{ background: `${reward.color}22` }}
            >
              {rc === RewardClass.Lose ? (
                <span>💨</span>
              ) : (
                reward.emoji
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">
                {rc === RewardClass.Lose
                  ? "Miss — better luck next time!"
                  : rc === RewardClass.Common
                  ? `${rewardDisplay()} credited!`
                  : rc === RewardClass.Epic
                  ? `${rewardDisplay()} sent to wallet!`
                  : rc === RewardClass.Rare
                  ? "Rare voucher won!"
                  : "Legendary voucher won!"}
              </p>
              {rc !== RewardClass.Lose && (
                <p className="text-xs text-gray-400 mt-0.5">{reward.description}</p>
              )}
            </div>
            {rc !== RewardClass.Lose && (
              <span className="shrink-0" style={{ color: reward.color }}><CheckCircle size={20} weight="fill" /></span>
            )}
          </div>

          {/* Burn button for voucher rewards */}
          {isVoucher && (
            <button
              onClick={() => onBurn(session.sessionId)}
              disabled={burning}
              className="w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-50"
              style={{
                background: rc === RewardClass.Legendary ? "#F59E0B" : "#06B6D4",
                color: "white",
              }}
            >
              {burning ? (
                <span className="animate-spin inline-flex"><Spinner size={16} /></span>
              ) : rc === RewardClass.Rare ? (
                <>
                  <Gift size={15} weight="bold" />
                  Take {AKIBA_TOKEN_SYMBOL} fallback
                </>
              ) : (
                <>
                  <CurrencyDollar size={15} weight="bold" />
                  Take USDT fallback
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Burned */}
      {isBurned && (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <span className="text-gray-400"><CheckCircle size={18} weight="fill" /></span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-500">Voucher burned for fallback</p>
            <p className="text-xs text-gray-400 mt-0.5">Reward has been credited</p>
          </div>
        </div>
      )}
    </div>
  );
}
