"use client";

import { useCallback, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { FARKLE_TICKET_ADDRESS, farkleTicketAbi } from "@/lib/farkle/contracts";

export function useFarkleTickets(address: string | null | undefined) {
  const [buying,     setBuying]     = useState(false);
  const [buyError,   setBuyError]   = useState<string | null>(null);
  const [txHash,     setTxHash]     = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [retrying,   setRetrying]   = useState(false);

  const buyPack = useCallback(async (): Promise<boolean> => {
    if (!address || !FARKLE_TICKET_ADDRESS) {
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

      const hash = await walletClient.writeContract({
        chain:        celo,
        account:      address as `0x${string}`,
        address:      FARKLE_TICKET_ADDRESS,
        abi:          farkleTicketAbi,
        functionName: "buyTicketPack",
        args:         [],
      });

      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });

      // Sync ledger — wallet identity comes from the server session, not the body.
      const syncRes = await fetch("/api/games/farkle/tickets/buy", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ txHash: hash }),
      }).catch(() => null);

      if (!syncRes || !syncRes.ok) {
        const detail = await syncRes?.json().catch(() => null);
        console.error("[useFarkleTickets] sync failed", syncRes?.status, detail);
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
        body:    JSON.stringify({ txHash, purchaseType: "ticket" }),
      });
      if (!res.ok) {
        console.error("[useFarkleTickets] retrySync failed", res.status, await res.json().catch(() => null));
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

  return { buyPack, buying, buyError, txHash, syncFailed, retrying, retrySync };
}
