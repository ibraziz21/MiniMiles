"use client";

import { useCallback, useEffect, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { GAME_CREDIT_VAULT_ADDRESS, gameCreditVaultAbi } from "@/lib/farkle/contracts";

/**
 * Reward Duel USDT winnings live on-chain as a claimable credit in the
 * GameCreditVault (rewardCreditBalance, USDT base units / 6 dp). This hook reads
 * that on-chain balance — the source of truth — plus the claimEnabled flag, and
 * claims via claimRewardCredits(). It does NOT trust the off-chain mirror.
 */
export function useFarkleClaim(address: string | null | undefined) {
  const [claimable,      setClaimable]      = useState<bigint>(0n); // USDT base units (6 dp)
  const [claimEnabled,   setClaimEnabled]   = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [claiming,       setClaiming]       = useState(false);
  const [claimError,     setClaimError]     = useState<string | null>(null);
  const [claimTxHash,    setClaimTxHash]    = useState<string | null>(null);
  const [syncFailed,     setSyncFailed]     = useState(false);
  const [retrying,       setRetrying]       = useState(false);

  const refresh = useCallback(async () => {
    if (!address || !GAME_CREDIT_VAULT_ADDRESS) return;
    setLoading(true);
    try {
      const publicClient = createPublicClient({ chain: celo, transport: http() });
      const [bal, enabled] = await Promise.all([
        publicClient.readContract({
          address: GAME_CREDIT_VAULT_ADDRESS, abi: gameCreditVaultAbi,
          functionName: "rewardCreditBalance", args: [address as `0x${string}`],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: GAME_CREDIT_VAULT_ADDRESS, abi: gameCreditVaultAbi,
          functionName: "claimEnabled", args: [],
        }) as Promise<boolean>,
      ]);
      setClaimable(bal);
      setClaimEnabled(enabled);
    } catch {
      /* leave previous values on transient RPC error */
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const claim = useCallback(async (): Promise<boolean> => {
    if (!address || !GAME_CREDIT_VAULT_ADDRESS) {
      setClaimError("Wallet not connected or contract not configured");
      return false;
    }
    if (claimable === 0n) { setClaimError("Nothing to claim"); return false; }
    if (!claimEnabled)    { setClaimError("Claims are not open yet"); return false; }
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setClaimError("No wallet detected");
      return false;
    }

    setClaiming(true);
    setClaimError(null);
    setSyncFailed(false);
    try {
      const walletClient = createWalletClient({ chain: celo, transport: custom((window as any).ethereum) });
      const publicClient = createPublicClient({ chain: celo, transport: http() });
      const account = address as `0x${string}`;

      const hash = await walletClient.writeContract({
        chain: celo, account, address: GAME_CREDIT_VAULT_ADDRESS, abi: gameCreditVaultAbi,
        functionName: "claimRewardCredits", args: [claimable],
      });
      setClaimTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });

      // Reconcile the off-chain mirror — wallet identity comes from the server session.
      const syncRes = await fetch("/api/games/farkle/credits/claim", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ txHash: hash }),
      }).catch(() => null);

      if (!syncRes || !syncRes.ok) {
        const detail = await syncRes?.json().catch(() => null);
        console.error("[useFarkleClaim] sync failed", syncRes?.status, detail);
        setSyncFailed(true);
        // The on-chain withdrawal succeeded — still refresh the on-chain balance.
        await refresh();
        return true;
      }

      await refresh(); // pull fresh on-chain balance (→ 0)
      return true;
    } catch (err: any) {
      const msg: string = err?.shortMessage ?? err?.message ?? "Claim failed";
      setClaimError(msg.length > 80 ? msg.slice(0, 80) + "…" : msg);
      return false;
    } finally {
      setClaiming(false);
    }
  }, [address, claimable, claimEnabled, refresh]);

  /** Retry a failed post-claim mirror sync using the recovery endpoint. */
  const retrySync = useCallback(async (): Promise<boolean> => {
    if (!claimTxHash) return false;
    setRetrying(true);
    try {
      const res = await fetch("/api/games/farkle/purchase/recover", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ txHash: claimTxHash, purchaseType: "claim" }),
      });
      if (!res.ok) {
        console.error("[useFarkleClaim] retrySync failed", res.status, await res.json().catch(() => null));
        return false;
      }
      setSyncFailed(false);
      return true;
    } catch {
      return false;
    } finally {
      setRetrying(false);
    }
  }, [claimTxHash]);

  return { claimable, claimEnabled, claiming, claimError, loading, claimTxHash, syncFailed, retrying, retrySync, claim, refresh };
}
