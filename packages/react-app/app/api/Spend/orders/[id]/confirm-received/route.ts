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
  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("merchant_transactions")
    .update({ status: "received", received_at: now })
    .eq("id", id);

  if (updateErr) {
    console.error("[confirm-received] status update failed", updateErr);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }

  // ── Enqueue AkibaMiles reward ─────────────────────────────────────────────────
  try {
    await processOrderMilesReward(id);
  } catch (rewardErr: any) {
    // Reward failure is non-fatal — order is already confirmed received.
    // The reward worker / admin can retry via /orders/rewards/process.
    console.error("[confirm-received] reward enqueue failed", rewardErr?.message);
  }

  // ── Mark completed ────────────────────────────────────────────────────────────
  await supabase
    .from("merchant_transactions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, id, status: "completed" });
}
