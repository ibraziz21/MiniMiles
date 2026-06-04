// PATCH /api/Spend/orders/[id]
// Advances an order through the merchant fulfillment lifecycle.
// Protected by ADMIN_SECRET — for merchant/ops tooling only.
//
// Body: { status: "accepted" | "packed" | "out_for_delivery" | "delivered" | "cancelled" }
//
// Valid transitions:
//   placed          → accepted
//   accepted        → packed
//   packed          → out_for_delivery
//   out_for_delivery → delivered
//   any non-final   → cancelled

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const TIMESTAMP_FOR_STATUS: Record<string, string> = {
  accepted:        "accepted_at",
  packed:          "packed_at",
  out_for_delivery: "dispatched_at",
  delivered:       "delivered_at",
  cancelled:       "cancelled_at",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  placed:          ["accepted",        "cancelled"],
  accepted:        ["packed",          "cancelled"],
  packed:          ["out_for_delivery","cancelled"],
  out_for_delivery:["delivered",       "cancelled"],
};

// States that cannot be externally overridden (customer/system-owned)
const FINAL_STATES = new Set(["received", "completed", "cancelled"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing order id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const newStatus: string = body.status;

  if (!newStatus || !TIMESTAMP_FOR_STATUS[newStatus]) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${Object.keys(TIMESTAMP_FOR_STATUS).join(", ")}` },
      { status: 400 },
    );
  }

  // ── Fetch current order ───────────────────────────────────────────────────────
  const { data: order, error: fetchErr } = await supabase
    .from("merchant_transactions")
    .select("id, status")
    .eq("id", id)
    .single();

  if (fetchErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (FINAL_STATES.has(order.status)) {
    return NextResponse.json(
      { error: `Order is already in final state: ${order.status}` },
      { status: 409 },
    );
  }

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Cannot transition from '${order.status}' to '${newStatus}'` },
      { status: 409 },
    );
  }

  // ── Update ────────────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("merchant_transactions")
    .update({
      status: newStatus,
      [TIMESTAMP_FOR_STATUS[newStatus]]: now,
    })
    .eq("id", id);

  if (updateErr) {
    console.error("[orders/[id]] update failed", updateErr);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, status: newStatus });
}
