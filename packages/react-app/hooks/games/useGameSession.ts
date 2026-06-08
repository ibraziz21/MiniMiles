"use client";

import { useCallback, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { GAME_CONFIGS, MOCK_WALLET } from "@/lib/games/config";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi } from "@/lib/games/contracts";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameSession, GameType } from "@/lib/games/types";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http, decodeEventLog } from "viem";
import { seedCommitment as computeSeedCommitment } from "@/lib/games/replay-validation";
import type { CreditStatus } from "./useCredits";

const START_INTENT_TIMEOUT_MS = 35_000;
const START_STATUS_ATTEMPTS = 12;
const START_STATUS_INTERVAL_MS = 2_500;

function localSessionId(gameType: GameType, walletAddress: string) {
  return `${gameType}-${Date.now().toString(36)}-${walletAddress.slice(-6).toLowerCase()}`;
}

function seedFor(sessionId: string, walletAddress: string) {
  return `akiba-v1:${sessionId}:${walletAddress.toLowerCase()}`;
}

function createPendingSession(gameType: GameType, walletAddress: string): GameSession {
  const now = Date.now();
  const sessionId = localSessionId(gameType, walletAddress);
  const seed = seedFor(sessionId, walletAddress);
  const config = GAME_CONFIGS[gameType];
  return {
    sessionId,
    gameType,
    walletAddress,
    seed,
    seedCommitment: computeSeedCommitment(seed, walletAddress, gameType),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + config.durationSeconds * 1000 + 10 * 60_000).toISOString(),
    status: "created",
  };
}

function startIntentMessage(status: number, code?: string) {
  if (code === "start-confirmation-timeout") {
    return "The start transaction is still confirming. Wait a moment, then refresh your tickets before trying again.";
  }
  if (code === "sponsor-out-of-gas") {
    return "Gas-free game starts are temporarily unavailable. Please try again after the sponsor wallet is topped up.";
  }
  if (code === "backend-unavailable" || code === "proxy-timeout") {
    return "The game backend did not respond in time. Please try again in a moment.";
  }
  if (status === 429 || code === "shared-daily-cap-reached" || code === "game-daily-cap-reached") {
    return "Daily play limit reached";
  }
  return code ? `Could not start game session: ${code}` : "Could not start game session";
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function recoverSponsoredStart(params: {
  txHash: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: `0x${string}`;
}) {
  const qs = new URLSearchParams({
    txHash: params.txHash,
    walletAddress: params.walletAddress,
    gameType: params.gameType,
    seedCommitment: params.seedCommitment,
  });

  for (let attempt = 0; attempt < START_STATUS_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(START_STATUS_INTERVAL_MS);

    const resp = await fetch(`/api/games/start-intent-status?${qs.toString()}`);
    const body = await resp.json().catch(() => null);
    if (resp.ok && body?.sessionId) {
      return {
        sessionId: String(body.sessionId),
        txHash: String(body.txHash ?? params.txHash),
      };
    }

    if (body?.pending || resp.status === 404 || resp.status === 502 || resp.status === 504) {
      continue;
    }

    throw new Error(startIntentMessage(resp.status, body?.error));
  }

  throw new Error(startIntentMessage(504, "start-confirmation-timeout"));
}

function normalizeStartError(err: any) {
  const raw = err?.shortMessage ?? err?.message ?? "Could not start game session";
  if (/insufficient funds|intrinsic transaction cost/i.test(raw)) {
    return "This wallet does not have enough CELO for a direct game start. Use gas-free tickets, or add a small CELO balance and try again.";
  }
  return raw;
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
      if (creditStatus?.isDailyCapped) {
        throw new Error("Daily play limit reached");
      }

      const resolvedAddress = address ?? (await getUserAddress?.()) ?? null;
      const wallet = resolvedAddress ?? MOCK_WALLET;
      const skillGamesAddress = AKIBA_SKILL_GAMES_ADDRESS;
      const canUseChain = Boolean(
        skillGamesAddress &&
        typeof window !== "undefined" &&
        window.ethereum &&
        resolvedAddress
      );
      const next = canUseChain
        ? createPendingSession(gameType, wallet)
        : await mockVerifier.createGameSession(gameType, wallet);

      if (canUseChain && resolvedAddress && skillGamesAddress) {
        // Derive on-chain commitment from the session seed so server validation matches.
        const onchainCommitment = computeSeedCommitment(next.seed, resolvedAddress, gameType) as `0x${string}`;

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
                [INTENT_TYPEHASH, resolvedAddress as `0x${string}`, chainGameType, onchainCommitment, BigInt(nonce), BigInt(expiry), skillGamesAddress, BigInt(celo.id)]
              )
            );
            const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
            const playerSig    = await walletClient.signMessage({ account: resolvedAddress as `0x${string}`, message: { raw: digest } });

            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), START_INTENT_TIMEOUT_MS);

            let resp: Response;
            try {
              resp = await fetch("/api/games/start-intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameType, walletAddress: resolvedAddress, seedCommitment: onchainCommitment, nonce, expiry, playerSignature: playerSig }),
                signal: controller.signal,
              });
            } catch (err: any) {
              if (err?.name === "AbortError") {
                throw new Error(startIntentMessage(504, "proxy-timeout"));
              }
              throw err;
            } finally {
              window.clearTimeout(timeoutId);
            }

            if (resp.ok) {
              const { sessionId, txHash } = await resp.json();
              next.sessionId    = sessionId;
              next.onchainTxHash = txHash;
              next.status       = "playing";
              setSession(next);
              setStartMode("sponsored");
              return next;
            }
            const errorBody = await resp.json().catch(() => null);
            if (
              resp.status === 503 &&
              (errorBody?.error === "backend-not-configured" || errorBody?.error === "sponsor-out-of-gas")
            ) {
              console.warn("[useGameSession] sponsored start unavailable, falling back to self-start");
            } else if (
              resp.status === 504 &&
              errorBody?.error === "start-confirmation-timeout" &&
              errorBody?.txHash
            ) {
              const recovered = await recoverSponsoredStart({
                txHash: String(errorBody.txHash),
                walletAddress: resolvedAddress,
                gameType,
                seedCommitment: onchainCommitment,
              });
              next.sessionId = recovered.sessionId;
              next.onchainTxHash = recovered.txHash;
              next.status = "playing";
              setSession(next);
              setStartMode("sponsored");
              return next;
            } else {
              throw new Error(startIntentMessage(resp.status, errorBody?.error));
            }
          } catch (sponsoredErr) {
            if ((sponsoredErr as Error)?.message === "Daily play limit reached") {
              throw sponsoredErr;
            }
            throw sponsoredErr;
          }
        }

        // ── Path 2 & 3: Player calls startGame() directly ───────────────────
        const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
        const publicClient = createPublicClient({ chain: celo, transport: http() });

        const hash = await walletClient.writeContract({
          chain: celo,
          account: resolvedAddress as `0x${string}`,
          address: skillGamesAddress,
          abi: akibaSkillGamesAbi,
          functionName: "startGame",
          args: [GAME_CONFIGS[gameType].chainGameType, onchainCommitment],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 75_000 });

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
        setStartMode("self");
      } else {
        // ── Path 4: Mock ─────────────────────────────────────────────────────
        setStartMode("mock");
      }

      next.status = "playing";
      setSession(next);
      return next;
    } catch (err: any) {
      setError(normalizeStartError(err));
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
