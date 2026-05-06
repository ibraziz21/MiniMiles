"use client";

import { useCallback, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi } from "@/lib/games/contracts";
import { mockVerifier } from "@/lib/games/mock-verifier";
import { MOCK_WALLET } from "@/lib/games/config";
import type { GameReplay, GameType, VerifierResponse } from "@/lib/games/types";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";

const USE_REAL_VERIFIER = !!process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS;

/**
 * Settlement flow (real contract):
 *
 *   1. POST /api/games/verify — validates replay, signs settlement, AND
 *      submits settleGame() from the backend verifier wallet.
 *
 *   2. If the backend settle succeeded (resp.settled === true) we are done —
 *      the user paid zero gas for settlement.
 *
 *   3. If backend settle failed (network blip, etc.) the signed settlement
 *      payload is still returned. We fall back to the user submitting
 *      settleGame() themselves so no reward is ever lost.
 */
export function useSettlement(gameType: GameType) {
  const { address } = useWeb3();
  const [status,   setStatus]   = useState<"idle" | "submitting" | "settled" | "rejected" | "error">("idle");
  const [response, setResponse] = useState<VerifierResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [settleTxHash, setSettleTxHash] = useState<string | null>(null);

  const submitReplay = useCallback(
    async (sessionId: string, replay: GameReplay) => {
      setStatus("submitting");
      setError(null);
      setSettleTxHash(null);
      try {
        let verifierResponse: VerifierResponse & { settled?: boolean; settleTxHash?: string };

        if (USE_REAL_VERIFIER && address) {
          // ── Real path ────────────────────────────────────────────────────
          const res = await fetch("/api/games/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameType, sessionId, walletAddress: address, replay }),
          });
          if (!res.ok) throw new Error(`Verifier returned ${res.status}`);
          verifierResponse = await res.json();

          if (verifierResponse.accepted) {
            if (verifierResponse.settled && verifierResponse.settleTxHash) {
              // Backend settled — user paid zero gas
              setSettleTxHash(verifierResponse.settleTxHash);
            } else if (verifierResponse.settlement && typeof window !== "undefined" && window.ethereum) {
              // Backend settle failed — client fallback
              const s = verifierResponse.settlement;
              const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
              const publicClient = createPublicClient({ chain: celo, transport: http() });

              // s.rewardMiles is display units (e.g. 6); contract expects 1e18 scaled.
              // s.rewardStable is display USD; contract expects USDT 6-decimal.
              const hash = await walletClient.writeContract({
                chain: celo,
                account: address as `0x${string}`,
                address: AKIBA_SKILL_GAMES_ADDRESS!,
                abi: akibaSkillGamesAbi,
                functionName: "settleGame",
                args: [
                  BigInt(s.sessionId),
                  BigInt(s.score),
                  BigInt(Math.round(s.rewardMiles)) * BigInt(10 ** 18),
                  BigInt(Math.round(s.rewardStable * 1_000_000)),
                  BigInt(s.expiry),
                  s.signature,
                ],
              });
              await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
              setSettleTxHash(hash);
            }
          }
        } else {
          // ── Mock path ────────────────────────────────────────────────────
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
    setSettleTxHash(null);
  }, []);

  return { status, response, error, settleTxHash, submitReplay, reset };
}
