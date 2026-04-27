"use client";

import { useCallback, useState } from "react";
import { useWeb3 } from "@/contexts/useWeb3";
import { GAME_CONFIGS, MOCK_WALLET } from "@/lib/games/config";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi } from "@/lib/games/contracts";
import { mockVerifier } from "@/lib/games/mock-verifier";
import type { GameSession, GameType } from "@/lib/games/types";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";

export function useGameSession(gameType: GameType) {
  const { address, getUserAddress } = useWeb3();
  const [session, setSession] = useState<GameSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async () => {
    setError(null);
    setIsStarting(true);
    try {
      await getUserAddress?.();
      const wallet = address ?? MOCK_WALLET;
      const next = await mockVerifier.createGameSession(gameType, wallet);

      if (AKIBA_SKILL_GAMES_ADDRESS && typeof window !== "undefined" && window.ethereum && address) {
        const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
        const publicClient = createPublicClient({ chain: celo, transport: http() });
        const hash = await walletClient.writeContract({
          chain: celo,
          account: address as `0x${string}`,
          address: AKIBA_SKILL_GAMES_ADDRESS,
          abi: akibaSkillGamesAbi,
          functionName: "startGame",
          args: [GAME_CONFIGS[gameType].chainGameType, next.seedCommitment as `0x${string}`],
        });
        await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
        next.onchainTxHash = hash;
      }

      // Production verifier rule: reveal/play seed only after start tx is accepted.
      next.status = "playing";
      setSession(next);
      return next;
    } catch (err: any) {
      setError(err?.message ?? "Could not start game session");
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
    startSession,
    setSession,
  };
}
