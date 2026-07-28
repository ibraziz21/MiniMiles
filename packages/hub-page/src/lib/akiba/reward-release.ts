/**
 * Reward release — the "release" half of accrue-then-release (order-
 * lifecycle-completion-spec.md §6). The reward is accrued as a durable
 * reward_jobs row atomically with order creation (place_hub_order_and_
 * redeem_voucher); advance_order_status marks it 'eligible' when the order
 * reaches 'completed'.
 *
 * This function is the synchronous fast path — called right after an order
 * completes, for immediate UX. It is NOT the source of durability: that's
 * the scheduled worker (api/internal/process-reward-jobs), which sweeps
 * every 'eligible' job on a timer regardless of whether this fast path ran
 * or succeeded. A Platform outage here just means the worker catches it on
 * its next pass, with backoff — the reward is never only-attempted-once.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPurchaseEvent } from "@/lib/akiba/purchase-events";
import type { PurchaseEventPayload, PurchaseEventResult } from "@/lib/akiba/purchase-events";
import { emitQuestActions } from "@/lib/akiba/quest-events";

// purchase_completed fires here, not at order creation (orders/route.ts only
// emits first_purchase/first_voucher_redeemed): a reward job is only marked
// 'eligible' once advance_order_status reaches 'completed', so gating the
// quest on a successful release of that same job means it can't fire for an
// order that's later cancelled/refunded before ever completing. Every order
// gets a reward_jobs row (the payload is built unconditionally in
// orders/route.ts), so this covers every hub-sourced order — and since a
// released job is no longer 'eligible', the scheduled worker
// (process-reward-jobs) can't double-claim it and double-emit.
export async function emitPurchaseCompletedQuest(payload: PurchaseEventPayload): Promise<void> {
  const meta = (payload.metadata ?? {}) as Record<string, unknown>;
  const hubUserId = meta.hubUserId;
  const orderId = meta.orderId;
  if (typeof hubUserId !== "string" || typeof orderId !== "string") {
    console.error("[reward-release] purchase payload missing hubUserId/orderId — skipping quest emit");
    return;
  }
  await emitQuestActions([
    {
      actionName: "purchase_completed",
      userId: hubUserId,
      walletAddress: typeof meta.walletAddress === "string" ? meta.walletAddress : null,
      idempotencyKey: `quest-purchase_completed-${orderId}`,
      metadata: { orderId, email: meta.hubUserEmail ?? null },
    },
  ]);
}

export async function releaseRewardJob(
  orderId: string
): Promise<PurchaseEventResult | null> {
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("reward_jobs")
    .select("id, payload, status")
    .eq("order_id", orderId)
    .maybeSingle();

  // Nothing to do: no reward was accrued, it's already released/voided, or
  // the completed-transition hasn't marked it eligible yet (shouldn't
  // happen when called right after that same transition, but a worker
  // could be mid-processing it — safe to just skip).
  if (!job || job.status !== "eligible") return null;

  const payload = job.payload as PurchaseEventPayload;
  const result = await sendPurchaseEvent(payload);

  const { error } = await admin.rpc("complete_reward_job", {
    p_job_id: job.id,
    p_ok: result.ok,
    p_error: result.ok ? null : (result.error ?? "unknown error"),
  });
  if (error) {
    console.error("[reward-release] complete_reward_job failed:", error.message);
  }

  if (result.ok) await emitPurchaseCompletedQuest(payload);

  return result;
}
