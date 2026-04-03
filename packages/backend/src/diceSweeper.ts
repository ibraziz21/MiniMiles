// src/diceSweeper.ts
//
// Periodically reconciles active AkibaDice rounds so that:
//   - randomness is requested as soon as a round has any players and no randomBlock
//   - rounds in "Ready" state are drawn immediately
//
// The sweeper maintains a watched-rounds registry so rounds are never lost when
// the contract's active-round pointer advances to a new round while the previous
// one is still waiting for randomness or a draw.  A round stays in the registry
// until it is confirmed resolved; restarts re-discover any unresolved rounds
// on the first sweep.

import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { ethers } from "ethers";

// ── Config ────────────────────────────────────────────────────────────────────

const DICE_ADDRESS =
  process.env.DICE_ADDRESS ?? "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const WITNET_RNG_ADDRESS = "0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB";

const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const RELAYER_PK = process.env.CELO_RELAYER_PK ?? "";

const SWEEP_INTERVAL_SECONDS = Number(
  process.env.DICE_SWEEP_INTERVAL_SECONDS ?? "60"
);

const DEFAULT_TIERS = [10, 20, 30, 250, 500, 1000];
const ACTIVE_TIERS: number[] = process.env.DICE_TIERS
  ? process.env.DICE_TIERS.split(",").map((t) => Number(t.trim()))
  : DEFAULT_TIERS;

// A round is evicted from the registry if it stays unresolved for longer than
// this — acts as a safety valve against accumulating truly dead rounds.
const MAX_WATCH_AGE_MS = Number(
  process.env.DICE_MAX_WATCH_AGE_HOURS ?? "48"
) * 60 * 60 * 1000;

const FEE_BUFFER_BPS = Number(process.env.DICE_FEE_BUFFER_BPS ?? "1000"); // 10 %

// ── ABIs ──────────────────────────────────────────────────────────────────────

const DICE_ABI = [
  "function getActiveRoundId(uint256 tier) external view returns (uint256)",
  "function getRoundInfo(uint256 roundId) external view returns (uint256 tier, uint8 filledSlots, bool winnerSelected, uint8 winningNumber, uint256 randomBlock, address winner)",
  "function getRoundState(uint256 roundId) external view returns (uint8)",
  "function requestRoundRandomness(uint256 roundId) external payable",
  "function drawRound(uint256 roundId) external",
];

const WITNET_ABI = [
  "function estimateRandomizeFee(uint256 evmGasPrice) external view returns (uint256)",
];

// ── Round state enum ──────────────────────────────────────────────────────────

const RoundState = {
  None: 0,
  Open: 1,
  FullWaiting: 2,
  Ready: 3,
  Resolved: 4,
} as const;
type RoundStateValue = (typeof RoundState)[keyof typeof RoundState];

function stateName(s: number): string {
  return (
    Object.entries(RoundState).find(([, v]) => v === s)?.[0] ?? `Unknown(${s})`
  );
}

// ── Watched-round registry ────────────────────────────────────────────────────
//
// Key: roundId as decimal string
// Value: tier the round belongs to + when we first saw it
//
// Rounds are added when discovered via getActiveRoundId or from a prior sweep.
// They are removed only when confirmed resolved (winnerSelected == true).

interface WatchEntry {
  tier: number;
  firstSeenAt: number; // Date.now()
}

const watchedRounds = new Map<string, WatchEntry>();

function registerRound(roundId: bigint, tier: number): void {
  const key = roundId.toString();
  if (!watchedRounds.has(key)) {
    watchedRounds.set(key, { tier, firstSeenAt: Date.now() });
    console.log(`[diceSweeper] Registered new round #${key} (tier ${tier})`);
  }
}

function evictStaleRounds(): void {
  const now = Date.now();
  for (const [id, entry] of watchedRounds) {
    if (now - entry.firstSeenAt > MAX_WATCH_AGE_MS) {
      console.warn(
        `[diceSweeper] Evicting stale round #${id} (tier ${entry.tier}) — ` +
          `watched for ${Math.round((now - entry.firstSeenAt) / 3_600_000)}h`
      );
      watchedRounds.delete(id);
    }
  }
}

// ── Result type ───────────────────────────────────────────────────────────────

type SweepAction =
  | "skip-no-players"
  | "skip-already-resolved"
  | "skip-randomness-pending"
  | "requested-randomness"
  | "drew"
  | "error";

interface RoundResult {
  roundId: string;
  tier: number;
  filledSlots: number;
  randomBlock: string;
  state: string;
  action: SweepAction;
  txHash?: string;
  error?: string;
}

// ── Core sweep ────────────────────────────────────────────────────────────────

export async function runDiceSweep(): Promise<RoundResult[]> {
  if (!RELAYER_PK) {
    console.warn("[diceSweeper] CELO_RELAYER_PK not set — sweep skipped");
    return [];
  }

  const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
  const wallet = new ethers.Wallet(RELAYER_PK, provider);
  const dice = new ethers.Contract(DICE_ADDRESS, DICE_ABI, wallet);
  const rng = new ethers.Contract(WITNET_RNG_ADDRESS, WITNET_ABI, provider);

  // ── Step 1: discover current active rounds and add to registry ────────────
  await discoverActiveRounds(dice);

  // ── Step 2: evict rounds that have been stuck beyond the age limit ─────────
  evictStaleRounds();

  if (watchedRounds.size === 0) {
    console.log("[diceSweeper] No rounds to process.");
    return [];
  }

  // ── Step 3: estimate Witnet fee once for the whole sweep ───────────────────
  const witnetFee = await estimateFee(provider, rng);

  // ── Step 4: process every watched round ────────────────────────────────────
  const results: RoundResult[] = [];

  for (const [roundIdStr, entry] of [...watchedRounds]) {
    const result = await processRound(
      BigInt(roundIdStr),
      entry.tier,
      dice,
      witnetFee
    );
    results.push(result);

    console.log(
      `[diceSweeper] round=${result.roundId} tier=${result.tier} ` +
        `slots=${result.filledSlots} randomBlock=${result.randomBlock} ` +
        `state=${result.state} action=${result.action}` +
        (result.txHash ? ` tx=${result.txHash}` : "") +
        (result.error ? ` error=${result.error}` : "")
    );

    // Remove resolved rounds from the registry.
    if (
      result.action === "drew" ||
      result.action === "skip-already-resolved"
    ) {
      watchedRounds.delete(roundIdStr);
    }
  }

  console.log(
    `[diceSweeper] Sweep done. Watching ${watchedRounds.size} round(s).`
  );
  return results;
}

// ── Discovery ─────────────────────────────────────────────────────────────────
// Reads the current active round per tier and registers any we haven't seen.

async function discoverActiveRounds(dice: ethers.Contract): Promise<void> {
  await Promise.allSettled(
    ACTIVE_TIERS.map(async (tier) => {
      try {
        const roundId: bigint = await dice.getActiveRoundId(BigInt(tier));
        if (roundId > 0n) {
          registerRound(roundId, tier);
        }
      } catch (err: any) {
        console.warn(
          `[diceSweeper] discoverActiveRounds tier=${tier}: ${err?.message}`
        );
      }
    })
  );
}

// ── Fee estimation ────────────────────────────────────────────────────────────

async function estimateFee(
  provider: ethers.JsonRpcProvider,
  rng: ethers.Contract
): Promise<bigint> {
  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
    const raw: bigint = await rng.estimateRandomizeFee(gasPrice);
    return (raw * BigInt(10_000 + FEE_BUFFER_BPS)) / 10_000n;
  } catch (err: any) {
    const fallback = process.env.WITNET_FEE_WEI
      ? BigInt(process.env.WITNET_FEE_WEI)
      : ethers.parseEther("0.015");
    console.warn(
      `[diceSweeper] estimateRandomizeFee failed (${err?.message}), ` +
        `using fallback ${ethers.formatEther(fallback)} CELO`
    );
    return fallback;
  }
}

// ── Round processing ──────────────────────────────────────────────────────────

async function processRound(
  roundId: bigint,
  tier: number,
  dice: ethers.Contract,
  witnetFee: bigint
): Promise<RoundResult> {
  const base: Omit<RoundResult, "action"> = {
    roundId: roundId.toString(),
    tier,
    filledSlots: 0,
    randomBlock: "0",
    state: "Unknown",
  };

  try {
    const [, filledSlots, winnerSelected, , randomBlock] =
      (await dice.getRoundInfo(roundId)) as [
        bigint,
        number,
        boolean,
        number,
        bigint,
        string,
      ];

    base.filledSlots = Number(filledSlots);
    base.randomBlock = randomBlock.toString();

    if (winnerSelected) {
      base.state = stateName(RoundState.Resolved);
      return { ...base, action: "skip-already-resolved" };
    }

    if (base.filledSlots === 0) {
      base.state = stateName(RoundState.Open);
      return { ...base, action: "skip-no-players" };
    }

    const stateNum = Number(
      (await dice.getRoundState(roundId)) as bigint
    ) as RoundStateValue;
    base.state = stateName(stateNum);

    // ── Request randomness ────────────────────────────────────────────────────
    // Triggered for any round with players that hasn't had randomness requested
    // yet, regardless of whether it is full.  This means partial rounds that
    // are unlikely to fill can still get randomness requested early (the
    // contract enforces fullness on draw, not on randomize).
    if (randomBlock === 0n && stateNum !== RoundState.Resolved) {
      try {
        const tx = await dice.requestRoundRandomness(roundId, {
          value: witnetFee,
        });
        const receipt = await tx.wait();
        return {
          ...base,
          action: "requested-randomness",
          txHash: receipt?.hash ?? tx.hash,
        };
      } catch (err: any) {
        const msg: string = err?.message ?? "";
        if (
          msg.includes("already requested") ||
          msg.includes("randomness requested")
        ) {
          return { ...base, action: "skip-randomness-pending" };
        }
        throw err;
      }
    }

    // ── Draw ──────────────────────────────────────────────────────────────────
    if (stateNum === RoundState.Ready) {
      try {
        const tx = await dice.drawRound(roundId);
        const receipt = await tx.wait();
        return {
          ...base,
          action: "drew",
          txHash: receipt?.hash ?? tx.hash,
        };
      } catch (err: any) {
        const msg: string = err?.message ?? "";
        if (
          msg.includes("already resolved") ||
          msg.includes("randomness pending")
        ) {
          return { ...base, action: "skip-already-resolved" };
        }
        throw err;
      }
    }

    // Randomness has been requested but is not ready yet — nothing to do.
    return { ...base, action: "skip-randomness-pending" };
  } catch (err: any) {
    return {
      ...base,
      action: "error",
      error: err?.shortMessage ?? err?.message ?? String(err),
    };
  }
}

// ── Worker entry point ────────────────────────────────────────────────────────

export function startDiceSweeper(): void {
  if (!RELAYER_PK) {
    console.warn(
      "[diceSweeper] CELO_RELAYER_PK not configured — worker disabled"
    );
    return;
  }

  console.log(
    `[diceSweeper] Starting — tiers=[${ACTIVE_TIERS.join(",")}] ` +
      `interval=${SWEEP_INTERVAL_SECONDS}s address=${DICE_ADDRESS}`
  );

  // Run once immediately so rounds aren't blocked until the first cron tick.
  runDiceSweep().catch((err) =>
    console.error("[diceSweeper] initial sweep error:", err)
  );

  if (SWEEP_INTERVAL_SECONDS < 60) {
    setInterval(
      () =>
        runDiceSweep().catch((err) =>
          console.error("[diceSweeper] sweep error:", err)
        ),
      SWEEP_INTERVAL_SECONDS * 1000
    );
  } else {
    const minutes = Math.round(SWEEP_INTERVAL_SECONDS / 60);
    const cronExpr = `*/${minutes} * * * *`;
    cron.schedule(cronExpr, () => {
      runDiceSweep().catch((err) =>
        console.error("[diceSweeper] sweep error:", err)
      );
    });
    console.log(`[diceSweeper] Cron: "${cronExpr}"`);
  }
}
