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

async function registerStartedSession(params: {
  sessionId: string;
  txHash: `0x${string}`;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: `0x${string}`;
}) {
  const resp = await fetch("/api/games/register-start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: params.sessionId,
      txHash: params.txHash,
      gameType: params.gameType,
      seedCommitment: params.seedCommitment,
      walletAddress: params.walletAddress,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ?? `register-start-${resp.status}`);
  }
}

async function waitForStartedSessionRegistration(params: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: `0x${string}`;
}) {
  const qs = new URLSearchParams({
    sessionId: params.sessionId,
    walletAddress: params.walletAddress,
    gameType: params.gameType,
    seedCommitment: params.seedCommitment,
  });

  const resp = await fetch(`/api/games/register-start?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ?? `register-start-${resp.status}`);
  }
}

function normalizeStartError(err: any) {
  const raw = err?.shortMessage ?? err?.message ?? "Could not start game session";
  if (/insufficient funds|intrinsic transaction cost/i.test(raw)) {
    return "This wallet does not have enough CELO to start the game. Add a small CELO balance and try again.";
  }
  return raw;
}

export function useGameSession(gameType: GameType) {
  const { address, getUserAddress } = useWeb3();
  const [session,    setSession]    = useState<GameSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [startMode,  setStartMode]  = useState<"self" | "mock" | null>(null);

  /**
   * startSession — creates an on-chain session:
   *
   *   1. Self-start: player calls startGame() directly.
   *      If the player has a prepaid ticket, the contract consumes it.
   *      Otherwise the contract burns the entry fee inline.
   *
   *   2. Mock (dev): no contract address in env
   *      → mockVerifier only, no chain tx
   */
  const startSession = useCallback(async (creditStatus?: CreditStatus) => {
    setError(null);
    setIsStarting(true);
    try {
      const resolvedAddress = address ?? (await getUserAddress?.()) ?? null;
      const wallet = resolvedAddress ?? MOCK_WALLET;
      const skillGamesAddress = AKIBA_SKILL_GAMES_ADDRESS;
      const canUseChain = Boolean(
        skillGamesAddress &&
        typeof window !== "undefined" &&
        window.ethereum &&
        resolvedAddress
      );

      if (creditStatus?.isDailyCapped) {
        throw new Error("Daily play limit reached");
      }

      if (canUseChain) {
        if (!creditStatus?.statusReady) {
          throw new Error("Skill Games status is still loading. Please try again in a moment.");
        }
        if (creditStatus.backendDegraded) {
          throw new Error("Skill Games service is temporarily unavailable. Your ticket was not used; please try again shortly.");
        }
        if (!creditStatus.contractAvailable) {
          throw new Error("Skill Games contract status is unavailable. Please try again shortly.");
        }
        // A ticket is required to play. When the contract is live and the player
        // has none, force a purchase rather than attempting a ticketless start.
        if (!creditStatus.hasCredits) {
          throw new Error("You need a ticket to play. Buy tickets to continue.");
        }
      }

      const next = canUseChain
        ? createPendingSession(gameType, wallet)
        : await mockVerifier.createGameSession(gameType, wallet);

      if (canUseChain && resolvedAddress && skillGamesAddress) {
        // Derive on-chain commitment from the session seed so server validation matches.
        const onchainCommitment = computeSeedCommitment(next.seed, resolvedAddress, gameType) as `0x${string}`;

        // Player calls startGame() directly. The contract consumes a ticket when
        // available, otherwise it burns the entry fee inline.
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

        let onchainSessionId: string | null = null;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({ abi: akibaSkillGamesAbi, data: log.data, topics: log.topics });
            if (decoded.eventName === "GameStarted") {
              onchainSessionId = (decoded.args as any).sessionId.toString();
              break;
            }
          } catch { /* not our log */ }
        }

        if (!onchainSessionId) {
          throw new Error("Could not find the started game session in the transaction receipt");
        }

        next.sessionId = onchainSessionId;
        next.onchainTxHash = hash;

        void registerStartedSession({
          sessionId: onchainSessionId,
          txHash: hash,
          walletAddress: resolvedAddress,
          gameType,
          seedCommitment: onchainCommitment,
        }).catch((err) => {
          console.warn("[useGameSession] could not register started session", err);
          void waitForStartedSessionRegistration({
            sessionId: onchainSessionId,
            walletAddress: resolvedAddress,
            gameType,
            seedCommitment: onchainCommitment,
          }).catch((retryErr) => {
            console.warn("[useGameSession] could not recover started session registration", retryErr);
          });
        });

        setStartMode("self");
      } else {
        // Mock only when there is no deployed contract available.
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
