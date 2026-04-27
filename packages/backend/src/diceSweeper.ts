// src/diceSweeper.ts
//
// Periodically reconciles active AkibaDice rounds so that:
//   - randomness is requested as soon as a round has any players and no randomBlock
//   - rounds in "Ready" state are drawn immediately
//
// The sweeper persists unresolved rounds in Supabase so Railway restarts do not
// lose tracked backlog. A small tier watch-state table is also used so the
// worker can detect when an active round pointer advances before the prior round
// was resolved.

import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

// ── Config ────────────────────────────────────────────────────────────────────

const DICE_ADDRESS =
  process.env.DICE_ADDRESS ?? "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const WITNET_RNG_ADDRESS = "0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const RELAYER_PK = process.env.CELO_RELAYER_PK ?? "";

const SWEEP_INTERVAL_SECONDS = Number(
  process.env.DICE_SWEEP_INTERVAL_SECONDS ?? "60"
);

const DEFAULT_TIERS = [10, 20, 30, 250, 500, 1000];
const ACTIVE_TIERS: number[] = process.env.DICE_TIERS
  ? process.env.DICE_TIERS.split(",").map((t) => Number(t.trim()))
  : DEFAULT_TIERS;

const FEE_BUFFER_BPS = Number(process.env.DICE_FEE_BUFFER_BPS ?? "0"); // no buffer — Witnet rejects excess
const UNRESOLVED_RETRY_INTERVAL_SECONDS = Number(
  process.env.DICE_UNRESOLVED_RETRY_INTERVAL_SECONDS ?? "300"
);
const UNRESOLVED_TABLE = "dice_unresolved_rounds";
const TIER_STATE_TABLE = "dice_tier_watch_state";

// ── ABIs ──────────────────────────────────────────────────────────────────────

const DICE_ABI = [
  "function getActiveRoundId(uint256 tier) external view returns (uint256)",
  "function getRoundInfo(uint256 roundId) external view returns (uint256 tier, uint8 filledSlots, bool winnerSelected, uint8 winningNumber, uint256 randomBlock, address winner)",
  "function getRoundState(uint256 roundId) external view returns (uint8)",
  "function rngClone() external view returns (address)",
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

// ── Persisted unresolved-round registry ───────────────────────────────────────

interface UnresolvedRoundEntry {
  roundId: string;
  tier: number;
  reason: "advanced-before-resolved";
  firstSeenAt: string;
  lastCheckedAt: string;
  filledSlots: number;
  randomBlock: string;
  state: string;
  lastAction: string;
  lastError?: string;
}

interface TierWatchStateRow {
  tier: number;
  active_round_id: string;
}

interface UnresolvedRoundRow {
  round_id: string;
  tier: number;
  first_seen_at: string;
  last_seen_at: string;
  last_retry_at: string | null;
  retry_count: number;
  random_block: string;
  filled_slots: number;
  round_state: string;
  active: boolean;
  source: string;
  last_error: string | null;
  last_action: string | null;
}

function rowToEntry(row: UnresolvedRoundRow): UnresolvedRoundEntry {
  return {
    roundId: String(row.round_id),
    tier: Number(row.tier),
    reason: "advanced-before-resolved",
    firstSeenAt: row.first_seen_at,
    lastCheckedAt: row.last_seen_at,
    filledSlots: Number(row.filled_slots),
    randomBlock: String(row.random_block),
    state: String(row.round_state),
    lastAction: row.last_action ?? "tracked",
    lastError: row.last_error ?? undefined,
  };
}

async function loadTierWatchState(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from(TIER_STATE_TABLE)
    .select("tier, active_round_id");

  if (error) {
    console.warn("[diceSweeper] failed loading tier watch state:", error.message);
    return {};
  }

  return ((data ?? []) as TierWatchStateRow[]).reduce<Record<string, string>>(
    (acc, row) => {
      acc[String(row.tier)] = String(row.active_round_id);
      return acc;
    },
    {}
  );
}

async function setTierWatchState(tier: number, activeRoundId: string): Promise<void> {
  const { error } = await supabase.from(TIER_STATE_TABLE).upsert(
    {
      tier,
      active_round_id: activeRoundId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tier" }
  );

  if (error) {
    console.warn(
      `[diceSweeper] failed saving tier watch state tier=${tier} round=${activeRoundId}: ${error.message}`
    );
  }
}

async function upsertUnresolvedRound(entry: UnresolvedRoundEntry): Promise<void> {
  const { error } = await supabase.from(UNRESOLVED_TABLE).upsert(
    {
      round_id: entry.roundId,
      tier: entry.tier,
      first_seen_at: entry.firstSeenAt,
      last_seen_at: entry.lastCheckedAt,
      random_block: entry.randomBlock,
      filled_slots: entry.filledSlots,
      round_state: entry.state,
      active: true,
      source: entry.reason,
      last_error: entry.lastError ?? null,
      last_action: entry.lastAction,
    },
    { onConflict: "round_id" }
  );

  if (error) {
    console.warn(
      `[diceSweeper] failed upserting unresolved round=${entry.roundId}: ${error.message}`
    );
  }
}

async function markResolvedRound(roundId: string): Promise<void> {
  const { error } = await supabase
    .from(UNRESOLVED_TABLE)
    .update({
      active: false,
      last_seen_at: new Date().toISOString(),
      last_error: null,
      last_action: "resolved",
    })
    .eq("round_id", roundId)
    .eq("active", true);

  if (error) {
    console.warn(
      `[diceSweeper] failed marking unresolved round=${roundId} resolved: ${error.message}`
    );
  }
}

async function loadActiveUnresolvedRounds(): Promise<UnresolvedRoundEntry[]> {
  const { data, error } = await supabase
    .from(UNRESOLVED_TABLE)
    .select(
      "round_id, tier, first_seen_at, last_seen_at, last_retry_at, retry_count, random_block, filled_slots, round_state, active, source, last_error, last_action"
    )
    .eq("active", true)
    .order("first_seen_at", { ascending: true });

  if (error) {
    console.warn("[diceSweeper] failed loading unresolved rounds:", error.message);
    return [];
  }

  return ((data ?? []) as UnresolvedRoundRow[]).map(rowToEntry);
}

async function incrementRetry(
  roundId: string,
  lastError: string | null,
  lastAction: string
): Promise<void> {
  const { data, error } = await supabase
    .from(UNRESOLVED_TABLE)
    .select("retry_count")
    .eq("round_id", roundId)
    .maybeSingle();

  if (error) {
    console.warn(
      `[diceSweeper] failed reading retry count for round=${roundId}: ${error.message}`
    );
    return;
  }

  const retryCount = Number((data as { retry_count?: number } | null)?.retry_count ?? 0) + 1;
  const { error: updateError } = await supabase
    .from(UNRESOLVED_TABLE)
    .update({
      last_retry_at: new Date().toISOString(),
      retry_count: retryCount,
      last_seen_at: new Date().toISOString(),
      last_error: lastError,
      last_action: lastAction,
    })
    .eq("round_id", roundId);

  if (updateError) {
    console.warn(
      `[diceSweeper] failed marking retry for round=${roundId}: ${updateError.message}`
    );
  }
}

async function updateTrackedRound(entry: UnresolvedRoundEntry): Promise<void> {
  const { error } = await supabase
    .from(UNRESOLVED_TABLE)
    .update({
      last_seen_at: entry.lastCheckedAt,
      random_block: entry.randomBlock,
      filled_slots: entry.filledSlots,
      round_state: entry.state,
      last_error: entry.lastError ?? null,
      last_action: entry.lastAction,
    })
    .eq("round_id", entry.roundId)
    .eq("active", true);

  if (error) {
    console.warn(
      `[diceSweeper] failed updating tracked round=${entry.roundId}: ${error.message}`
    );
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
  const rng = await getWitnetFeeOracle(dice, provider);
  const tierWatchState = await loadTierWatchState();

  // Log oracle mode so it's visible in every sweep
  try {
    const clone = String(await dice.rngClone());
    if (clone && clone !== ZERO_ADDRESS) {
      console.log(`[diceSweeper] Oracle mode: Witnet V3 passive (rngClone=${clone})`);
    } else {
      console.log(`[diceSweeper] Oracle mode: legacy V2 (rngClone not set)`);
    }
  } catch {
    console.log(`[diceSweeper] Oracle mode: legacy V2 (rngClone() unavailable)`);
  }

  const witnetFee = await estimateFee(provider, rng);
  const results: RoundResult[] = [];

  for (const tier of ACTIVE_TIERS) {
    const result = await processTier(tier, dice, witnetFee, tierWatchState);
    results.push(result);

    console.log(
      `[diceSweeper] round=${result.roundId} tier=${result.tier} ` +
        `slots=${result.filledSlots} randomBlock=${result.randomBlock} ` +
        `state=${result.state} action=${result.action}` +
        (result.txHash ? ` tx=${result.txHash}` : "") +
        (result.error ? ` error=${result.error}` : "")
    );
  }

  const unresolved = await loadActiveUnresolvedRounds();
  console.log(`[diceSweeper] Sweep done. Tracked unresolved=${unresolved.length}.`);
  return results;
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
    const fee = (raw * BigInt(10_000 + FEE_BUFFER_BPS)) / 10_000n;
    console.log(`[diceSweeper] Witnet fee estimated: ${ethers.formatEther(fee)} CELO (gasPrice=${ethers.formatUnits(gasPrice, "gwei")} gwei)`);
    return fee;
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

async function getWitnetFeeOracle(
  dice: ethers.Contract,
  provider: ethers.JsonRpcProvider
): Promise<ethers.Contract> {
  try {
    const clone = String(await dice.rngClone());
    if (clone && clone !== ZERO_ADDRESS) {
      console.log(`[diceSweeper] Estimating Witnet fee from rngClone=${clone}`);
      return new ethers.Contract(clone, WITNET_ABI, provider);
    }
  } catch (err: any) {
    console.warn(
      `[diceSweeper] rngClone() unavailable (${err?.shortMessage ?? err?.message ?? err}); using legacy RNG fee estimate`
    );
  }

  console.log(`[diceSweeper] Estimating Witnet fee from legacy RNG=${WITNET_RNG_ADDRESS}`);
  return new ethers.Contract(WITNET_RNG_ADDRESS, WITNET_ABI, provider);
}

// ── Tier + unresolved processing ──────────────────────────────────────────────

async function processTier(
  tier: number,
  dice: ethers.Contract,
  witnetFee: bigint,
  tierWatchState: Record<string, string>
): Promise<RoundResult> {
  const activeRoundId = (await dice.getActiveRoundId(BigInt(tier))) as bigint;
  if (activeRoundId === 0n) {
    return {
      roundId: "0",
      tier,
      filledSlots: 0,
      randomBlock: "0",
      state: "None",
      action: "skip-no-players",
    };
  }

  const activeRoundIdStr = activeRoundId.toString();
  const previousActiveRoundId = tierWatchState[String(tier)];

  if (previousActiveRoundId && previousActiveRoundId !== activeRoundIdStr) {
    try {
      const [, prevFilledSlots, prevWinnerSelected, , prevRandomBlock] =
        (await dice.getRoundInfo(BigInt(previousActiveRoundId))) as [
          bigint,
          number,
          boolean,
          number,
          bigint,
          string,
        ];

      if (!prevWinnerSelected) {
        const prevStateNum = Number(
          (await dice.getRoundState(BigInt(previousActiveRoundId))) as bigint
        ) as RoundStateValue;

        await upsertUnresolvedRound({
          roundId: previousActiveRoundId,
          tier,
          reason: "advanced-before-resolved",
          firstSeenAt: new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
          filledSlots: Number(prevFilledSlots),
          randomBlock: prevRandomBlock.toString(),
          state: stateName(prevStateNum),
          lastAction: "tracked",
        });
        console.warn(
          `[diceSweeper] tracked unresolved round=${previousActiveRoundId} tier=${tier} because active round advanced to ${activeRoundIdStr}`
        );
      } else {
        await markResolvedRound(previousActiveRoundId);
      }
    } catch (err: any) {
      console.warn(
        `[diceSweeper] failed checking prior active round tier=${tier} round=${previousActiveRoundId}: ${err?.message ?? err}`
      );
    }
  }

  tierWatchState[String(tier)] = activeRoundIdStr;
  await setTierWatchState(tier, activeRoundIdStr);
  await markResolvedRound(activeRoundIdStr);

  return processRound(activeRoundId, tier, dice, witnetFee);
}

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

    if (randomBlock === 0n && stateNum !== RoundState.Resolved) {
      try {
        console.log(
          `[diceSweeper] Requesting randomness — round=${roundId} tier=${tier} ` +
          `slots=${base.filledSlots} fee=${ethers.formatEther(witnetFee)} CELO oracle=clone`
        );
        const tx = await dice.requestRoundRandomness(roundId, {
          value: witnetFee,
        });
        const receipt = await tx.wait();
        console.log(
          `[diceSweeper] Randomness requested — round=${roundId} randomBlock will be set tx=${receipt?.hash ?? tx.hash}`
        );
        return {
          ...base,
          action: "requested-randomness",
          txHash: receipt?.hash ?? tx.hash,
        };
      } catch (err: any) {
        const msg: string = err?.message ?? "";
        if (
          msg.includes("already requested") ||
          msg.includes("randomness requested") ||
          msg.includes("randomize block busy")
        ) {
          console.log(`[diceSweeper] Randomness already requested for round=${roundId}, skipping`);
          return { ...base, action: "skip-randomness-pending" };
        }
        throw err;
      }
    }

    if (stateNum === RoundState.Ready) {
      // Round is Ready but not yet resolved — Witnet push may have failed or
      // this is a legacy round. Call drawRound manually as fallback.
      console.log(
        `[diceSweeper] Drawing round — round=${roundId} tier=${tier} ` +
        `randomBlock=${base.randomBlock} (manual fallback — push may have resolved already)`
      );
      try {
        const tx = await dice.drawRound(roundId);
        const receipt = await tx.wait();
        console.log(`[diceSweeper] Round drawn — round=${roundId} tx=${receipt?.hash ?? tx.hash}`);
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
          console.log(`[diceSweeper] round=${roundId} already resolved (push callback beat us)`);
          return { ...base, action: "skip-already-resolved" };
        }
        throw err;
      }
    }

    return { ...base, action: "skip-randomness-pending" };
  } catch (err: any) {
    return {
      ...base,
      action: "error",
      error: err?.shortMessage ?? err?.message ?? String(err),
    };
  }
}

export async function retryTrackedUnresolvedRounds(): Promise<UnresolvedRoundEntry[]> {
  if (!RELAYER_PK) {
    console.warn("[diceSweeper] CELO_RELAYER_PK not set — unresolved retry skipped");
    return [];
  }

  const unresolvedRounds = await loadActiveUnresolvedRounds();
  if (unresolvedRounds.length === 0) {
    return [];
  }

  const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
  const wallet = new ethers.Wallet(RELAYER_PK, provider);
  const dice = new ethers.Contract(DICE_ADDRESS, DICE_ABI, wallet);
  const rng = await getWitnetFeeOracle(dice, provider);
  const witnetFee = await estimateFee(provider, rng);

  for (const entry of unresolvedRounds) {
    try {
      const result = await processRound(
        BigInt(entry.roundId),
        entry.tier,
        dice,
        witnetFee
      );

      if (
        result.action === "drew" ||
        (result.action === "skip-already-resolved" && result.state === stateName(RoundState.Resolved))
      ) {
        await incrementRetry(entry.roundId, null, result.action);
        await markResolvedRound(entry.roundId);
        continue;
      }

      const updated: UnresolvedRoundEntry = {
        ...entry,
        lastCheckedAt: new Date().toISOString(),
        filledSlots: result.filledSlots,
        randomBlock: result.randomBlock,
        state: result.state,
        lastAction: result.action === "skip-no-players" ? "checked" : result.action,
        lastError: result.error,
      };

      await incrementRetry(
        entry.roundId,
        updated.lastError ?? null,
        updated.lastAction
      );

      if (updated.lastAction === "requested-randomness" || updated.lastAction === "drew") {
        console.log(
          `[diceSweeper] retried unresolved round=${entry.roundId} action=${updated.lastAction}`
        );
      } else if (updated.lastAction === "error") {
        console.warn(
          `[diceSweeper] unresolved retry failed round=${entry.roundId}: ${updated.lastError}`
        );
      }

      await updateTrackedRound(updated);
    } catch (err: any) {
      const lastError = err?.shortMessage ?? err?.message ?? String(err);
      await incrementRetry(entry.roundId, lastError, "error");
      await updateTrackedRound({
        ...entry,
        lastCheckedAt: new Date().toISOString(),
        lastAction: "error",
        lastError,
      });
    }
  }

  return loadActiveUnresolvedRounds();
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
      `interval=${SWEEP_INTERVAL_SECONDS}s address=${DICE_ADDRESS} unresolvedTable=${UNRESOLVED_TABLE}`
  );

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

  const retryMinutes = Math.max(
    1,
    Math.round(UNRESOLVED_RETRY_INTERVAL_SECONDS / 60)
  );
  const retryCronExpr = `*/${retryMinutes} * * * *`;
  cron.schedule(retryCronExpr, () => {
    retryTrackedUnresolvedRounds().catch((err) =>
      console.error("[diceSweeper] unresolved retry error:", err)
    );
  });
  console.log(`[diceSweeper] Unresolved retry cron: "${retryCronExpr}"`);
}
