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
  parseUnits,
  erc20Abi
} from "viem";
import { celo } from "viem/chains";
import StableTokenABI from "@/contexts/cusd-abi.json";
import MiniMilesAbi from "@/contexts/minimiles.json";
import raffleAbi from "@/contexts/miniraffle.json";
import vaultAbi from "./vault.json"
import posthog from "posthog-js";

export function useWeb3() {
  const [address, setAddress] = useState<string | null>(null);
  const [walletClient, setWalletClient] = useState<any>(null);

  const USDT_ADDRESS = process.env.USDT_ADDRESS || '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'
  const akUSDT = '0x9eF834341C0aaE253206e838c37518d1E1927716'
  const vault = '0xe44326FA2ea736A4c973Fa98892d0487246e8D2D'

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

  const getUSDTBalance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    const usdt_contract = getContract({
      abi: erc20Abi,
      address: USDT_ADDRESS as `0x${string}` ,
      client: publicClient,
    });
    const raw: bigint = await usdt_contract.read.balanceOf([address as `0x${string}`]) as bigint;
    const balance =  formatUnits(raw, 6)
    return Number(balance).toFixed(2);
  }, [address, publicClient]);


  const getUserVaultBalance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    const usdt_contract = getContract({
      abi: erc20Abi,
      address: akUSDT as `0x${string}` ,
      client: publicClient,
    });
    const raw: bigint = await usdt_contract.read.balanceOf([address as `0x${string}`]) as bigint;
    const balance =  formatUnits(raw, 6)
    return Number(balance).toFixed(2);
  }, [address, publicClient]);


  const approveVault = useCallback(
    async (amount: string) => {
      if (!walletClient || !address) throw new Error("Wallet not ready");
      const tx = await walletClient.writeContract({
        address: USDT_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        account: address,
        args: [vault, parseUnits(amount, 6)],
      });
      return publicClient.waitForTransactionReceipt({ hash: tx });
    },
    [walletClient, address, publicClient]
  );

  const deposit = useCallback(
    async (amount: string) => {
      if (!walletClient || !address) throw new Error("Wallet not ready");
  
      // (Optional) preflight: surface revert reasons before user signs
      await publicClient.simulateContract({
        address: vault as `0x${string}`,
        abi: vaultAbi,
        functionName: "deposit",
        account: address as `0x${string}`,
        args: [parseUnits(amount, 6)], // USDT = 6
      });
  
      const hash = await walletClient.writeContract({
        address: vault as `0x${string}`,
        abi: vaultAbi,
        functionName: "deposit",
        account: address,
        args: [parseUnits(amount, 6)],
      });
  
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,            // wait at least 1 conf
      });
  
      return { hash, receipt };
    },
    [walletClient, address, publicClient]
  );

  const withdraw = useCallback(
    async (amount: string) => {
      if (!walletClient || !address) throw new Error("Wallet not ready");
  
      // (Optional) preflight: surface revert reasons before user signs
      await publicClient.simulateContract({
        address: vault as `0x${string}`,
        abi: vaultAbi,
        functionName: "withdraw",
        account: address as `0x${string}`,
        args: [parseUnits(amount, 6)], // USDT = 6
      });
  
      const hash = await walletClient.writeContract({
        address: vault as `0x${string}`,
        abi: vaultAbi,
        functionName: "withdraw",
        account: address,
        args: [parseUnits(amount, 6)],
      });
  
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,            // wait at least 1 conf
      });
  
      return { hash, receipt };
    },
    [walletClient, address, publicClient]
  );

  const hasAllowance = useCallback(async (amount: string) => {
    if (!address) return false;
    const usdt = getContract({
      abi: erc20Abi,
      address: USDT_ADDRESS as `0x${string}`,
      client: publicClient,
    });
    const raw = await usdt.read.allowance([address as `0x${string}`, vault as `0x${string}`]) as bigint;
    return raw >= parseUnits(amount || "0", 6);
  }, [address, publicClient]);




  return {
    address,
    getakibaMilesBalance,
    getUserAddress,
    sendCUSD,
    joinRaffle,
    getUSDTBalance,
    getUserVaultBalance,
    approveVault,
    deposit,
    hasAllowance,
    withdraw
  };
}
