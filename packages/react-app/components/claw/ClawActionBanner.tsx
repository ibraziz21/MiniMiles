"use client";

import { Spinner } from "@phosphor-icons/react";
import { GameSession, RewardClass, SessionStatus, REWARD_META } from "@/lib/clawTypes";

type Props = {
  session: GameSession | null;
};

export function ClawActionBanner({ session }: Props) {
  if (!session) return null;

  const status    = session.status;
  const rc        = session.rewardClass;
  const reward    = REWARD_META[rc];
  const isVoucher = rc === RewardClass.Rare || rc === RewardClass.Legendary;

  // Only show during in-progress states — claimed/burned handled by Sessions sheet
  if (status !== SessionStatus.Pending && status !== SessionStatus.Settled) return null;

  const isPending = status === SessionStatus.Pending;

  return (
    <div className="px-4">
      <div
        className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5"
        style={{
          background: isPending ? "rgba(6,182,212,0.07)" : `${reward.color}0D`,
          border: `1px solid ${isPending ? "rgba(6,182,212,0.2)" : `${reward.color}2A`}`,
        }}
      >
        {isPending ? (
          <span className="animate-spin text-cyan-500 inline-flex shrink-0">
            <Spinner size={15} />
          </span>
        ) : (
          <span className="shrink-0 text-base leading-none">{reward.emoji}</span>
        )}
        <p
          className="text-xs font-semibold truncate"
          style={{ color: isPending ? "#0891B2" : reward.color }}
        >
          {isPending
            ? "Revealing your prize…"
            : isVoucher
            ? "Issuing your voucher…"
            : "Sending your reward…"}
        </p>
      </div>
    </div>
  );
}
