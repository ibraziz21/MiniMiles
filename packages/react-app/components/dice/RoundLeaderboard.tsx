// components/dice/RoundLeaderboard.tsx
"use client";

import { useEffect, useState } from "react";
import { type DiceRoundView, shortAddress } from "@/lib/diceTypes";

type RoundLeaderboardProps = {
  round: DiceRoundView;
  myAddress: string | null;
  isDrawing: boolean;
};

async function fetchUsername(address: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/user/username?address=${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.username ?? null;
  } catch {
    return null;
  }
}

export function RoundLeaderboard({ round, myAddress, isDrawing }: RoundLeaderboardProps) {
  const [usernames, setUsernames] = useState<Record<string, string>>({});

  // Fetch usernames for all filled slots whenever the slots change
  useEffect(() => {
    const filledPlayers = round.slots
      .map((s) => s.player)
      .filter((p): p is `0x${string}` => !!p);

    if (filledPlayers.length === 0) return;

    let cancelled = false;
    Promise.all(
      filledPlayers.map(async (addr) => {
        const name = await fetchUsername(addr as string);
        return { addr: (addr as string).toLowerCase(), name };
      })
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const { addr, name } of results) {
        if (name) map[addr] = name;
      }
      setUsernames(map);
    });

    return () => { cancelled = true; };
  }, [round.roundId, round.filledSlots]);

  function displayName(player: `0x${string}`): string {
    const name = usernames[(player as string).toLowerCase()];
    return name ?? shortAddress(player);
  }

  return (
    <div className="divide-y divide-slate-100 bg-white">
      {round.slots.map((slot) => {
        const isMe =
          !!slot.player &&
          !!myAddress &&
          slot.player.toLowerCase() === myAddress.toLowerCase();
        const hasPl = !!slot.player;
        const isWinner = round.winnerSelected && round.winningNumber === slot.number;

        return (
          <div
            key={slot.number}
            className={`flex items-center gap-2.5 px-3 py-1.5 transition-colors ${
              isWinner
                ? "bg-[#238D9D]/5 border-l-2 border-[#238D9D]"
                : isMe
                ? "bg-blue-50/40"
                : ""
            }`}
          >
            {/* number badge */}
            <div className={`flex h-6 w-6 items-center justify-center rounded-full shadow-sm flex-shrink-0 ${
              isWinner
                ? "bg-[#238D9D]"
                : "bg-gradient-to-br from-[#238D9D] to-[#1a7080]"
            }`}>
              <span className="text-[11px] font-extrabold text-white">{slot.number}</span>
            </div>

            {/* player info */}
            <div className="flex-1 min-w-0">
              {hasPl ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-medium text-slate-800 truncate">
                    {displayName(slot.player!)}
                  </span>
                  {isMe && (
                    <span className="rounded-full bg-blue-100 border border-blue-200 px-1.5 py-0.5 text-[8px] font-semibold text-blue-700">
                      You
                    </span>
                  )}
                  {isWinner && (
                    <span className="rounded-full bg-[#238D9D]/10 border border-[#238D9D]/20 px-1.5 py-0.5 text-[8px] font-bold text-[#238D9D]">
                      🏆 Winner
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-slate-400">Open slot</span>
              )}
            </div>

            {/* status */}
            <div className="flex-shrink-0">
              {isWinner ? (
                <span className="text-[#238D9D] text-[13px]">★</span>
              ) : hasPl && isDrawing ? (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-[#238D9D] border-t-transparent animate-spin" />
              ) : hasPl ? (
                <div className="h-2 w-2 rounded-full bg-[#238D9D]" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-slate-200" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
