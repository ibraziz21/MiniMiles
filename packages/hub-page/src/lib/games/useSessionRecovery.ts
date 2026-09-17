"use client";

import { useEffect, useState } from "react";
import type { GameType } from "@akiba/skill-games/core";
import { recoverSession } from "./clientTransport";

const STORAGE_PREFIX = "akiba_game_session:";

function storageKey(gameType: GameType) {
  return `${STORAGE_PREFIX}${gameType}`;
}

export function persistActiveSession(gameType: GameType, sessionId: string) {
  try {
    sessionStorage.setItem(storageKey(gameType), sessionId);
  } catch {
    // Private browsing / storage disabled — recovery is best-effort only.
  }
}

export function clearActiveSession(gameType: GameType) {
  try {
    sessionStorage.removeItem(storageKey(gameType));
  } catch {
    // Same as above.
  }
}

export type RecoveredReward = { rewardMiles: number; rewardStable: number } | null;

/**
 * Detects a round abandoned by a refresh/background mid-session.
 * `sessionId` previously lived only in React state (clientTransport.ts's
 * `recoverSession` existed but was never called), so any reload silently
 * stranded whatever round was in progress with zero acknowledgment.
 *
 * Full mid-game reconstruction isn't attempted here — the local game engine
 * has no record of an unrendered deck/board to resume into, and guessing at
 * one risks showing incorrect state. What this does fix is the sharpest
 * edge of that gap: a round that had already finalized server-side (reward
 * granted) at the moment of refresh, which would otherwise vanish without
 * the member ever seeing what they earned.
 */
export function useSessionRecovery(gameType: GameType): RecoveredReward {
  const [recovered, setRecovered] = useState<RecoveredReward>(null);

  useEffect(() => {
    let cancelled = false;
    let pendingId: string | null = null;
    try {
      pendingId = sessionStorage.getItem(storageKey(gameType));
    } catch {
      pendingId = null;
    }
    if (!pendingId) return;

    recoverSession(pendingId)
      .then((res) => {
        if (cancelled) return;
        if (res.reservationStatus === "finalized" && res.result?.accepted) {
          setRecovered({ rewardMiles: res.result.rewardMiles, rewardStable: res.result.rewardStable });
        }
      })
      .catch(() => {
        // Session expired/not found/unreachable — nothing to recover.
      })
      .finally(() => {
        clearActiveSession(gameType);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameType]);

  return recovered;
}
