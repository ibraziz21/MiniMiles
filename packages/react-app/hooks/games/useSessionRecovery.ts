"use client";

import { useCallback, useState } from "react";

// nextAction values returned by the backend recovery endpoint
export type RecoveryNextAction =
  | "register_start"
  | "init_session"
  | "continue_play"
  | "finish_session"
  | "wait_settlement"
  | "retry_settlement"
  | "manual_review"
  | "complete"
  | "unavailable";

export type RecoverySnapshot = {
  sessionId: string;
  wallet: string;
  onchainError?: string;
  onchain: {
    exists: boolean;
    playerMatches?: boolean;
    gameType?: number;
    seedCommitment?: string;
    settled?: boolean;
    createdAt?: string;
  };
  registeredSession: {
    exists: boolean;
    accepted?: boolean;
    score?: number;
    rewardMiles?: number;
    rewardStable?: number;
    antiAbuseFlags?: string[];
    settleTxHash?: string | null;
    settledAt?: string | null;
    settleAttempts?: number;
  };
  serverSession: {
    exists: boolean;
    gameType?: string;
    initialized?: boolean;
    finalized?: boolean;
    completed?: boolean;
    updatedAt?: string;
  };
  settlement: {
    state: string;
    retryable: boolean;
    txHash?: string | null;
    attempts?: number;
    reason?: string;
    jobId?: string;
    jobStatus?: string;
  };
  nextAction: RecoveryNextAction;
  // Present when backend itself is down
  degraded?: boolean;
};

export function useSessionRecovery() {
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetchRecovery = useCallback(
    async (sessionId: string, wallet: string): Promise<RecoverySnapshot | null> => {
      setLoading(true);
      setError(null);
      try {
        const qs  = new URLSearchParams({ sessionId, wallet });
        const res = await fetch(`/api/games/session/recover?${qs}`);
        const body = await res.json().catch(() => ({})) as Partial<RecoverySnapshot> & { error?: string; degraded?: boolean };

        if (!res.ok) {
          if (body.degraded) {
            setError("Backend unavailable — recovery status cannot be loaded right now. Try again shortly.");
          } else {
            setError(body.error ?? `Recovery failed (${res.status})`);
          }
          return null;
        }

        const snap = body as RecoverySnapshot;
        setSnapshot(snap);
        return snap;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Recovery request failed";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setSnapshot(null);
    setError(null);
  }, []);

  // Convenience: human-readable suggestion derived from nextAction
  const recoverySuggestion = (snap: RecoverySnapshot | null): string | null => {
    if (!snap) return null;
    switch (snap.nextAction) {
      case "register_start":   return "Session started but was not registered. Start the game again.";
      case "init_session":     return "Session registered. Tap Play to begin the round.";
      case "finish_session":   return "Round in progress. Finish the game to submit your score.";
      case "wait_settlement":  return "Your reward is being settled on-chain. Check back in a moment.";
      case "retry_settlement": return "Settlement stalled. Your reward will be retried automatically.";
      case "manual_review":    return "Settlement needs operator review. Contact support with your session ID.";
      case "complete":         return "Session complete — reward settled.";
      case "unavailable":      return "Chain data unavailable. Try again once the network recovers.";
      default:                 return null;
    }
  };

  return { snapshot, loading, error, fetchRecovery, reset, recoverySuggestion };
}
