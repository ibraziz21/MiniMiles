/**
 * lib/server/clawAssign.ts
 *
 * SERVER-ONLY — never import from client components or pages.
 *
 * Shared logic for:
 *   1. Assigning a batch play slot to a session (idempotent)
 *   2. Loading the proof material for a session
 *   3. Full settle flow: commitOutcome → claimReward
 *
 * Both /api/claw/settle and /api/claw/rotate import from here.
 * No outcome material is stored in or read from Supabase —
 * Supabase only tracks (session_id, batch_id, play_index, commit_status).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { supabase } from "@/lib/supabaseClient";
import batchRngAbi from "@/contexts/merkleBatchRng.json";
import clawAbi from "@/contexts/akibaClawGame.json";
import { getBatchPlayOutcomeAsync } from "./clawBatchStore";

const CLAW_GAME = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;
const BATCH_RNG = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
  "0x249Ce901411809a8A0fECa6102D9F439bbf3751e") as `0x${string}`;
const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RAW_RELAYER_PK = process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "";
const RELAYER_PK = (RAW_RELAYER_PK.startsWith("0x")
  ? RAW_RELAYER_PK
  : `0x${RAW_RELAYER_PK}`) as `0x${string}`;

// ── Shared viem clients ────────────────────────────────────────────────────

export function getClients() {
  const transport = http(RPC_URL);
  const account = privateKeyToAccount(RELAYER_PK);
  const pub = createPublicClient({ chain: celo, transport });
  const wal = createWalletClient({ chain: celo, transport, account });
  return { pub, wal, account };
}

// ── Audit logger ──────────────────────────────────────────────────────────

export async function logSettle(
  sessionId: string,
  stage: string,
  detail: string,
  ok: boolean
) {
  await supabase
    .from("claw_settle_logs")
    .insert({ session_id: sessionId, stage, detail, success: ok, created_at: new Date().toISOString() })
    .then(() => {});
}

// ── Types ─────────────────────────────────────────────────────────────────

export type AssignResult =
  | { ok: true; batchId: string; playIndex: number }
  | { ok: false; reason: "no_active_batch" | "batch_full" | "db_error" | "already_assigned" };

export type SettleResult =
  | { ok: true; rewardClass: number; rewardAmount: string; voucherId: string; txHash?: string; alreadyClaimed?: boolean }
  | { ok: false; retryable: boolean; reason: string };

// ── Assignment ────────────────────────────────────────────────────────────

/**
 * Idempotently loads the play slot that MerkleBatchRng assigned on-chain
 * during startGame(), then mirrors it to Supabase for audit/retry visibility.
 *
 * - If the session already has a row in claw_batch_plays, returns it (idempotent).
 * - If the session was never registered by the RNG, returns { ok: false, reason: "no_active_batch" }.
 * - Only stores (session_id, batch_id, play_index) in Supabase — no outcome data.
 */
export async function assignBatchPlay(
  sessionId: string,
  pub: ReturnType<typeof getClients>["pub"]
): Promise<AssignResult> {
  let batchId: string;
  let playIndex: number;
  try {
    const sessionPlay = (await pub.readContract({
      address: BATCH_RNG,
      abi: batchRngAbi,
      functionName: "getSessionPlay",
      args: [BigInt(sessionId)],
    })) as any;

    batchId = (sessionPlay.batchId ?? sessionPlay[0]).toString();
    playIndex = Number(sessionPlay.playIndex ?? sessionPlay[1]);
  } catch (e: any) {
    return { ok: false, reason: "db_error" };
  }

  if (batchId === "0") {
    return { ok: false, reason: "no_active_batch" };
  }

  // Fast path: already tracked locally. Chain remains the source of truth.
  const { data: existing } = await supabase
    .from("claw_batch_plays")
    .select("batch_id, play_index")
    .eq("session_id", sessionId)
    .single();

  if (existing) {
    if (existing.batch_id !== batchId || Number(existing.play_index) !== playIndex) {
      await supabase
        .from("claw_batch_plays")
        .update({ batch_id: batchId, play_index: playIndex })
        .eq("session_id", sessionId);
    }
    return { ok: true, batchId, playIndex };
  }

  // Track the on-chain assignment locally for audit/retry visibility only.
  const { error: insertErr } = await supabase.from("claw_batch_plays").insert({
    session_id: sessionId,
    batch_id: batchId,
    play_index: playIndex,
    commit_status: "pending",
    created_at: new Date().toISOString(),
  });

  if (insertErr) {
    // Could be a race where another request inserted first — re-read
    const { data: retry } = await supabase
      .from("claw_batch_plays")
      .select("batch_id, play_index")
      .eq("session_id", sessionId)
      .single();

    if (retry) {
      return { ok: true, batchId: retry.batch_id, playIndex: Number(retry.play_index) };
    }
    return { ok: false, reason: "db_error" };
  }

  return { ok: true, batchId, playIndex };
}

// ── Settle ────────────────────────────────────────────────────────────────

/**
 * Full settle flow for one session:
 *   1. Ensure assignment exists (creates if missing)
 *   2. Load outcome from server-only batch store (never Supabase)
 *   3. commitOutcome on MerkleBatchRng (idempotent via getSessionPlay check)
 *   4. claimReward on AkibaClawGame
 *   5. Update commit_status in Supabase
 *
 * Returns a SettleResult. Retryable errors (batch store not ready, RPC blip)
 * get retryable:true so the rotate cron or the frontend can retry safely.
 */
export async function settleSession(
  sessionId: bigint,
  pub: ReturnType<typeof getClients>["pub"],
  wal: ReturnType<typeof getClients>["wal"],
  account: ReturnType<typeof getClients>["account"]
): Promise<SettleResult> {
  const sessionIdStr = sessionId.toString();

  // ── Step 1: Ensure assignment ──────────────────────────────────────────
  const assignment = await assignBatchPlay(sessionIdStr, pub);

  if (!assignment.ok) {
    const retryable = assignment.reason === "no_active_batch" || assignment.reason === "db_error";
    const reason = `Assignment failed: ${assignment.reason}`;
    await logSettle(sessionIdStr, "assign", reason, false);
    return { ok: false, retryable, reason };
  }

  const { batchId, playIndex } = assignment;
  await logSettle(sessionIdStr, "assign", `batch=${batchId} idx=${playIndex}`, true);

  // ── Step 2: Load outcome from server-only batch store ─────────────────
  const outcome = await getBatchPlayOutcomeAsync(batchId, playIndex);

  if (!outcome) {
    // Batch store not configured or play index not found.
    // This is retryable — the batch builder may not have written the manifest yet.
    const reason = `Batch outcome not available: batch=${batchId} idx=${playIndex}`;
    await logSettle(sessionIdStr, "load_outcome", reason, false);
    return { ok: false, retryable: true, reason };
  }

  await logSettle(
    sessionIdStr,
    "load_outcome",
    `class=${outcome.rewardClass} proofLen=${outcome.proof.length}`,
    true
  );

  // ── Step 3: commitOutcome (idempotent) ────────────────────────────────
  try {
    const existing = (await pub.readContract({
      address: BATCH_RNG,
      abi: batchRngAbi,
      functionName: "getSessionPlay",
      args: [sessionId],
    })) as any;

    const committedClass = Number(existing.committedClass ?? existing[2]);
    if (committedClass !== 0) {
      await logSettle(sessionIdStr, "commit_outcome", "already committed on-chain", true);
    } else {
      const proof = outcome.proof as `0x${string}`[];
      const commitHash = await wal.writeContract({
        address: BATCH_RNG,
        abi: batchRngAbi,
        functionName: "commitOutcome",
        args: [sessionId, outcome.rewardClass, proof],
        account,
        chain: celo,
      });
      await pub.waitForTransactionReceipt({ hash: commitHash, confirmations: 1, timeout: 60_000 });
      await logSettle(sessionIdStr, "commit_outcome", commitHash, true);

      // Update Supabase status
      await supabase
        .from("claw_batch_plays")
        .update({ commit_status: "committed" })
        .eq("session_id", sessionIdStr);
    }
  } catch (err: any) {
    await logSettle(sessionIdStr, "commit_outcome", err?.message ?? String(err), false);
    return { ok: false, retryable: true, reason: `commitOutcome failed: ${err?.message}` };
  }

  // ── Step 3.5: settleGame explicitly ───────────────────────────────────
  // MerkleBatchRng attempts to auto-settle after commitOutcome, but that is
  // best-effort and can fail without reverting the commit. The relayer should
  // always make the game settlement idempotently explicit before claimReward.
  try {
    const session = (await pub.readContract({
      address: CLAW_GAME,
      abi: clawAbi.abi,
      functionName: "getSession",
      args: [sessionId],
    })) as any;

    if (Number(session.status) === 1) {
      const settleHash = await wal.writeContract({
        address: CLAW_GAME,
        abi: clawAbi.abi,
        functionName: "settleGame",
        args: [sessionId],
        account,
        chain: celo,
      });
      await pub.waitForTransactionReceipt({ hash: settleHash, confirmations: 1, timeout: 60_000 });
      await logSettle(sessionIdStr, "settle_game", settleHash, true);
    } else {
      await logSettle(sessionIdStr, "settle_game", `already status=${Number(session.status)}`, true);
    }
  } catch (err: any) {
    await logSettle(sessionIdStr, "settle_game", err?.message ?? String(err), false);
    return { ok: false, retryable: true, reason: `settleGame failed: ${err?.message}` };
  }

  // ── Step 4: claimReward ───────────────────────────────────────────────
  try {
    const session = (await pub.readContract({
      address: CLAW_GAME,
      abi: clawAbi.abi,
      functionName: "getSession",
      args: [sessionId],
    })) as any;

    // status >= 3 means Claimed or Burned
    if (Number(session.status) >= 3) {
      await logSettle(sessionIdStr, "claim_reward", "already claimed", true);
      await supabase
        .from("claw_batch_plays")
        .update({ commit_status: "claimed", settled_at: new Date().toISOString() })
        .eq("session_id", sessionIdStr);

      return {
        ok: true,
        alreadyClaimed: true,
        rewardClass: Number(session.rewardClass),
        rewardAmount: session.rewardAmount.toString(),
        voucherId: session.voucherId.toString(),
      };
    }

    const claimHash = await wal.writeContract({
      address: CLAW_GAME,
      abi: clawAbi.abi,
      functionName: "claimReward",
      args: [sessionId],
      account,
      chain: celo,
    });
    await pub.waitForTransactionReceipt({ hash: claimHash, confirmations: 1, timeout: 90_000 });
    await logSettle(sessionIdStr, "claim_reward", claimHash, true);

    // Update Supabase status
    await supabase
      .from("claw_batch_plays")
      .update({ commit_status: "claimed", settled_at: new Date().toISOString() })
      .eq("session_id", sessionIdStr);

    const finalSession = (await pub.readContract({
      address: CLAW_GAME,
      abi: clawAbi.abi,
      functionName: "getSession",
      args: [sessionId],
    })) as any;

    return {
      ok: true,
      txHash: claimHash,
      rewardClass: Number(finalSession.rewardClass),
      rewardAmount: finalSession.rewardAmount.toString(),
      voucherId: finalSession.voucherId.toString(),
    };
  } catch (err: any) {
    await logSettle(sessionIdStr, "claim_reward", err?.message ?? String(err), false);
    return { ok: false, retryable: true, reason: `claimReward failed: ${err?.message}` };
  }
}
