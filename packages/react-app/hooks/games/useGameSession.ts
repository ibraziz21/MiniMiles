"use client";

import { useCallback, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { GAME_CONFIGS, MOCK_WALLET } from "@/lib/games/config";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi } from "@/lib/games/contracts";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameSession, GameType } from "@/lib/games/types";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http, decodeEventLog, keccak256 } from "viem";
import type { CreditStatus } from "./useCredits";

function makeSeedCommitment(): `0x${string}` {
  // 32 random bytes, client-chosen — the server re-seeds from this commitment
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return keccak256(buf) as `0x${string}`;
}

export function useGameSession(gameType: GameType) {
  const { address, getUserAddress } = useWeb3();
  const [session,    setSession]    = useState<GameSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [startMode,  setStartMode]  = useState<"sponsored" | "self" | "mock" | null>(null);

  /**
   * startSession — picks the cheapest available path:
   *
   *   1. Sponsored (zero gas for player): player has credits + contract deployed
   *      → sign intent client-side → POST /api/games/start-intent → backend submits tx
   *
   *   2. Self-start with credit: player has credits but no backend key configured
   *      → player calls startGame() directly (contract auto-consumes credit, no burn)
   *
   *   3. Self-start burn: no credits
   *      → player calls startGame(), contract burns entry fee inline
   *
   *   4. Mock (dev): no contract address in env
   *      → mockVerifier only, no chain tx
   */
  const startSession = useCallback(async (creditStatus?: CreditStatus) => {
    setError(null);
    setIsStarting(true);
    try {
      await getUserAddress?.();
      const wallet = address ?? MOCK_WALLET;
      const next   = await mockVerifier.createGameSession(gameType, wallet);

      if (AKIBA_SKILL_GAMES_ADDRESS && typeof window !== "undefined" && window.ethereum && address) {
        const seedCommitment = makeSeedCommitment();

        // ── Path 1: Sponsored start (backend pays gas, player has credits) ──
        if (creditStatus?.hasCredits && !creditStatus.isDailyCapped) {
          try {
            // Build intent inline — hooks can't be called in callbacks so we duplicate
            // the signing logic from useCredits.signStartIntent here.

            // Build and sign intent directly (mirrors useCredits.signStartIntent)
            const { keccak256: kec, encodeAbiParameters, parseAbiParameters, toHex: th } = await import("viem");
            const chainGameType  = GAME_CONFIGS[gameType].chainGameType;
            const nonce          = creditStatus.nonce;
            const expiry         = Math.floor(Date.now() / 1000) + 5 * 60;
            const INTENT_TYPEHASH = kec(th(
              "AkibaStartIntent(address player,uint8 gameType,bytes32 seedCommitment,uint256 nonce,uint256 expiry,address verifyingContract,uint256 chainId)"
            ));
            const digest = kec(
              encodeAbiParameters(
                parseAbiParameters("bytes32,address,uint8,bytes32,uint256,uint256,address,uint256"),
                [INTENT_TYPEHASH, address as `0x${string}`, chainGameType, seedCommitment, BigInt(nonce), BigInt(expiry), AKIBA_SKILL_GAMES_ADDRESS, BigInt(celo.id)]
              )
            );
            const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
            const playerSig    = await walletClient.signMessage({ account: address as `0x${string}`, message: { raw: digest } });

            const resp = await fetch("/api/games/start-intent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gameType, walletAddress: address, seedCommitment, nonce, expiry, playerSignature: playerSig }),
            });

            if (resp.ok) {
              const { sessionId, txHash } = await resp.json();
              next.sessionId    = sessionId;
              next.onchainTxHash = txHash;
              next.status       = "playing";
              setSession(next);
              setStartMode("sponsored");
              return next;
            }
            // Sponsored start failed — fall through to self-start
            console.warn("[useGameSession] sponsored start failed, falling back to self-start");
          } catch (sponsoredErr) {
            console.warn("[useGameSession] sponsored start error, falling back:", sponsoredErr);
          }
        }

        // ── Path 2 & 3: Player calls startGame() directly ───────────────────
        const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
        const publicClient = createPublicClient({ chain: celo, transport: http() });

        const hash = await walletClient.writeContract({
          chain: celo,
          account: address as `0x${string}`,
          address: AKIBA_SKILL_GAMES_ADDRESS,
          abi: akibaSkillGamesAbi,
          functionName: "startGame",
          args: [GAME_CONFIGS[gameType].chainGameType, seedCommitment],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });

        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({ abi: akibaSkillGamesAbi, data: log.data, topics: log.topics });
            if (decoded.eventName === "GameStarted") {
              next.sessionId = (decoded.args as any).sessionId.toString();
              break;
            }
          } catch { /* not our log */ }
        }

        next.onchainTxHash = hash;
        setStartMode(creditStatus?.hasCredits ? "self" : "self");
      } else {
        // ── Path 4: Mock ─────────────────────────────────────────────────────
        setStartMode("mock");
      }

      next.status = "playing";
      setSession(next);
      return next;
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? "Could not start game session");
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, [address, gameType, getUserAddress]);

  return {
    address: address ?? MOCK_WALLET,
    config: GAME_CONFIGS[gameType],
    session,
    isStarting,
    error,
    startMode,
    startSession,
    setSession,
  };
}
