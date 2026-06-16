"use client";

import { useCallback, useEffect, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, fallback, http } from "viem";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi } from "@/lib/games/contracts";
import { GAME_CONFIGS, PER_GAME_DAILY_PLAY_CAP } from "@/lib/games/config";
import type { GameType } from "@/lib/games/types";

export type CreditStatus = {
  credits:        number;
  playsToday:     number;
  playsRemaining: number;
  dailyCap:       number;
  nonce:          number;
  isDailyCapped:  boolean;
  hasCredits:     boolean;
  contractAvailable: boolean;
};

const EMPTY: CreditStatus = {
  credits: 0, playsToday: 0, playsRemaining: PER_GAME_DAILY_PLAY_CAP, dailyCap: PER_GAME_DAILY_PLAY_CAP,
  nonce: 0, isDailyCapped: false, hasCredits: false, contractAvailable: false,
};

const CREDIT_STATUS_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, timeoutMs = CREDIT_STATUS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const PLAY_BUNDLES = [
  { count: 5,  label: "5 tickets",  badge: "" },
  { count: 10, label: "10 tickets", badge: "most popular" },
  { count: 20, label: "20 tickets", badge: "best value" },
] as const;

/** @deprecated use PLAY_BUNDLES */
export const CREDIT_BUNDLES = PLAY_BUNDLES;

export function useCredits(gameType: GameType, walletAddress: string | null | undefined) {
  const [status, setStatus] = useState<CreditStatus>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [buying,  setBuying]  = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) { setStatus(EMPTY); return; }
    setLoading(true);
    try {
      const res = await fetchWithTimeout(
        `/api/games/status?wallet=${walletAddress}&gameType=${gameType}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const playsToday = data.playsToday ?? 0;
      const playsRemaining = data.playsRemaining ?? PER_GAME_DAILY_PLAY_CAP;
      const dailyCap = data.dailyCap ?? Math.max(PER_GAME_DAILY_PLAY_CAP, playsToday + playsRemaining);
      setStatus({
        credits:           data.credits        ?? 0,
        playsToday,
        playsRemaining,
        dailyCap,
        nonce:             data.nonce           ?? 0,
        isDailyCapped:     playsRemaining === 0,
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
      const publicClient  = createPublicClient({
        chain: celo,
        transport: fallback([
          http(),                                  // forno.celo.org (chain default)
          http("https://rpc.ankr.com/celo"),
          http("https://celo.drpc.org"),
        ]),
      });

      const hash = await walletClient.writeContract({
        chain: celo,
        account: walletAddress as `0x${string}`,
        address: AKIBA_SKILL_GAMES_ADDRESS,
        abi: akibaSkillGamesAbi,
        functionName: "buyCredits",
        args: [chainGameType, BigInt(count)],
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      // Optimistically update credits so the UI reflects the purchase immediately,
      // even if the backend RPC node hasn't caught up yet.
      // Wait for the backend to reflect the confirmed tx before resolving.
      // buying stays true during this, so the sheet keeps showing "Processing…"
      // until we have the real on-chain credits to display.
      await refresh();
    } catch (err: any) {
      const msg: string = err?.shortMessage ?? err?.message ?? "Transaction failed";
      setBuyError(msg);
      throw err;
    } finally {
      setBuying(false);
    }
  }, [walletAddress, gameType, refresh]);

  return {
    status,
    loading,
    buying,
    buyError,
    refresh,
    buyCredits,
  };
}
