"use client";

import { useCallback, useState } from "react";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { FARKLE_TICKET_ADDRESS, farkleTicketAbi } from "@/lib/farkle/contracts";

export function useFarkleTickets(address: string | null | undefined) {
  const [buying,   setBuying]   = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [txHash,   setTxHash]   = useState<string | null>(null);

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

      // Sync ledger in Supabase
      await fetch("/api/games/farkle/tickets/buy", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ address: address.toLowerCase(), txHash: hash }),
      });

      return true;
    } catch (err: any) {
      const msg: string = err?.shortMessage ?? err?.message ?? "Transaction failed";
      setBuyError(msg.length > 80 ? msg.slice(0, 80) + "…" : msg);
      return false;
    } finally {
      setBuying(false);
    }
  }, [address]);

  return { buyPack, buying, buyError, txHash };
}
