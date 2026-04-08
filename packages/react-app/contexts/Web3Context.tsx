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
} from "viem";
import { celo } from "viem/chains";
import StableTokenABI from "@/contexts/cusd-abi.json";
import MiniMilesAbi from "@/contexts/minimiles.json";
import raffleAbi from "@/contexts/miniraffle.json";
import diceAbi from "@/contexts/akibadice.json";
import clawAbi from "@/contexts/akibaClawGame.json";
import posthog from "posthog-js";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const CLAW_GAME_ADDRESS = (
  process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3"
) as const;
const CLAW_USDT_ADDRESS = (
  process.env.NEXT_PUBLIC_CLAW_USDT_ADDRESS ??
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
) as const;

const USDT_ABI = [
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type DiceTier = 10 | 20 | 30;

export type DiceSlot = {
  number: number;
  player: `0x${string}` | null;
};

export type DiceRoundStateName =
  | "none"
  | "open"
  | "fullWaiting"
  | "ready"
  | "resolved";

export type DiceRoundView = {
  tier: number;
  roundId: bigint;
  filledSlots: number;
  winnerSelected: boolean;
  winningNumber: number | null;
  randomBlock: bigint;
  winner: `0x${string}` | null;
  slots: DiceSlot[];
  myNumber: number | null;
  state: DiceRoundStateName;
};

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

  const writePublicClient = useMemo(
    () =>
      createPublicClient({
        chain: celo,
        transport: http("https://forno.celo.org"),
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

      if (roundId === 0n) {
        return {
          tier, roundId, filledSlots: 0, winnerSelected: false,
          winningNumber: null, randomBlock: 0n, winner: null,
          slots: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, player: null })),
          myNumber: null, state: "none",
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
        slots, myNumber, state,
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

  const joinDice = useCallback(
    async (tier: DiceTier, chosenNumber: number) => {
      if (!walletClient || !address) throw new Error("Wallet not connected");
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

  const approveClawUsdt = useCallback(async () => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: CLAW_USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "approve",
      account: address as `0x${string}`,
      args: [CLAW_GAME_ADDRESS, MAX],
    });
    await writePublicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
    return hash;
  }, [walletClient, address, writePublicClient]);

  const startClawGame = useCallback(async (tierId: number) => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const { request } = await writePublicClient.simulateContract({
      address: CLAW_GAME_ADDRESS,
      abi: clawAbi.abi,
      functionName: "startGame",
      args: [tierId],
      account: address as `0x${string}`,
      chain: celo,
    });
    const hash = await walletClient.writeContract(request);
    await writePublicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
    return hash;
  }, [walletClient, address, writePublicClient]);

  const burnClawVoucherReward = useCallback(async (sessionId: bigint) => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const hash = await walletClient.writeContract({
      chain: walletClient.chain,
      address: CLAW_GAME_ADDRESS,
      abi: clawAbi.abi,
      functionName: "burnVoucherReward",
      account: address as `0x${string}`,
      args: [sessionId],
    });
    await writePublicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
    return hash;
  }, [walletClient, address, writePublicClient]);

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
    approveClawUsdt,
    startClawGame,
    burnClawVoucherReward,
    getDiceTierStats,
    getDicePlayerStats,
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
