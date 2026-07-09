"use client";

import { useCallback, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import {
  GAME_CREDIT_VAULT_ADDRESS,
  gameCreditVaultAbi,
  FARKLE_USDT_ADDRESS,
  erc20Abi,
} from "@/lib/farkle/contracts";

type BuyStep = "idle" | "approving" | "buying" | "syncing";

type ExpectedCreditPack = {
  creditAmount: number;
  usdtAmount: bigint | string | number;
};

/**
 * Reward Duel credits are bought with USDT via GameCreditVault.buyCredits(packId).
 * The vault pulls USDT with transferFrom, so we approve first when the allowance
 * is short, then buy, then sync the off-chain ledger.
 */
export function useFarkleCredits(address: string | null | undefined) {
  const [buying,     setBuying]     = useState(false);
  const [buyError,   setBuyError]   = useState<string | null>(null);
  const [step,       setStep]       = useState<BuyStep>("idle");
  const [txHash,     setTxHash]     = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [retrying,   setRetrying]   = useState(false);

  const buyCreditPack = useCallback(async (
    packId = 0,
    expected?: ExpectedCreditPack,
  ): Promise<boolean> => {
    if (!address || !GAME_CREDIT_VAULT_ADDRESS) {
      setBuyError("Wallet not connected or contract not configured");
      return false;
    }
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setBuyError("No wallet detected");
      return false;
    }

    setBuying(true);
    setBuyError(null);
    setTxHash(null);
    setSyncFailed(false);

    try {
      const walletClient = createWalletClient({ chain: celo, transport: custom((window as any).ethereum) });
      const publicClient = createPublicClient({ chain: celo, transport: http() });
      const account = address as `0x${string}`;

      // Resolve pack price/availability from the vault itself (source of truth)
      const pack = (await publicClient.readContract({
        address: GAME_CREDIT_VAULT_ADDRESS,
        abi: gameCreditVaultAbi,
        functionName: "creditPacks",
        args: [BigInt(packId)],
      })) as readonly [bigint, bigint, bigint, boolean];
      const usdtAmount   = pack[1];
      const creditAmount = pack[2];
      const active       = pack[3];
      if (!active || usdtAmount === 0n) {
        setBuyError("This credit pack is unavailable");
        return false;
      }
      if (expected) {
        const expectedCredits = BigInt(expected.creditAmount);
        const expectedUsdt    = BigInt(expected.usdtAmount);
        if (creditAmount !== expectedCredits || usdtAmount !== expectedUsdt) {
          setBuyError("This credit pack is not updated yet. Please try again later.");
          return false;
        }
      }

      // Balance guard so the user doesn't pay gas to revert
      const balance = (await publicClient.readContract({
        address: FARKLE_USDT_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account],
      })) as bigint;
      if (balance < usdtAmount) {
        setBuyError("Not enough USDT for this pack");
        return false;
      }

      // Approve only when the current allowance is short
      const allowance = (await publicClient.readContract({
        address: FARKLE_USDT_ADDRESS, abi: erc20Abi, functionName: "allowance",
        args: [account, GAME_CREDIT_VAULT_ADDRESS],
      })) as bigint;

      if (allowance < usdtAmount) {
        setStep("approving");
        const approveHash = await walletClient.writeContract({
          chain: celo, account, address: FARKLE_USDT_ADDRESS, abi: erc20Abi,
          functionName: "approve", args: [GAME_CREDIT_VAULT_ADDRESS, usdtAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 1, timeout: 120_000 });
      }

      setStep("buying");
      const hash = await walletClient.writeContract({
        chain: celo, account, address: GAME_CREDIT_VAULT_ADDRESS, abi: gameCreditVaultAbi,
        functionName: "buyCredits", args: [BigInt(packId)],
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });

      // Sync the off-chain credit ledger — wallet identity comes from the server session.
      setStep("syncing");
      const syncRes = await fetch("/api/games/farkle/credits/buy", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ txHash: hash }),
      }).catch(() => null);

      if (!syncRes || !syncRes.ok) {
        const detail = await syncRes?.json().catch(() => null);
        console.error("[useFarkleCredits] sync failed", syncRes?.status, detail);
        setSyncFailed(true);
        // On-chain tx confirmed — return true so caller shows success + recovery UI.
        return true;
      }

      return true;
    } catch (err: any) {
      const msg: string = err?.shortMessage ?? err?.message ?? "Transaction failed";
      setBuyError(msg.length > 80 ? msg.slice(0, 80) + "…" : msg);
      return false;
    } finally {
      setBuying(false);
      setStep("idle");
    }
  }, [address]);

  /** Retry a failed post-tx balance sync using the recovery endpoint. */
  const retrySync = useCallback(async (): Promise<boolean> => {
    if (!txHash) return false;
    setRetrying(true);
    try {
      const res = await fetch("/api/games/farkle/purchase/recover", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ txHash, purchaseType: "credit" }),
      });
      if (!res.ok) {
        console.error("[useFarkleCredits] retrySync failed", res.status, await res.json().catch(() => null));
        return false;
      }
      setSyncFailed(false);
      return true;
    } catch {
      return false;
    } finally {
      setRetrying(false);
    }
  }, [txHash]);

  return { buyCreditPack, buying, buyError, step, txHash, syncFailed, retrying, retrySync };
}
