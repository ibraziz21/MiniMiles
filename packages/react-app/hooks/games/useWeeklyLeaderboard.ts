"use client";

import { useCallback, useEffect, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { MOCK_WALLET } from "@/lib/games/config";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameType, WeeklyLeaderboardEntry } from "@/lib/games/types";

export function useWeeklyLeaderboard(gameType: GameType) {
  const { address } = useWeb3();
  const [entries, setEntries] = useState<WeeklyLeaderboardEntry[]>([]);
  const [myBest, setMyBest] = useState<WeeklyLeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const wallet = address ?? MOCK_WALLET;
      const [leaderboard, best] = await Promise.all([
        mockVerifier.fetchWeeklyLeaderboard(gameType),
        mockVerifier.fetchMyWeeklyBestScore(gameType, wallet),
      ]);
      setEntries(leaderboard);
      setMyBest(best);
    } finally {
      setIsLoading(false);
    }
  }, [address, gameType]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, myBest, isLoading, refresh };
}
