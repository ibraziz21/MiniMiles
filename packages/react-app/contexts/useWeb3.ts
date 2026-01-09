// src/contexts/useWeb3.ts
"use client";


import { getReferralTag, submitReferral } from '@divvi/referral-sdk'
import { useState, useEffect, useCallback , useMemo} from "react";
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
import posthog from "posthog-js";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";


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

export function useWeb3() {
  const [address, setAddress]         = useState<string | null>(null);
  const [walletClient, setWalletClient] = useState<any>(null);

   // 1️⃣ instantiate once on mount (wallet client)
   useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const client = createWalletClient({
      transport: custom(window.ethereum),
      chain: celo,
    });
    setWalletClient(client);

    client
      .getAddresses()
      .then(([addr]) => setAddress(addr))
      .catch(console.error);
  }, []);

  const getUserAddress = async () => {
    if (typeof window !== "undefined" && window.ethereum) {
      const walletClient = createWalletClient({
        transport: custom(window.ethereum),
        chain: celo,
      });

      const [addr] = await walletClient.getAddresses();
      setAddress(addr);
      posthog.identify(addr);
    }
  };

  // 2️⃣ publicClient: prefer injected provider on client to avoid CORS,
  // fallback to HTTP (Forno) in SSR/Node contexts.
  const publicClient = useMemo(
    () =>
      typeof window !== "undefined" && (window as any).ethereum
        ? createPublicClient({
            chain: celo,
            transport: custom((window as any).ethereum),
          })
        : createPublicClient({
            chain: celo,
            transport: http(), // only used where CORS isn't a thing
          }),
    []
  );



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
 const joinRaffle = useCallback(async (roundId: number, ticketCount: number) => {
  if (!walletClient || !address) throw new Error('Wallet not connected')

  const chainId = await walletClient.getChainId()
  if (publicClient?.chain?.id !== chainId) throw new Error('Wrong network')

  const referralTag = getReferralTag({
    user: address as `0x${string}`,
    consumer: '0x03909bb1E9799336d4a8c49B74343C2a85fDad9d',
  })

  const hash = await walletClient.writeContract({
    chain: walletClient.chain,
    address: '0xD75dfa972C6136f1c594Fec1945302f885E1ab29',
    abi: raffleAbi.abi,
    functionName: 'joinRaffle',
    account: address as `0x${string}`,
    args: [BigInt(roundId), BigInt(ticketCount)],
    dataSuffix: `0x${referralTag.replace(/^0x/, '')}`, // ensure no double 0x
  })

  // Soft wait for 1 conf; swallow provider range quirks
  try {
    await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
    })
  } catch (err: any) {
    const m = String(err?.message || '')
    if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
      console.warn('Ignoring provider range error while waiting for receipt:', err)
    } else {
      throw err
    }
  }

  // Attribution (don’t block UX)
  try {
    await submitReferral({ txHash: hash, chainId })
  } catch (e) {
    console.error('Divvi submitReferral failed', e)
  }

  return hash
}, [walletClient, publicClient, address])


// ──────────────────────────────────────────────
  // Dice game: read helpers
  // ──────────────────────────────────────────────

  function getDiceReadContract() {
    return getContract({
      abi: diceAbi.abi,
      address: DICE_ADDRESS,
      client: publicClient,
    });
  }

  const fetchDiceRound = useCallback(
    async (tier: DiceTier): Promise<DiceRoundView> => {
      const dice = getDiceReadContract();

      const roundId: bigint = (await dice.read.getActiveRoundId([
        BigInt(tier),
      ])) as bigint;

      if (roundId === 0n) {
        return {
          tier,
          roundId,
          filledSlots: 0,
          winnerSelected: false,
          winningNumber: null,
          randomBlock: 0n,
          winner: null,
          slots: Array.from({ length: 6 }, (_, i) => ({
            number: i + 1,
            player: null,
          })),
          myNumber: null,
          state: "none",
        };
      }

      const [
        tierOnChain,
        filledSlots,
        winnerSelected,
        winningNumber,
        randomBlock,
        winner,
      ] = (await dice.read.getRoundInfo([roundId])) as [
        bigint,
        number,
        boolean,
        number,
        bigint,
        `0x${string}`
      ];

      const [players, numbers] = (await dice.read.getRoundSlots([
        roundId,
      ])) as [`0x${string}`[], number[]];

      const rawState = (await dice.read.getRoundState([
        roundId,
      ])) as bigint | number | string;
      const stateNum = Number(rawState);

      let myNumber: number | null = null;
      if (address) {
        const [joined, rid, num] =
          (await dice.read.getMyActiveEntryForTier([
            BigInt(tier),
            address as `0x${string}`,
          ])) as [boolean, bigint, number];
        if (joined && rid === roundId) {
          myNumber = Number(num);
        }
      }

      const slots: DiceSlot[] = numbers.map((n, idx) => ({
        number: Number(n),
        player:
          players[idx] &&
          players[idx].toLowerCase() !==
            "0x0000000000000000000000000000000000000000"
            ? (players[idx] as `0x${string}`)
            : null,
      }));

      const state: DiceRoundStateName =
        stateNum === 1
          ? "open"
          : stateNum === 2
          ? "fullWaiting"
          : stateNum === 3
          ? "ready"
          : stateNum === 4
          ? "resolved"
          : "none";

      return {
        tier: Number(tierOnChain),
        roundId,
        filledSlots: Number(filledSlots),
        winnerSelected,
        winningNumber: winningNumber === 0 ? null : Number(winningNumber),
        randomBlock,
        winner:
          winner &&
          winner.toLowerCase() !==
            "0x0000000000000000000000000000000000000000"
            ? (winner as `0x${string}`)
            : null,
        slots,
        myNumber,
        state,
      };
    },
    [address, publicClient]
  );

  const getDiceTierStats = useCallback(
    async (tier: DiceTier) => {
      const dice = getDiceReadContract();
      const [roundsCreated, roundsResolved, totalStaked, totalPayout] =
        (await dice.read.getTierStats([BigInt(tier)])) as [
          bigint,
          bigint,
          bigint,
          bigint
        ];

      return {
        roundsCreated: Number(roundsCreated),
        roundsResolved: Number(roundsResolved),
        totalStaked,
        totalPayout,
      };
    },
    [publicClient]
  );

 // inside useWeb3()

const getDicePlayerStats = useCallback(
  async (player?: string) => {
    // If no explicit player passed, fall back to connected wallet
    const target = (player || address) as `0x${string}` | null;
    if (!target) throw new Error("No player address");

    const dice = getDiceReadContract();

    // getPlayerStats(address) → (uint64, uint64, uint128, uint128)
    const [roundsJoined, roundsWon, totalStaked, totalWon] =
      (await dice.read.getPlayerStats([target])) as [
        bigint,
        bigint,
        bigint,
        bigint
      ];

    return {
      roundsJoined: Number(roundsJoined),
      roundsWon: Number(roundsWon),
      totalStaked,
      totalWon,
    };
  },
  [publicClient, address]
);


  // ──────────────────────────────────────────────
  // Dice game: join
  // ──────────────────────────────────────────────

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
        await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 120_000,
        });
      } catch (err: any) {
        const m = String(err?.message || "");
        if (
          /(block.*out of range|header not found|query timeout)/i.test(m)
        ) {
          console.warn(
            "Ignoring provider range error while waiting for receipt:",
            err
          );
        } else {
          throw err;
        }
      }

      return hash;
    },
    [walletClient, address, publicClient]
  );

  const getLastResolvedRoundForPlayer = useCallback(
    async (tier: DiceTier, player?: `0x${string}`) => {
      const p =
        (player as `0x${string}`) ||
        (address as `0x${string}`) ||
        null;
      if (!p) return null;

      const dice = getDiceReadContract();

      const activeId = (await dice.read.getActiveRoundId([
        BigInt(tier),
      ])) as bigint;

      if (activeId === 0n) return null;

      // Candidates: active round first, then active-1
      const candidates: bigint[] = [activeId];
      if (activeId > 1n) {
        candidates.push(activeId - 1n);
      }

      for (const rid of candidates) {
        if (rid === 0n) continue;

        const [
          tierOnChain,
          filledSlots,
          winnerSelected,
          winningNumber,
          randomBlock,
          winner,
        ] = (await dice.read.getRoundInfo([rid])) as [
          bigint,
          number,
          boolean,
          number,
          bigint,
          `0x${string}`
        ];

        // Must be resolved with a real winner
        if (
          !winnerSelected ||
          winningNumber === 0 ||
          !winner ||
          winner.toLowerCase() === ZERO_ADDR
        ) {
          continue;
        }

        // Did this player join THIS round?
        const [joined, myNum] = (await dice.read.getMyNumberInRound([
          rid,
          p,
        ])) as [boolean, number];

        if (!joined) {
          continue;
        }

        const [players, numbers] = (await dice.read.getRoundSlots([
          rid,
        ])) as [`0x${string}`[], number[]];

        const slots: DiceSlot[] = numbers.map((n, idx) => ({
          number: Number(n),
          player:
            players[idx] &&
            players[idx].toLowerCase() !== ZERO_ADDR
              ? (players[idx] as `0x${string}`)
              : null,
        }));

        const view: DiceRoundView = {
          tier: Number(tierOnChain),
          roundId: rid,
          filledSlots: Number(filledSlots),
          winnerSelected,
          winningNumber: Number(winningNumber),
          randomBlock,
          winner:
            winner &&
            winner.toLowerCase() !== ZERO_ADDR
              ? (winner as `0x${string}`)
              : null,
          slots,
          myNumber: joined ? Number(myNum) : null,
          state: "resolved",
        };

        return view;
      }

      return null;
    },
    [address, publicClient]
  );


  return {
    address,
    getakibaMilesBalance,
    getUserAddress,
    sendCUSD,
    joinRaffle,
    fetchDiceRound,
    joinDice,
    getDiceTierStats,
    getDicePlayerStats,
    getLastResolvedRoundForPlayer
  };
}
