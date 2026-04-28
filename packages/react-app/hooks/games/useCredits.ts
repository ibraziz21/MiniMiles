"use client";

import { useCallback, useEffect, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi } from "@/lib/games/contracts";
import { GAME_CONFIGS } from "@/lib/games/config";
import type { GameType } from "@/lib/games/types";

export type CreditStatus = {
  credits:        number;
  playsToday:     number;
  playsRemaining: number;
  nonce:          number;
  isDailyCapped:  boolean;
  hasCredits:     boolean;
  contractAvailable: boolean;
};

const EMPTY: CreditStatus = {
  credits: 0, playsToday: 0, playsRemaining: 20,
  nonce: 0, isDailyCapped: false, hasCredits: false, contractAvailable: false,
};

export const CREDIT_BUNDLES = [
  { count: 1,  label: "1 play",   discount: "" },
  { count: 5,  label: "5 plays",  discount: "save 0%" },
  { count: 10, label: "10 plays", discount: "most popular" },
  { count: 20, label: "20 plays", discount: "best value" },
] as const;

export function useCredits(gameType: GameType, walletAddress: string | null | undefined) {
  const [status, setStatus] = useState<CreditStatus>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [buying,  setBuying]  = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) { setStatus(EMPTY); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/games/status?wallet=${walletAddress}&gameType=${gameType}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStatus({
        credits:           data.credits        ?? 0,
        playsToday:        data.playsToday      ?? 0,
        playsRemaining:    data.playsRemaining  ?? 20,
        nonce:             data.nonce           ?? 0,
        isDailyCapped:     (data.playsRemaining ?? 20) === 0,
        hasCredits:        (data.credits ?? 0) > 0,
        contractAvailable: data.contractAvailable ?? false,
      });
    } catch {
      setStatus(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, gameType]);

  useEffect(() => { refresh(); }, [refresh]);

  const buyCredits = useCallback(async (count: number) => {
    if (!walletAddress || !AKIBA_SKILL_GAMES_ADDRESS || typeof window === "undefined" || !window.ethereum) {
      setBuyError("Wallet not connected or contract not available");
      return;
    }
    setBuying(true);
    setBuyError(null);
    try {
      const chainGameType = GAME_CONFIGS[gameType].chainGameType;
      const walletClient  = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
      const publicClient  = createPublicClient({ chain: celo, transport: http() });

      const hash = await walletClient.writeContract({
        chain: celo,
        account: walletAddress as `0x${string}`,
        address: AKIBA_SKILL_GAMES_ADDRESS,
        abi: akibaSkillGamesAbi,
        functionName: "buyCredits",
        args: [chainGameType, BigInt(count)],
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      await refresh();
    } catch (err: any) {
      const msg: string = err?.shortMessage ?? err?.message ?? "Transaction failed";
      setBuyError(msg);
      throw err;
    } finally {
      setBuying(false);
    }
  }, [walletAddress, gameType, refresh]);

  /**
   * Sign a start intent for the sponsored-start flow.
   * Returns the signature + metadata needed by POST /api/games/start-intent.
   */
  const signStartIntent = useCallback(async (seedCommitment: `0x${string}`) => {
    if (!walletAddress || !AKIBA_SKILL_GAMES_ADDRESS || typeof window === "undefined" || !window.ethereum) {
      throw new Error("Wallet not connected");
    }

    const chainGameType = GAME_CONFIGS[gameType].chainGameType;
    const nonce  = status.nonce;
    const expiry = Math.floor(Date.now() / 1000) + 5 * 60; // 5 min

    // Replicate the contract's intent digest off-chain
    const { keccak256, encodeAbiParameters, parseAbiParameters, toHex } = await import("viem");
    const INTENT_TYPEHASH = keccak256(
      toHex(
        "AkibaStartIntent(address player,uint8 gameType,bytes32 seedCommitment,uint256 nonce,uint256 expiry,address verifyingContract,uint256 chainId)"
      )
    );
    const digest = keccak256(
      encodeAbiParameters(
        parseAbiParameters("bytes32,address,uint8,bytes32,uint256,uint256,address,uint256"),
        [
          INTENT_TYPEHASH,
          walletAddress as `0x${string}`,
          chainGameType,
          seedCommitment,
          BigInt(nonce),
          BigInt(expiry),
          AKIBA_SKILL_GAMES_ADDRESS,
          BigInt(celo.id),
        ]
      )
    );

    const walletClient = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
    const signature    = await walletClient.signMessage({
      account: walletAddress as `0x${string}`,
      message: { raw: digest },
    });

    return {
      walletAddress,
      gameType,
      seedCommitment,
      nonce,
      expiry,
      playerSignature: signature,
    };
  }, [walletAddress, gameType, status.nonce]);

  return {
    status,
    loading,
    buying,
    buyError,
    refresh,
    buyCredits,
    signStartIntent,
  };
}
