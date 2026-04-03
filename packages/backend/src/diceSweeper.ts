// src/diceSweeper.ts
//
// Periodically reconciles active AkibaDice rounds so that:
//   - randomness is requested as soon as a round has any players and no randomBlock
//   - rounds in "Ready" state are drawn immediately
//
// Designed to run inside the existing backend process alongside other workers.
// It is fully idempotent: contract-level reverts for "already requested" /
// "already resolved" are treated as non-fatal skips, not errors.

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

// Sweep interval in seconds. Defaults to 60 s (same cadence as mintWorker).
const SWEEP_INTERVAL_SECONDS = Number(
  process.env.DICE_SWEEP_INTERVAL_SECONDS ?? "60"
);

// Optional override: comma-separated list of tier IDs to scan.
// Default: all known tiers (Miles 10/20/30 + USD 250/500/1000).
const DEFAULT_TIERS = [10, 20, 30, 250, 500, 1000];
const ACTIVE_TIERS: number[] = process.env.DICE_TIERS
  ? process.env.DICE_TIERS.split(",").map((t) => Number(t.trim()))
  : DEFAULT_TIERS;

// Small percentage buffer added on top of the Witnet fee estimate so we don't
// land exactly on the minimum and risk rejection due to gas-price fluctuation.
const FEE_BUFFER_BPS = Number(process.env.DICE_FEE_BUFFER_BPS ?? "1000"); // 10 %

// ── ABIs (minimal — only functions this worker calls) ─────────────────────────

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

// ── Round state enum (mirrors AkibaDiceGame.RoundState) ──────────────────────

const RoundState = {
  None: 0,
  Open: 1,
  FullWaiting: 2,
  Ready: 3,
  Resolved: 4,
} as const;

type RoundStateValue = (typeof RoundState)[keyof typeof RoundState];

function stateName(s: RoundStateValue): string {
  return (
    Object.entries(RoundState).find(([, v]) => v === s)?.[0] ?? `Unknown(${s})`
  );
}

// ── Action result type ────────────────────────────────────────────────────────

type SweepAction =
  | "skip-no-round"
  | "skip-no-players"
  | "skip-already-resolved"
  | "skip-randomness-pending"
  | "requested-randomness"
  | "drew"
  | "error";

interface TierResult {
  tier: number;
  roundId: string;
  filledSlots: number;
  randomBlock: string;
  state: string;
  action: SweepAction;
  txHash?: string;
  error?: string;
}

// ── Core sweep logic ──────────────────────────────────────────────────────────

export async function runDiceSweep(): Promise<TierResult[]> {
  if (!RELAYER_PK) {
    console.warn("[diceSweeper] CELO_RELAYER_PK not set — sweep skipped");
    return [];
  }

  const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
  const wallet = new ethers.Wallet(RELAYER_PK, provider);
  const dice = new ethers.Contract(DICE_ADDRESS, DICE_ABI, wallet);
  const rng = new ethers.Contract(WITNET_RNG_ADDRESS, WITNET_ABI, provider);

  // Estimate the Witnet fee once per sweep (uses current gas price).
  let witnetFee: bigint;
  try {
    const feeInfo = await provider.getFeeData();
    const gasPrice = feeInfo.gasPrice ?? ethers.parseUnits("5", "gwei");
    const rawFee: bigint = await rng.estimateRandomizeFee(gasPrice);
    // Apply buffer: fee * (10000 + BPS) / 10000
    witnetFee = (rawFee * BigInt(10_000 + FEE_BUFFER_BPS)) / 10_000n;
  } catch (err: any) {
    // If fee estimation fails (e.g. RNG contract unreachable), fall back to
    // the env override or a conservative 0.015 CELO default.
    const fallback = process.env.WITNET_FEE_WEI
      ? BigInt(process.env.WITNET_FEE_WEI)
      : ethers.parseEther("0.015");
    console.warn(
      `[diceSweeper] estimateRandomizeFee failed (${err?.message}), using fallback ${ethers.formatEther(fallback)} CELO`
    );
    witnetFee = fallback;
  }

  const results: TierResult[] = [];

  for (const tier of ACTIVE_TIERS) {
    const result = await processTier(tier, dice, witnetFee);
    results.push(result);

    // Structured log per tier.
    console.log(
      `[diceSweeper] tier=${tier} round=${result.roundId} slots=${result.filledSlots} ` +
        `randomBlock=${result.randomBlock} state=${result.state} action=${result.action}` +
        (result.txHash ? ` tx=${result.txHash}` : "") +
        (result.error ? ` error=${result.error}` : "")
    );
  }

  return results;
}

async function processTier(
  tier: number,
  dice: ethers.Contract,
  witnetFee: bigint
): Promise<TierResult> {
  const base: Omit<TierResult, "action"> = {
    tier,
    roundId: "0",
    filledSlots: 0,
    randomBlock: "0",
    state: "None",
  };

  try {
    const roundId: bigint = await dice.getActiveRoundId(BigInt(tier));

    if (roundId === 0n) {
      return { ...base, action: "skip-no-round" };
    }

    base.roundId = roundId.toString();

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

    const rawState: bigint = await dice.getRoundState(roundId);
    const stateNum = Number(rawState) as RoundStateValue;
    base.state = stateName(stateNum);

    // ── Action: request randomness ────────────────────────────────────────────
    // Trigger as soon as any player has joined and randomBlock is not yet set.
    // This handles both partially-filled (Open) and full-but-waiting rounds.
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
        // Non-fatal: randomness was already requested by another process.
        if (
          msg.includes("already requested") ||
          msg.includes("randomness requested")
        ) {
          return { ...base, action: "skip-randomness-pending" };
        }
        throw err; // re-throw unexpected errors
      }
    }

    // ── Action: draw ─────────────────────────────────────────────────────────
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

    // ── FullWaiting with randomBlock set — nothing to do yet ─────────────────
    return { ...base, action: "skip-randomness-pending" };
  } catch (err: any) {
    return {
      ...base,
      action: "error",
      error: err?.shortMessage ?? err?.message ?? String(err),
    };
  }
}

// ── Worker entry point (called from index.ts) ─────────────────────────────────

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

  // Run once immediately on startup so rounds aren't blocked until the first
  // scheduled tick.
  runDiceSweep().catch((err) =>
    console.error("[diceSweeper] initial sweep error:", err)
  );

  // Schedule recurring sweeps.  node-cron only supports minute-granularity in
  // cron syntax, so for sub-minute intervals we use setInterval directly.
  if (SWEEP_INTERVAL_SECONDS < 60) {
    setInterval(
      () =>
        runDiceSweep().catch((err) =>
          console.error("[diceSweeper] sweep error:", err)
        ),
      SWEEP_INTERVAL_SECONDS * 1000
    );
  } else {
    // Round up to nearest minute for cron expression.
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
