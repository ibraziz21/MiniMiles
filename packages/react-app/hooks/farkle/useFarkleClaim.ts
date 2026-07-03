"use client";

import { useCallback, useEffect, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import {
  erc20Abi,
  FARKLE_USDT_ADDRESS,
  GAME_CREDIT_VAULT_ADDRESS,
  gameCreditVaultAbi,
} from "@/lib/farkle/contracts";

const CELO_RPC = process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID_HEX = `0x${celo.id.toString(16)}`;

function newClaimDebugId() {
  return `claim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function claimErrorMessage(err: any) {
  const parts = [
    err?.shortMessage,
    err?.details,
    err?.cause?.shortMessage,
    err?.cause?.message,
    err?.message,
  ].filter(Boolean).map(String);
  const raw = parts.find(Boolean) ?? "Claim failed";

  if (/rpc method is not whitelisted/i.test(raw)) {
    return "Wallet provider blocked the RPC method needed to submit this claim.";
  }
  if (/ClaimDisabled/i.test(raw)) return "Claims are disabled on the contract.";
  if (/InsufficientReward|InsufficientCredit|Insufficient.*credit/i.test(raw)) {
    return "The contract says there is not enough claimable reward credit.";
  }
  if (/Insufficient.*vault|Insufficient.*liquidity|transfer amount exceeds balance/i.test(raw)) {
    return "The reward vault does not have enough USDT liquidity for this claim.";
  }
  if (/user rejected|rejected the request|denied/i.test(raw)) return "Transaction rejected in wallet.";
  if (/chain|network/i.test(raw)) return raw;

  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;
}


function formatUsdt(baseUnits: bigint) {
  const whole = baseUnits / 1_000_000n;
  const fraction = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

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
  const [lastDebugId,    setLastDebugId]    = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !GAME_CREDIT_VAULT_ADDRESS) return;
    setLoading(true);
    try {
      const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
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
    } catch (err) {
      console.warn("[farkle-claim] refresh failed", {
        wallet: address.toLowerCase(),
        vault: GAME_CREDIT_VAULT_ADDRESS,
        error: claimErrorMessage(err),
      });
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
    const debugId = newClaimDebugId();
    setLastDebugId(debugId);

    try {
      const provider = (window as any).ethereum;
      const selectedChain = await provider.request({ method: "eth_chainId" }).catch(() => null);
      if (typeof selectedChain === "string" && selectedChain.toLowerCase() !== CELO_CHAIN_ID_HEX) {
        throw new Error(`Wrong network. Switch wallet to Celo (${celo.id}) before claiming.`);
      }

      const selectedAccounts = await provider.request({ method: "eth_requestAccounts" }).catch(() => []);
      const selectedAccount = Array.isArray(selectedAccounts) ? String(selectedAccounts[0] ?? "").toLowerCase() : "";
      if (selectedAccount && selectedAccount !== address.toLowerCase()) {
        throw new Error("Connected wallet changed. Reconnect the winning wallet before claiming.");
      }

      const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
      const account = address as `0x${string}`;

      const [freshClaimable, freshClaimEnabled, vaultUsdtBalance] = await Promise.all([
        publicClient.readContract({
          address: GAME_CREDIT_VAULT_ADDRESS,
          abi: gameCreditVaultAbi,
          functionName: "rewardCreditBalance",
          args: [account],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: GAME_CREDIT_VAULT_ADDRESS,
          abi: gameCreditVaultAbi,
          functionName: "claimEnabled",
          args: [],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: FARKLE_USDT_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [GAME_CREDIT_VAULT_ADDRESS],
        }) as Promise<bigint>,
      ]);

      setClaimable(freshClaimable);
      setClaimEnabled(freshClaimEnabled);
      if (freshClaimable === 0n) throw new Error("Nothing to claim");
      if (!freshClaimEnabled) throw new Error("Claims are not open yet");
      if (vaultUsdtBalance < freshClaimable) {
        throw new Error(
          `Reward vault needs funding. Available: ${formatUsdt(vaultUsdtBalance)} USDT, ` +
            `claim: ${formatUsdt(freshClaimable)} USDT.`,
        );
      }

      console.log("[farkle-claim] preflight", {
        debugId,
        wallet: address.toLowerCase(),
        vault: GAME_CREDIT_VAULT_ADDRESS,
        usdt: FARKLE_USDT_ADDRESS,
        claimable: freshClaimable.toString(),
        claimEnabled: freshClaimEnabled,
        vaultUsdtBalance: vaultUsdtBalance.toString(),
      });

      try {
        await publicClient.simulateContract({
          account,
          address: GAME_CREDIT_VAULT_ADDRESS,
          abi: gameCreditVaultAbi,
          functionName: "claimRewardCredits",
          args: [freshClaimable],
        });
      } catch (err) {
        console.warn("[farkle-claim] simulation skipped", {
          debugId,
          wallet: address.toLowerCase(),
          vault: GAME_CREDIT_VAULT_ADDRESS,
          claimable: freshClaimable.toString(),
          error: claimErrorMessage(err),
        });
      }

      // Estimate gas via the public client (forno) so MiniPay's wallet provider
      // never needs to call eth_estimateGas — MiniPay blocks or mis-handles that
      // RPC method for outbound-transfer contract calls, returning -32601 instead
      // of propagating it or the revert reason.
      let gasLimit: bigint;
      try {
        const estimate = await publicClient.estimateContractGas({
          account,
          address: GAME_CREDIT_VAULT_ADDRESS,
          abi: gameCreditVaultAbi,
          functionName: "claimRewardCredits",
          args: [freshClaimable],
        });
        gasLimit = (estimate * 130n) / 100n; // 30% safety buffer
        console.log("[farkle-claim] gas estimated via forno", { debugId, estimate: estimate.toString(), gasLimit: gasLimit.toString() });
      } catch (gasErr) {
        // If forno also can't estimate, the call likely reverts on-chain —
        // surface that as the real error rather than the MiniPay wrapper.
        console.warn("[farkle-claim] gas estimation failed", {
          debugId,
          error: claimErrorMessage(gasErr),
        });
        throw gasErr;
      }

      const walletClient = createWalletClient({ chain: celo, transport: custom(provider) });
      console.log("[farkle-claim] sending wallet tx", { debugId, method: "walletClient.writeContract", gasLimit: gasLimit.toString() });
      const hash = await walletClient.writeContract({
        chain: celo,
        account,
        address: GAME_CREDIT_VAULT_ADDRESS,
        abi: gameCreditVaultAbi,
        functionName: "claimRewardCredits",
        args: [freshClaimable],
        gas: gasLimit,
      });
      setClaimTxHash(hash);
      console.log("[farkle-claim] tx submitted", { debugId, hash });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      console.log("[farkle-claim] tx confirmed", { debugId, hash });

      // Reconcile the off-chain mirror — wallet identity comes from the server session.
      const syncRes = await fetch("/api/games/farkle/credits/claim", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ txHash: hash, debugId }),
      }).catch(() => null);

      if (!syncRes || !syncRes.ok) {
        const detail = await syncRes?.json().catch(() => null);
        console.warn("[farkle-claim] sync pending", {
          debugId,
          status: syncRes?.status ?? null,
          code: detail?.code ?? null,
        });
        setSyncFailed(true);
        // The on-chain withdrawal succeeded — still refresh the on-chain balance.
        await refresh();
        return true;
      }

      await refresh(); // pull fresh on-chain balance (→ 0)
      return true;
    } catch (err: any) {
      const msg = claimErrorMessage(err);
      console.warn("[farkle-claim] claim did not complete", {
        debugId,
        wallet: address.toLowerCase(),
        vault: GAME_CREDIT_VAULT_ADDRESS,
        claimable: claimable.toString(),
        error: msg,
      });
      setClaimError(`${msg} (${debugId})`);
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
        body:    JSON.stringify({ txHash: claimTxHash, purchaseType: "claim", debugId: lastDebugId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        console.warn("[farkle-claim] retrySync pending", {
          status: res.status,
          code: detail?.code ?? null,
          debugId: detail?.debugId ?? lastDebugId,
        });
        return false;
      }
      setSyncFailed(false);
      return true;
    } catch {
      return false;
    } finally {
      setRetrying(false);
    }
  }, [claimTxHash, lastDebugId]);

  return {
    claimable,
    claimEnabled,
    claiming,
    claimError,
    loading,
    claimTxHash,
    syncFailed,
    retrying,
    retrySync,
    claim,
    refresh,
    lastDebugId,
  };
}
