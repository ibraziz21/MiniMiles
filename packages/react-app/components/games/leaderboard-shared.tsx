"use client";

// Shared leaderboard row pieces — used by leaderboard-card.tsx (in-game daily
// + weekly widget) and app/games/challenge/page.tsx (the weekly challenge
// destination). Keep in one place rather than duplicating avatar/name logic.

import { Trophy, Medal } from "@phosphor-icons/react";

export const RANK_ICONS = [
  <Trophy key="1" size={13} weight="fill" className="text-yellow-500" />,
  <Medal key="2" size={13} weight="fill" className="text-slate-400" />,
  <Medal key="3" size={13} weight="fill" className="text-orange-400" />,
];

export function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function displayName(entry: { username?: string | null; walletAddress: string }) {
  if (entry.username) return `@${entry.username}`;
  return shortAddress(entry.walletAddress);
}

export function avatarBg(addr: string) {
  const palette = [
    "bg-purple-200 text-purple-700",
    "bg-teal-200 text-teal-700",
    "bg-orange-200 text-orange-700",
    "bg-pink-200 text-pink-700",
    "bg-blue-200 text-blue-700",
  ];
  return palette[addr ? addr.charCodeAt(2) % palette.length : 0];
}

export type EntryRowEntry = {
  username?: string | null;
  walletAddress: string;
  score: number;
};

/**
 * A single leaderboard row. Pass `prizeLabel` for ranks 1–3 on a page that
 * shows the prize zone inline (the challenge page) — leave it undefined for
 * the plain in-game widget.
 */
export function EntryRow({
  entry,
  rank,
  isYou,
  prizeLabel,
}: {
  entry: EntryRowEntry;
  rank: number;
  isYou: boolean;
  prizeLabel?: string | null;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${isYou ? "bg-[#F0FDFF]" : ""}`}>
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F5F5]">
        {rank <= 3 ? RANK_ICONS[rank - 1] : (
          <span className="text-xs font-bold text-[#525252]">#{rank}</span>
        )}
      </div>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg(entry.walletAddress)}`}>
        {entry.walletAddress.slice(2, 4).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-[#1A1A1A] truncate">{displayName(entry)}</p>
          {isYou && (
            <span className="text-[10px] font-bold text-[#238D9D] bg-[#238D9D1A] rounded-full px-1.5 py-0.5 flex-shrink-0">You</span>
          )}
        </div>
        {!entry.username && (
          <p className="text-xs text-[#817E7E] truncate">{shortAddress(entry.walletAddress)}</p>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
        <p className="text-sm font-bold text-[#238D9D]">{entry.score} pts</p>
        {prizeLabel && (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
            {prizeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/** "— prize zone —" cut line between rank 3 and rank 4. */
export function PrizeZoneDivider() {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <div className="h-px flex-1 bg-[#F0F0F0]" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#B0B0B0]">
        prize zone
      </span>
      <div className="h-px flex-1 bg-[#F0F0F0]" />
    </div>
  );
}
