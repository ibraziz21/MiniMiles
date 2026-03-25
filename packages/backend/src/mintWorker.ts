// src/mintWorker.ts
import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

// ── Config ───────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS =
  process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";

const LOCK_NAME = "default";
const MAX_JOBS_PER_RUN = 100;
const MAX_JOB_ATTEMPTS = 6;

const MINT_ABI = [
  "function mint(address account, uint256 amount)",
];

// ── Wallet ────────────────────────────────────────────────────────────────────
function makeWallet() {
  const pk = process.env.RETRY_PK ?? process.env.PRIVATE_KEY;
  if (!pk) throw new Error("No RETRY_PK or PRIVATE_KEY set");
  const provider = new ethers.JsonRpcProvider("https://forno.celo.org");
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, MINT_ABI, wallet);
  console.log(`[mintWorker] Using wallet: ${wallet.address}`);
  return { wallet, contract };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isDupe(e: any) { return e?.code === "23505"; }

async function resetStalledJobs() {
  await Promise.all([
    supabase
      .from("minipoint_mint_jobs")
      .update({ status: "pending", attempts: 0, last_error: null })
      .eq("status", "failed"),
    supabase
      .from("minipoint_mint_jobs")
      .update({ status: "pending" })
      .eq("status", "processing"),
  ]);
  console.log("[mintWorker] Reset failed/stuck jobs to pending");
}

async function applyPayload(payload: any) {
  if (payload.kind === "daily_engagement") {
    const { error } = await supabase.from("daily_engagements").insert({
      user_address: payload.userAddress,
      quest_id: payload.questId,
      claimed_at: payload.claimedAt,
      points_awarded: payload.pointsAwarded,
    });
    if (error && !isDupe(error)) throw error;
    return;
  }

  if (payload.kind === "profile_milestone") {
    const field = payload.milestone === 50
      ? "profile_milestone_50_claimed"
      : "profile_milestone_100_claimed";
    const { error } = await supabase
      .from("users")
      .update({ [field]: true })
      .eq("user_address", payload.userAddress.toLowerCase());
    if (error) throw error;
    return;
  }

  // partner_engagement
  const { error } = await supabase.from("partner_engagements").insert({
    user_address: payload.userAddress,
    partner_quest_id: payload.questId,
    claimed_at: payload.claimedAt,
    points_awarded: payload.pointsAwarded,
  });
  if (error && !isDupe(error)) throw error;
}

// ── Main drain run ─────────────────────────────────────────────────────────────
let isRunning = false;

export async function runDrain() {
  if (isRunning) {
    console.log("[mintWorker] Already running, skipping");
    return;
  }
  isRunning = true;

  try {
    await resetStalledJobs();

    const { contract } = makeWallet();
    const owner = randomUUID();
    const leaseSeconds = Math.max(60, MAX_JOBS_PER_RUN * 10);

    const { data: acquired } = await supabase.rpc(
      "acquire_minipoint_mint_queue_lock",
      { p_lock_name: LOCK_NAME, p_owner: owner, p_lease_seconds: leaseSeconds }
    );

    if (!acquired) {
      console.log("[mintWorker] Lock busy, skipping this run");
      return;
    }

    let processed = 0;

    try {
      for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
        const { data } = await supabase.rpc("claim_next_minipoint_mint_job", {
          p_lock_name: LOCK_NAME,
          p_owner: owner,
        });

        const job = (Array.isArray(data) ? data[0] : data) as any | null;
        if (!job) break;

        console.log(`[mintWorker] Job ${job.id} → ${job.user_address} (${job.points} pts)`);

        try {
          const amount = ethers.parseUnits(String(job.points), 18);
          const tx = await contract.mint(job.user_address, amount);
          const receipt = await tx.wait();
          const txHash: string = receipt.hash ?? tx.hash;

          console.log(`[mintWorker] ✓ Minted job ${job.id} tx: ${txHash}`);

          await applyPayload(job.payload);

          await supabase.rpc("complete_minipoint_mint_job", {
            p_job_id: job.id,
            p_tx_hash: txHash,
          });

          processed++;
        } catch (err: any) {
          const msg = err?.shortMessage ?? err?.message ?? "error";
          console.error(`[mintWorker] ✗ Job ${job.id} failed: ${msg}`);

          if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
            await supabase.rpc("fail_minipoint_mint_job", { p_job_id: job.id, p_error: msg });
          } else {
            const delay = Math.min(30, 2 ** Math.max(1, job.attempts ?? 1));
            await supabase.rpc("retry_minipoint_mint_job", {
              p_job_id: job.id,
              p_error: msg,
              p_delay_seconds: delay,
            });
          }
        }
      }
    } finally {
      await supabase.rpc("release_minipoint_mint_queue_lock", {
        p_lock_name: LOCK_NAME,
        p_owner: owner,
      });
    }

    console.log(`[mintWorker] Run complete — processed ${processed} jobs`);
  } catch (err: any) {
    console.error("[mintWorker] Fatal error:", err?.message);
  } finally {
    isRunning = false;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
export function startMintWorker() {
  console.log("[mintWorker] Starting — runs every 5 minutes");
  runDrain().catch(console.error);
  cron.schedule("*/5 * * * *", () => {
    runDrain().catch(console.error);
  });
}
