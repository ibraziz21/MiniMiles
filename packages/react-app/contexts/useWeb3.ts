// src/contexts/useWeb3.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getContract,
  http,
  parseEther,
  formatUnits,
} from "viem";
import { celo } from "viem/chains";
import StableTokenABI from "@/contexts/cusd-abi.json";
import MiniMilesAbi from "@/contexts/minimiles.json";
import raffleAbi from "@/contexts/miniraffle.json";
import posthog from "posthog-js";

export function useWeb3() {
  const [address, setAddress] = useState<string | null>(null);
  const [walletClient, setWalletClient] = useState<any>(null);

  // 1️⃣ instantiate once on mount
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const client = createWalletClient({
      transport: custom(window.ethereum),
      chain: celo,
    });
    setWalletClient(client);

    // grab the address
    client.getAddresses().then(([addr]) => setAddress(addr)).catch(console.error);
  }, []);

  const getUserAddress = async () => {
    if (typeof window !== "undefined" && window.ethereum) {
      let walletClient = createWalletClient({
        transport: custom(window.ethereum),
        chain: celo,
      });

      let [address] = await walletClient.getAddresses();
      setAddress(address);
      posthog.identify(address)
    }
  };

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(),
  });

  // 2️⃣ Helpers can now reuse walletClient + publicClient + address

  const getakibaMilesBalance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    const miniMiles = getContract({
      abi: MiniMilesAbi.abi,
      address: "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b",
      client: publicClient,
    });
    const raw: bigint = await miniMiles.read.balanceOf([address]) as bigint;
    return formatUnits(raw, 18);
  }, [address, publicClient]);

  const sendCUSD = useCallback(
    async (to: string, amount: string) => {
      if (!walletClient || !address) throw new Error("Wallet not ready");
      const tx = await walletClient.writeContract({
        address: "0x874069Fa1Eb16d44d622f2e0Ca25eeA172369bC1",
        abi: StableTokenABI.abi,
        functionName: "transfer",
        account: address,
        args: [to, parseEther(amount)],
      });
      return publicClient.waitForTransactionReceipt({ hash: tx });
    },
    [walletClient, address, publicClient]
  );

  // in src/contexts/useWeb3.ts
  // 2️⃣ joinRaffle writes directly
  const joinRaffle = useCallback(
    async (roundId: number, ticketCount: number) => {
      if (!walletClient || !address) throw new Error("Wallet not connected");

      const hash = await walletClient.writeContract({
        address: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29',
        abi: raffleAbi.abi,
        functionName: "joinRaffle",
        account: address,
        args: [BigInt(roundId), BigInt(ticketCount)]
      });

      // wait until it’s mined (optional-but-nice UX)
      await publicClient.waitForTransactionReceipt({ hash });

      return hash;          // <- RETURN THE HASH STRING
    },
    [walletClient, address, publicClient]
  );


  return {
    address,
    getakibaMilesBalance,
    getUserAddress,
    sendCUSD,
    joinRaffle,
  };
}
