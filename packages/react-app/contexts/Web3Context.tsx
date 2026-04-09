"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { getReferralTag, submitReferral } from '@divvi/referral-sdk';

import {
  createPublicClient,
  createWalletClient,
  custom,
  getContract,
  http,
  parseEther,
  formatUnits,
  parseUnits,
  erc20Abi,
} from "viem";
import { celo } from "viem/chains";
import StableTokenABI from "@/contexts/cusd-abi.json";
import MiniMilesAbi from "@/contexts/minimiles.json";
import raffleAbi from "@/contexts/miniraffle.json";
import diceAbi from "@/contexts/akibadice.json";
import vaultAbi from "@/contexts/vault.json";
import posthog from "posthog-js";
import { USD_TIERS } from "@/lib/diceTypes";
import type { DiceTier, DiceSlot, DiceRoundStateName, DiceRoundView } from "@/lib/diceTypes";
import { isMiniPayProvider } from "@/lib/minipay";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;
/** USDT on Celo mainnet */
const USDT_ADDRESS = (
  process.env.NEXT_PUBLIC_USDT_ADDRESS ??
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
) as `0x${string}`;
const VAULT_SHARE_TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_SHARE_TOKEN_ADDRESS ??
  "0x9eF834341C0aaE253206e838c37518d1E1927716"
) as `0x${string}`;
const VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_ADDRESS ??
  "0xe44326FA2ea736A4c973Fa98892d0487246e8D2D"
) as `0x${string}`;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

type Web3ContextValue = ReturnType<typeof useWeb3Logic>;

const Web3Context = createContext<Web3ContextValue | null>(null);

// ── Module-level auth readiness ───────────────────────────────────────────────
// _signInAttempted: ensures at most one sign-in per page load (survives remounts).
// _authResolve: resolves _authPromise the moment a session is established so
//   any claim handler that calls waitForAuth() unblocks automatically.
let _signInAttempted = false;
let _authResolve: (() => void) | null = null;
const _authPromise = new Promise<void>(resolve => { _authResolve = resolve; });

// ── The actual logic, runs exactly once inside the provider ──────────────────

function useWeb3Logic() {
  const [address, setAddress] = useState<string | null>(null);
  const [walletClient, setWalletClient] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const client = createWalletClient({
      transport: custom(window.ethereum),
      chain: celo,
    });
    setWalletClient(client);

    client
      .getAddresses()
      .then(async ([addr]) => {
        setAddress(addr);

        // Check for an existing valid session — avoids a sign-in on every
        // page navigation when the user is already authenticated.
        const markAuthed = () => {
          setIsAuthenticated(true);
          _authResolve?.();
        };

        try {
          const res = await fetch("/api/auth/session");
          const data = await res.json();
          if (data.authenticated && data.walletAddress === addr.toLowerCase()) {
            markAuthed();
            _signInAttempted = true;
            return;
          }
        } catch { /* ignore */ }

        // Module-level guard — one attempt per page load, survives remounts
        if (_signInAttempted) return;
        _signInAttempted = true;

        const isMiniPay = !!(window as any).ethereum?.isMiniPay;

        try {
          if (isMiniPay) {
            // MiniPay: user is already authenticated via Google/Apple.
            // No signature needed — just create a server session from the address.
            const res = await fetch("/api/auth/minipay", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address: addr }),
            });
            if (res.ok) markAuthed();
          } else {
            // Browser: full SIWE — prove ownership of the wallet via signature.
            const { nonce } = await fetch(`/api/auth/nonce?address=${addr}`).then(r => r.json());
            const message = [
              "Sign in to MiniMiles",
              "",
              "This request does not trigger a blockchain transaction or cost any fees.",
              "",
              `Address: ${addr.toLowerCase()}`,
              `Nonce: ${nonce}`,
              `Issued At: ${new Date().toISOString()}`,
            ].join("\n");
            const hexMessage = `0x${Buffer.from(message, "utf8").toString("hex")}`;
            const signature = await window.ethereum.request({
              method: "personal_sign",
              params: [hexMessage, addr],
            });
            const verifyRes = await fetch("/api/auth/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address: addr, message, signature }),
            });
            if (verifyRes.ok) markAuthed();
          }
        } catch (e) {
          // Reset on failure so a full page reload can retry
          _signInAttempted = false;
          console.warn("[Web3Context] sign-in failed:", e);
        }
      })
      .catch(console.error);
  }, []);

  const getUserAddress = async () => {
    if (typeof window !== "undefined" && window.ethereum) {
      const client = createWalletClient({
        transport: custom(window.ethereum),
        chain: celo,
      });
      const [addr] = await client.getAddresses();
      setAddress(addr);
      posthog.identify(addr);
    }
  };

  const publicClient = useMemo(
    () =>
      typeof window !== "undefined" && (window as any).ethereum
        ? createPublicClient({
            chain: celo,
            transport: custom((window as any).ethereum),
          })
        : createPublicClient({
            chain: celo,
            transport: http(),
          }),
    []
  );

  const V2_ADDRESS = (
    process.env.NEXT_PUBLIC_MINIPOINTS_V2_ADDRESS ??
    "0xab93400000751fc17918940C202A66066885d628"
  ) as `0x${string}`;

  const getakibaMilesBalance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    const miniMiles = getContract({
      abi: MiniMilesAbi.abi,
      address: V2_ADDRESS,
      client: publicClient,
    });
    const raw: bigint = await miniMiles.read.balanceOf([address]) as bigint;
    return formatUnits(raw, 18);
  }, [address, publicClient, V2_ADDRESS]);

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

  const joinRaffle = useCallback(async (roundId: number, ticketCount: number) => {
    if (!walletClient || !address) throw new Error('Wallet not connected');

    const chainId = await walletClient.getChainId();
    if (publicClient?.chain?.id !== chainId) throw new Error('Wrong network');

    const referralTag = getReferralTag({
      user: address as `0x${string}`,
      consumer: '0x03909bb1E9799336d4a8c49B74343C2a85fDad9d',
    });

    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29',
      abi: raffleAbi.abi,
      functionName: 'joinRaffle',
      account: address as `0x${string}`,
      args: [BigInt(roundId), BigInt(ticketCount)],
      dataSuffix: `0x${referralTag.replace(/^0x/, '')}`,
    });

    try {
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    } catch (err: any) {
      const m = String(err?.message || '');
      if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
        console.warn('Ignoring provider range error while waiting for receipt:', err);
      } else {
        throw err;
      }
    }

    try {
      await submitReferral({ txHash: hash, chainId });
    } catch (e) {
      console.error('Divvi submitReferral failed', e);
    }

    return hash;
  }, [walletClient, publicClient, address]);

  function getDiceReadContract() {
    return getContract({ abi: diceAbi.abi, address: DICE_ADDRESS, client: publicClient });
  }

  const fetchDiceRound = useCallback(
    async (tier: DiceTier): Promise<DiceRoundView> => {
      const dice = getDiceReadContract();
      const roundId: bigint = (await dice.read.getActiveRoundId([BigInt(tier)])) as bigint;

      const usdTier = (USD_TIERS as readonly number[]).includes(Number(tier));

      if (roundId === 0n) {
        return {
          tier, roundId, filledSlots: 0, winnerSelected: false,
          winningNumber: null, randomBlock: 0n, winner: null,
          slots: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, player: null })),
          myNumber: null, state: "none", isUsdTier: usdTier,
        };
      }

      const [tierOnChain, filledSlots, winnerSelected, winningNumber, randomBlock, winner] =
        (await dice.read.getRoundInfo([roundId])) as [bigint, number, boolean, number, bigint, `0x${string}`];

      const [players, numbers] = (await dice.read.getRoundSlots([roundId])) as [`0x${string}`[], number[]];
      const rawState = (await dice.read.getRoundState([roundId])) as bigint | number | string;
      const stateNum = Number(rawState);

      let myNumber: number | null = null;
      if (address) {
        const [joined, rid, num] = (await dice.read.getMyActiveEntryForTier([
          BigInt(tier),
          address as `0x${string}`,
        ])) as [boolean, bigint, number];
        if (joined && rid === roundId) myNumber = Number(num);
      }

      const slots: DiceSlot[] = numbers.map((n, idx) => ({
        number: Number(n),
        player:
          players[idx] && players[idx].toLowerCase() !== "0x0000000000000000000000000000000000000000"
            ? (players[idx] as `0x${string}`)
            : null,
      }));

      const state: DiceRoundStateName =
        stateNum === 1 ? "open"
        : stateNum === 2 ? "fullWaiting"
        : stateNum === 3 ? "ready"
        : stateNum === 4 ? "resolved"
        : "none";

      return {
        tier: Number(tierOnChain), roundId, filledSlots: Number(filledSlots),
        winnerSelected, winningNumber: winningNumber === 0 ? null : Number(winningNumber),
        randomBlock,
        winner: winner && winner.toLowerCase() !== "0x0000000000000000000000000000000000000000"
          ? (winner as `0x${string}`) : null,
        slots, myNumber, state, isUsdTier: usdTier,
      };
    },
    [address, publicClient]
  );

  const getDiceTierStats = useCallback(
    async (tier: DiceTier) => {
      const dice = getDiceReadContract();
      const [roundsCreated, roundsResolved, totalStaked, totalPayout] =
        (await dice.read.getTierStats([BigInt(tier)])) as [bigint, bigint, bigint, bigint];
      return {
        roundsCreated: Number(roundsCreated),
        roundsResolved: Number(roundsResolved),
        totalStaked,
        totalPayout,
      };
    },
    [publicClient]
  );

  const getDicePlayerStats = useCallback(
    async (player?: string) => {
      const target = (player || address) as `0x${string}` | null;
      if (!target) throw new Error("No player address");
      const dice = getDiceReadContract();
      const [roundsJoined, roundsWon, totalStaked, totalWon] =
        (await dice.read.getPlayerStats([target])) as [bigint, bigint, bigint, bigint];
      return { roundsJoined: Number(roundsJoined), roundsWon: Number(roundsWon), totalStaked, totalWon };
    },
    [publicClient, address]
  );

  const getStablecoinBalance = useCallback(async () => {
    if (!address) return "0";
    const bal = await publicClient.readContract({
      address: USDT_ADDRESS,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as bigint;
    return formatUnits(bal, 6);
  }, [address, publicClient]);

  const getUSDTBalance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    const usdt = getContract({
      abi: erc20Abi,
      address: USDT_ADDRESS,
      client: publicClient,
    });
    const raw = (await usdt.read.balanceOf([address as `0x${string}`])) as bigint;
    return Number(formatUnits(raw, 6)).toFixed(2);
  }, [address, publicClient]);

  const getUserVaultBalance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    const vaultToken = getContract({
      abi: erc20Abi,
      address: VAULT_SHARE_TOKEN_ADDRESS,
      client: publicClient,
    });
    const raw = (await vaultToken.read.balanceOf([address as `0x${string}`])) as bigint;
    return Number(formatUnits(raw, 6)).toFixed(2);
  }, [address, publicClient]);

  const getVaultDeposit = useCallback(async () => {
    const balance = await getUserVaultBalance();
    return Number(balance).toFixed(2);
  }, [getUserVaultBalance]);

  const approveVault = useCallback(async (amount: string) => {
    if (isMiniPayProvider()) throw new Error("Akiba Vault is not available in MiniPay.");
    if (!walletClient || !address) throw new Error("Wallet not connected");

    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: USDT_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      account: address as `0x${string}`,
      args: [VAULT_ADDRESS, parseUnits(amount, 6)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    });

    return { hash, receipt };
  }, [walletClient, address, publicClient]);

  const deposit = useCallback(async (amount: string) => {
    if (isMiniPayProvider()) throw new Error("Akiba Vault is not available in MiniPay.");
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const parsedAmount = parseUnits(amount, 6);

    await publicClient.simulateContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "deposit",
      account: address as `0x${string}`,
      args: [parsedAmount],
    });

    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "deposit",
      account: address as `0x${string}`,
      args: [parsedAmount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    });

    return { hash, receipt };
  }, [walletClient, address, publicClient]);

  const withdraw = useCallback(async (amount: string) => {
    if (isMiniPayProvider()) throw new Error("Akiba Vault is not available in MiniPay.");
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const parsedAmount = parseUnits(amount, 6);

    await publicClient.simulateContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "withdraw",
      account: address as `0x${string}`,
      args: [parsedAmount],
    });

    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "withdraw",
      account: address as `0x${string}`,
      args: [parsedAmount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    });

    return { hash, receipt };
  }, [walletClient, address, publicClient]);

  const hasAllowance = useCallback(async (amount: string) => {
    if (!address) return false;
    const usdt = getContract({
      abi: erc20Abi,
      address: USDT_ADDRESS,
      client: publicClient,
    });
    const raw = (await usdt.read.allowance([
      address as `0x${string}`,
      VAULT_ADDRESS,
    ])) as bigint;
    return raw >= parseUnits(amount || "0", 6);
  }, [address, publicClient]);

  /** Approve USDT spending for the Dice contract. Call before joinDice on USD tiers. */
  const approveUsdtForDice = useCallback(async (amount: bigint) => {
    if (isMiniPayProvider()) throw new Error("USDT Dice is not available in MiniPay.");
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const chainId = await walletClient.getChainId();
    if (chainId !== celo.id) throw new Error("Wrong network");

    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: USDT_ADDRESS,
      abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "approve",
      account: address as `0x${string}`,
      args: [DICE_ADDRESS, amount],
    });

    try {
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    } catch (err: any) {
      const m = String(err?.message || "");
      if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
        console.warn("Ignoring provider range error while waiting for approve receipt:", err);
      } else {
        throw err;
      }
    }
    return hash;
  }, [walletClient, address, publicClient]);

  const joinDice = useCallback(
    async (tier: DiceTier, chosenNumber: number) => {
      if (!walletClient || !address) throw new Error("Wallet not connected");
      if (isMiniPayProvider() && (USD_TIERS as readonly number[]).includes(Number(tier))) {
        throw new Error("USDT Dice is not available in MiniPay.");
      }
      const chainId = await walletClient.getChainId();
      if (chainId !== celo.id) throw new Error("Wrong network");

      const hash = await walletClient.writeContract({
        chain: walletClient.chain,
        address: DICE_ADDRESS,
        abi: diceAbi.abi,
        functionName: "joinTier",
        account: address as `0x${string}`,
        args: [BigInt(tier), chosenNumber],
      });

      try {
        await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      } catch (err: any) {
        const m = String(err?.message || "");
        if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
          console.warn("Ignoring provider range error while waiting for receipt:", err);
        } else {
          throw err;
        }
      }
      return hash;
    },
    [walletClient, address, publicClient]
  );

  const getDiceBonusPool = useCallback(async (): Promise<bigint> => {
    const dice = getDiceReadContract();
    return (await dice.read.bonusPool([])) as bigint;
  }, [publicClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const getLastResolvedRoundForPlayer = useCallback(
    async (tier: DiceTier, player?: `0x${string}`) => {
      const p = (player as `0x${string}`) || (address as `0x${string}`) || null;
      if (!p) return null;

      const dice = getDiceReadContract();
      const activeId = (await dice.read.getActiveRoundId([BigInt(tier)])) as bigint;
      if (activeId === 0n) return null;

      const candidates: bigint[] = [activeId];
      if (activeId > 1n) candidates.push(activeId - 1n);

      for (const rid of candidates) {
        if (rid === 0n) continue;

        const [tierOnChain, filledSlots, winnerSelected, winningNumber, randomBlock, winner] =
          (await dice.read.getRoundInfo([rid])) as [bigint, number, boolean, number, bigint, `0x${string}`];

        if (!winnerSelected || winningNumber === 0 || !winner || winner.toLowerCase() === ZERO_ADDR) continue;

        const [joined, myNum] = (await dice.read.getMyNumberInRound([rid, p])) as [boolean, number];
        if (!joined) continue;

        const [players, numbers] = (await dice.read.getRoundSlots([rid])) as [`0x${string}`[], number[]];
        const slots: DiceSlot[] = numbers.map((n, idx) => ({
          number: Number(n),
          player: players[idx] && players[idx].toLowerCase() !== ZERO_ADDR
            ? (players[idx] as `0x${string}`) : null,
        }));

        return {
          tier: Number(tierOnChain), roundId: rid, filledSlots: Number(filledSlots),
          winnerSelected, winningNumber: Number(winningNumber), randomBlock,
          winner: winner && winner.toLowerCase() !== ZERO_ADDR ? (winner as `0x${string}`) : null,
          slots, myNumber: joined ? Number(myNum) : null, state: "resolved" as DiceRoundStateName,
          isUsdTier: (USD_TIERS as readonly number[]).includes(Number(tierOnChain)),
        };
      }
      return null;
    },
    [address, publicClient]
  );

  /**
   * Waits until the session is established (or the timeout elapses).
   * Call this at the top of any claim handler to absorb the brief startup gap.
   *
   *   const { waitForAuth } = useWeb3();
   *   const handleClaim = async () => {
   *     await waitForAuth();
   *     // session is now guaranteed — proceed with the API call
   *   };
   */
  const waitForAuth = useCallback(
    (timeoutMs = 8000): Promise<void> =>
      isAuthenticated
        ? Promise.resolve()
        : Promise.race([
            _authPromise,
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
          ]),
    [isAuthenticated]
  );

  return {
    address,
    isAuthenticated,
    waitForAuth,
    getakibaMilesBalance,
    getUserAddress,
    sendCUSD,
    joinRaffle,
    fetchDiceRound,
    joinDice,
    approveUsdtForDice,
    getStablecoinBalance,
    getUSDTBalance,
    getUserVaultBalance,
    getVaultDeposit,
    approveVault,
    deposit,
    withdraw,
    hasAllowance,
    getDiceTierStats,
    getDicePlayerStats,
    getDiceBonusPool,
    getLastResolvedRoundForPlayer,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const value = useWeb3Logic();
  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}

// ── Hook (drop-in replacement — all 26 call sites unchanged) ─────────────────

export function useWeb3() {
  const ctx = useContext(Web3Context);
  if (!ctx) throw new Error("useWeb3 must be used inside <Web3Provider>");
  return ctx;
}
