"use client";

import { useCallback, useRef, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameReplay, GameType, VerifierResponse } from "@/lib/games/types";

const USE_REAL_VERIFIER = !!process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS;
type SettlementUiStatus = "idle" | "submitting" | "queued" | "settled" | "rejected" | "error";

type SettlementStatusResponse = {
  accepted: boolean;
  settled: boolean;
  settleTxHash?: string | null;
  retryable?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const [status,   setStatus]   = useState<SettlementUiStatus>("idle");
  const [response, setResponse] = useState<VerifierResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const pollTokenRef = useRef(0);

  const pollSettlementStatus = useCallback(async (sessionId: string, wallet: string, token: number) => {
    for (let attempt = 0; attempt < 24; attempt++) {
      await sleep(attempt < 5 ? 2500 : 5000);
      if (pollTokenRef.current !== token) return;

      const qs = new URLSearchParams({ sessionId, wallet });
      const res = await fetch(`/api/games/settlement-status?${qs.toString()}`);
      if (!res.ok) continue;

      const body = (await res.json()) as SettlementStatusResponse;
      if (pollTokenRef.current !== token) return;

      if (body.settled) {
        setResponse((prev) => prev
          ? { ...prev, settled: true, settleTxHash: body.settleTxHash ?? undefined }
          : prev
        );
        setStatus("settled");
        return;
      }

      if (body.accepted && body.retryable === false) {
        setStatus("error");
        setError("Reward settlement needs manual review");
        return;
      }
    }
  }, []);

  const submitReplay = useCallback(
    async (sessionId: string, replay: GameReplay) => {
      setStatus("submitting");
      setError(null);
      const pollToken = ++pollTokenRef.current;
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
        if (!verifierResponse.accepted) {
          setStatus("rejected");
        } else if (verifierResponse.settled || verifierResponse.settleTxHash) {
          setStatus("settled");
        } else if (USE_REAL_VERIFIER && address && verifierResponse.queued) {
          setStatus("queued");
          void pollSettlementStatus(sessionId, address, pollToken).catch((err) => {
            console.error("[games/settlement-status]", err);
          });
        } else {
          setStatus("settled");
        }
        return verifierResponse;
      } catch (err: any) {
        setStatus("error");
        setError(err?.message ?? "Settlement failed");
        throw err;
      }
    },
    [address, gameType, pollSettlementStatus]
  );

  /**
   * Server-authoritative finish (Memory Flip). The backend already holds the
   * authoritative score/state — we just trigger scoring + settlement and adopt
   * the result it returns, then poll settlement-status like the replay path.
   */
  const submitFinish = useCallback(
    async (sessionId: string, wallet: string) => {
      setStatus("submitting");
      setError(null);
      const pollToken = ++pollTokenRef.current;
      try {
        const res = await fetch("/api/games/session/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, walletAddress: wallet }),
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(`Finish returned ${res.status}: ${body.error ?? JSON.stringify(body)}`);
        }

        const verifierResponse: VerifierResponse = {
          accepted: Boolean(body.accepted),
          antiAbuseFlags: body.antiAbuseFlags ?? [],
          queued: Boolean(body.queued),
          settled: Boolean(body.settled),
          settleTxHash: body.settleTxHash,
          result: {
            sessionId,
            gameType,
            score: Number(body.score ?? 0),
            mistakes: Number(body.mistakes ?? 0),
            moves: Number(body.moves ?? 0),
            matches: Number(body.matches ?? 0),
            completed: Boolean(body.completed),
            elapsedMs: Number(body.elapsedMs ?? 0),
            rewardMiles: Number(body.rewardMiles ?? 0),
            rewardStable: Number(body.rewardStable ?? 0),
          },
        };

        setResponse(verifierResponse);
        if (!verifierResponse.accepted) {
          setStatus("rejected");
        } else if (verifierResponse.settled || verifierResponse.settleTxHash) {
          setStatus("settled");
        } else if (verifierResponse.queued) {
          setStatus("queued");
          void pollSettlementStatus(sessionId, wallet, pollToken).catch((err) => {
            console.error("[games/settlement-status]", err);
          });
        } else {
          // Accepted but nothing to settle (e.g. score below reward threshold).
          setStatus("settled");
        }
        return verifierResponse;
      } catch (err: any) {
        setStatus("error");
        setError(err?.message ?? "Settlement failed");
        throw err;
      }
    },
    [gameType, pollSettlementStatus]
  );

  const reset = useCallback(() => {
    pollTokenRef.current++;
    setStatus("idle");
    setResponse(null);
    setError(null);
  }, []);

  return { status, response, error, submitReplay, submitFinish, reset };
}
