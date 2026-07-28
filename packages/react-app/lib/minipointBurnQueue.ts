// Async Miles burn queue — sibling of lib/minipointQueue.ts (the mint-side
// equivalent), but every enqueue goes through reserve_miles_burn() first
// (sql/minipoint_burn_queue.sql), which atomically checks spendable balance
// (on-chain balance minus everything already reserved) before the job row
// is ever inserted. The inserted row IS the reservation — see that file's
// header comment for why this closes the double-spend window an async
// burn would otherwise open.
import { supabase } from "@/lib/supabaseClient";
import { getOnchainMilesBalance } from "@/lib/minipoints";

export type BurnJobPayload =
  | { kind: "voucher_issue"; voucher_id: string }
  | { kind: "passport_burn" };

export type EnqueueBurnResult =
  | { ok: true; jobId: string; alreadyExisted: boolean }
  | { ok: false; code: "insufficient_balance"; error: string }
  | { ok: false; code: "error"; error: string };

/**
 * Reserves a burn atomically against the user's spendable balance and
 * enqueues it for burnWorker (packages/backend) to execute. Idempotent on
 * idempotencyKey — calling twice with the same key returns the same job,
 * never double-reserves or double-burns.
 */
export async function enqueueMilesBurn(opts: {
  userAddress: `0x${string}`;
  points: number;
  reason: string;
  idempotencyKey: string;
  payload: BurnJobPayload;
}): Promise<EnqueueBurnResult> {
  const { userAddress, points, reason, idempotencyKey, payload } = opts;
  const addr = userAddress.toLowerCase() as `0x${string}`;

  const onchainBalance = await getOnchainMilesBalance(addr);

  const { data, error } = await supabase.rpc("reserve_miles_burn", {
    p_user_address: addr,
    p_points: points,
    p_onchain_balance: onchainBalance,
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
    p_payload: payload,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("INSUFFICIENT_BALANCE")) {
      return { ok: false, code: "insufficient_balance", error: "Not enough Miles available" };
    }
    console.error("[minipointBurnQueue] reserve_miles_burn failed", error);
    return { ok: false, code: "error", error: "Failed to reserve Miles burn" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, code: "error", error: "Reservation returned no row" };
  }

  return { ok: true, jobId: row.job_id as string, alreadyExisted: row.already_existed as boolean };
}
