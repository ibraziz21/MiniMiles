// src/vaultRewardScheduler.ts
// Daily AkibaMiles reward scheduler for Akiba Vaults.
//
// Formula: milesEarned = floor(balance_usdt × multiplier)
//   default multiplier = 1  (configurable via VAULT_REWARD_MULTIPLIER env)
//
// Idempotency: one vault_reward_snapshots row per calendar date (UTC).
// If a row already exists for today, the scheduler exits immediately.
//
// Run modes:
//   - Standalone:  `ts-node src/vaultRewardScheduler.ts`
//   - Imported:    call startVaultRewardScheduler() from index.ts
//     (cron fires daily at 00:05 UTC)

import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { supabase } from "./supabaseClient";

// ── Config ────────────────────────────────────────────────────────────────────

const MULTIPLIER = Number(process.env.VAULT_REWARD_MULTIPLIER ?? "1");
const MIN_BALANCE = Number(process.env.VAULT_REWARD_MIN_BALANCE ?? "1"); // skip dust positions

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function computeMiles(balanceUsdt: string, multiplier: number): number {
  // balance_usdt is a numeric string like "250.000000"
  const balance = parseFloat(balanceUsdt);
  return Math.floor(balance * multiplier);
}

async function isDone(date: string): Promise<boolean> {
  const { data } = await supabase
    .from("vault_reward_snapshots")
    .select("completed_at")
    .eq("snapshot_date", date)
    .maybeSingle();

  return !!(data?.completed_at);
}

async function claimVaultRewardJob(opts: {
  userAddress: string;
  snapshotDate: string;
  balanceUsdt: string;
  miles: number;
}): Promise<void> {
  const { userAddress, snapshotDate, balanceUsdt, miles } = opts;
  const userLc = userAddress.toLowerCase();
  const idempotencyKey = `vault-daily-reward:${snapshotDate}:${userLc}`;

  const { error } = await supabase
    .from("minipoint_mint_jobs")
    .insert({
      idempotency_key: idempotencyKey,
      user_address: userLc,
      points: miles,
      reason: `vault-daily-reward:${snapshotDate}`,
      status: "pending",
      payload: {
        kind: "vault_daily_reward",
        userAddress: userLc,
        snapshotDate,
        balanceUsdt,
        milesAwarded: miles,
      },
    });

  // 23505 = unique_violation — job already exists, safe to ignore
  if (error && error.code !== "23505") {
    throw error;
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────

async function runDailyRewards(): Promise<void> {
  const date = todayUTC();
  console.log(`[vaultScheduler] starting daily run for ${date}`);

  // Idempotency check
  if (await isDone(date)) {
    console.log(`[vaultScheduler] already completed for ${date} — skipping`);
    return;
  }

  // Reserve today's slot (pending) — prevents concurrent runs on multiple processes
  const { error: reserveError } = await supabase
    .from("vault_reward_snapshots")
    .insert({ snapshot_date: date })
    .select("snapshot_date");

  if (reserveError) {
    if (reserveError.code === "23505") {
      // Another process reserved the slot — double-check if it completed
      if (await isDone(date)) {
        console.log(`[vaultScheduler] concurrently completed for ${date} — skipping`);
        return;
      }
      // Slot reserved but not completed — proceed (may be a crashed prior run)
    } else {
      console.error("[vaultScheduler] reserve error", reserveError);
      return;
    }
  }

  // Load all non-zero vault positions
  const { data: positions, error: posError } = await supabase
    .from("vault_positions")
    .select("wallet_address, balance_usdt")
    .gt("balance_usdt", String(MIN_BALANCE - 1)); // >= MIN_BALANCE

  if (posError) {
    console.error("[vaultScheduler] positions read error", posError);
    return;
  }

  if (!positions || positions.length === 0) {
    console.log(`[vaultScheduler] no eligible positions for ${date}`);
    await supabase
      .from("vault_reward_snapshots")
      .update({ total_wallets: 0, total_miles_queued: 0, completed_at: new Date().toISOString() })
      .eq("snapshot_date", date);
    return;
  }

  let totalMiles = 0;
  let queued = 0;
  let errors = 0;

  for (const pos of positions) {
    const miles = computeMiles(pos.balance_usdt, MULTIPLIER);
    if (miles <= 0) continue;

    try {
      await claimVaultRewardJob({
        userAddress: pos.wallet_address,
        snapshotDate: date,
        balanceUsdt: pos.balance_usdt,
        miles,
      });
      totalMiles += miles;
      queued++;
    } catch (err) {
      errors++;
      console.error(
        `[vaultScheduler] failed to queue reward for ${pos.wallet_address}`,
        err
      );
    }
  }

  // Mark snapshot complete
  await supabase
    .from("vault_reward_snapshots")
    .update({
      total_wallets: queued,
      total_miles_queued: totalMiles,
      completed_at: new Date().toISOString(),
    })
    .eq("snapshot_date", date);

  console.log(
    `[vaultScheduler] done — ${queued} wallets, ${totalMiles} miles queued, ${errors} errors`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startVaultRewardScheduler(): void {
  console.log("[vaultScheduler] registered — fires daily at 00:05 UTC");

  // Fire at 00:05 UTC every day
  cron.schedule("5 0 * * *", () => {
    runDailyRewards().catch((err) =>
      console.error("[vaultScheduler] cron error", err)
    );
  });
}

// ── Standalone entry point ────────────────────────────────────────────────────

if (require.main === module) {
  runDailyRewards()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
