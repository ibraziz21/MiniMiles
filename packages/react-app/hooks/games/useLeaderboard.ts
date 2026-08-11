"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameType, LeaderboardEntry } from "@/lib/games/types";

// Viewer identity is resolved server-side from the session cookie
// (skill-games-leaderboards-spec.md §5.1) — this hook no longer sends a
// wallet address, and `myBest`/`isYou` come straight from the API.
export function useLeaderboard(gameType: GameType) {
  const [entries,   setEntries]   = useState<LeaderboardEntry[]>([]);
  const [myBest,    setMyBest]    = useState<LeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ gameType, period: "daily" });
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
  }, [gameType]);

  useEffect(() => { refresh(); }, [refresh]);

  return { entries, myBest, isLoading, refresh };
}
