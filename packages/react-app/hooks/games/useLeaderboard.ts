"use client";

import { useCallback, useEffect, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import type { GameType, LeaderboardEntry } from "@/lib/games/types";

export function useLeaderboard(gameType: GameType) {
  const { address } = useWeb3();
  const [entries,   setEntries]   = useState<LeaderboardEntry[]>([]);
  const [myBest,    setMyBest]    = useState<LeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ gameType, period: "daily" });
      if (address) params.set("wallet", address);
      const res  = await fetch(`/api/games/leaderboard?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setEntries(data.entries ?? []);
      setMyBest(data.myBest ?? null);
    } catch (err) {
      console.error("[useLeaderboard]", err);
      setEntries([]);
      setMyBest(null);
    } finally {
      setIsLoading(false);
    }
  }, [address, gameType]);

  useEffect(() => { refresh(); }, [refresh]);

  return { entries, myBest, isLoading, refresh };
}
