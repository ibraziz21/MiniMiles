"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameType, WeeklyLeaderboardEntry } from "@/lib/games/types";

// Viewer identity is resolved server-side from the session cookie
// (skill-games-leaderboards-spec.md §5.1) — this hook no longer sends a
// wallet address, and `myBest`/`isYou` come straight from the API.
export function useWeeklyLeaderboard(gameType: GameType) {
  const [entries,   setEntries]   = useState<WeeklyLeaderboardEntry[]>([]);
  const [myBest,    setMyBest]    = useState<WeeklyLeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ gameType, period: "weekly" });
      const res  = await fetch(`/api/games/leaderboard?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setEntries(data.entries ?? []);
      setMyBest(data.myBest ?? null);
    } catch (err) {
      console.error("[useWeeklyLeaderboard]", err);
      setEntries([]);
      setMyBest(null);
    } finally {
      setIsLoading(false);
    }
  }, [gameType]);

  useEffect(() => { refresh(); }, [refresh]);

  return { entries, myBest, isLoading, refresh };
}
