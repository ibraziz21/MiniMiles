"use client";

import { useCallback, useState } from "react";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameReplay, GameType, VerifierResponse } from "@/lib/games/types";

export function useSettlement(gameType: GameType) {
  const [status, setStatus] = useState<"idle" | "submitting" | "settled" | "rejected" | "error">("idle");
  const [response, setResponse] = useState<VerifierResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitReplay = useCallback(
    async (sessionId: string, replay: GameReplay) => {
      setStatus("submitting");
      setError(null);
      try {
        const verifierResponse = await mockVerifier.submitReplay(gameType, sessionId, replay);
        setResponse(verifierResponse);
        setStatus(verifierResponse.accepted ? "settled" : "rejected");
        return verifierResponse;
      } catch (err: any) {
        setStatus("error");
        setError(err?.message ?? "Settlement failed");
        throw err;
      }
    },
    [gameType]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResponse(null);
    setError(null);
  }, []);

  return { status, response, error, submitReplay, reset };
}
