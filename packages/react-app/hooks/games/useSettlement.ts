"use client";

import { useCallback, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameReplay, GameType, VerifierResponse } from "@/lib/games/types";

const USE_REAL_VERIFIER = !!process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS;

/**
 * Settlement flow:
 *
 *   1. POST /api/games/verify (or backend /games/verify) — validates replay,
 *      persists session, fires settleGame() in the background, returns
 *      immediately with accepted + result.
 *
 *   2. Backend settles on-chain async. User pays zero gas, never waits on tx.
 *
 *   3. Frontend shows reward optimistically from the verifier response.
 */
export function useSettlement(gameType: GameType) {
  const { address } = useWeb3();
  const [status,   setStatus]   = useState<"idle" | "submitting" | "settled" | "rejected" | "error">("idle");
  const [response, setResponse] = useState<VerifierResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const submitReplay = useCallback(
    async (sessionId: string, replay: GameReplay) => {
      setStatus("submitting");
      setError(null);
      try {
        let verifierResponse: VerifierResponse;

        if (USE_REAL_VERIFIER && address) {
          const res = await fetch("/api/games/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameType, sessionId, walletAddress: address, replay }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(`Verifier returned ${res.status}: ${errBody.error ?? JSON.stringify(errBody)}`);
          }
          verifierResponse = await res.json();
        } else {
          verifierResponse = await mockVerifier.submitReplay(gameType, sessionId, replay);
        }

        setResponse(verifierResponse);
        setStatus(verifierResponse.accepted ? "settled" : "rejected");
        return verifierResponse;
      } catch (err: any) {
        setStatus("error");
        setError(err?.message ?? "Settlement failed");
        throw err;
      }
    },
    [address, gameType]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResponse(null);
    setError(null);
  }, []);

  return { status, response, error, submitReplay, reset };
}
