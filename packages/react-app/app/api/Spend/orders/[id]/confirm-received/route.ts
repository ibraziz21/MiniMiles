// POST /api/Spend/orders/[id]/confirm-received
// Customer confirms they received their order.
// Transitions "delivered" → "received", enqueues the +200 AkibaMiles reward,
// then marks the order "completed".
// Requires session auth — only the order owner can call this.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";
import { processOrderMilesReward } from "@/lib/orderMilesReward";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing order id" }, { status: 400 });

  // ── Fetch and authorise ───────────────────────────────────────────────────────
  const { data: order, error: fetchErr } = await supabase
    .from("merchant_transactions")
    .select("id, status, user_address, miles_reward_status")
    .eq("id", id)
    .single();

  if (fetchErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.user_address.toLowerCase() !== session.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.status !== "delivered") {
    return NextResponse.json(
      { error: `Order must be in 'delivered' state to confirm receipt (currently '${order.status}')` },
      { status: 409 },
    );
  }

  // ── Mark received ─────────────────────────────────────────────────────────────
  // advance_order_status is the only sanctioned way to change status (order-
  // lifecycle-completion-spec.md backbone) — a direct UPDATE is rejected by a
  // DB trigger.
  const { data: receivedRows, error: updateErr } = await supabase.rpc("advance_order_status", {
    p_order_id: id,
    p_to_status: "received",
    p_actor: "customer",
    p_meta: { source: "confirm-received" },
  });
  const receivedResult = (receivedRows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (updateErr || !receivedResult?.ok) {
    console.error("[confirm-received] status update failed", updateErr, receivedResult);
    return NextResponse.json(
      { error: receivedResult?.error_code ?? "Failed to update order" },
      { status: 500 },
    );
  }

  // ── Enqueue AkibaMiles reward ─────────────────────────────────────────────────
  let rewardEnqueued = false;
  try {
    await processOrderMilesReward(id);
    rewardEnqueued = true;
  } catch (rewardErr: any) {
    // Log for the retry worker — order stays "received" so the reward job
    // can pick it up. Do NOT advance to "completed" yet.
    console.error("[confirm-received] reward enqueue failed — order stays 'received' for retry", rewardErr?.message);
  }

  // ── Mark completed (only when reward was successfully enqueued) ───────────────
  if (rewardEnqueued) {
    const { data: completeRows, error: completeErr } = await supabase.rpc("advance_order_status", {
      p_order_id: id,
      p_to_status: "completed",
      p_actor: "system",
      p_meta: { source: "confirm-received" },
    });
    const completeResult = (completeRows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

    if (completeErr || !completeResult?.ok) {
      console.error("[confirm-received] failed to mark completed", completeErr, completeResult);
      // Reward is queued; return success so the customer isn't blocked.
      // The status update will be corrected by the reward worker on completion.
    }

    return NextResponse.json({ ok: true, id, status: "completed" });
  }

  // Reward enqueue failed — order is "received", reward will be retried
  return NextResponse.json({ ok: true, id, status: "received" });
}
