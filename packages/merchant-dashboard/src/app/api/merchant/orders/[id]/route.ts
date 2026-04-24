// GET  /api/merchant/orders/[id]  — fetch single order (partner-scoped)
// PATCH /api/merchant/orders/[id] — advance order status (partner-scoped)
//
// Replaces the ADMIN_SECRET flow for merchant-facing usage.
// Every mutation is written to merchant_audit_log.

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import type { MerchantActionStatus } from "@/types";
import { VALID_TRANSITIONS, FINAL_STATES } from "@/types";

// Dynamically import from react-app — avoids a hard package dependency while
// keeping cancellation logic in a single place.
// In a monorepo with shared packages this would be a direct import from @akiba/lib.
const REACT_APP_URL = process.env.REACT_APP_INTERNAL_URL;

async function triggerCancellationCompensation(orderId: string): Promise<void> {
  if (!REACT_APP_URL) {
    // Fallback: call the compensation logic via internal webhook if configured,
    // otherwise log for manual follow-up.
    console.warn("[orders/cancel] REACT_APP_INTERNAL_URL not set — cancellation compensation skipped for order", orderId);
    return;
  }
  try {
    await fetch(`${REACT_APP_URL}/api/internal/cancel-compensation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": process.env.INTERNAL_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify({ orderId }),
    });
  } catch (err) {
    console.error("[orders/cancel] compensation webhook failed", orderId, err);
  }
}

const TIMESTAMP_FOR_STATUS: Record<string, string> = {
  accepted: "accepted_at",
  packed: "packed_at",
  out_for_delivery: "dispatched_at",
  delivered: "delivered_at",
  cancelled: "cancelled_at",
};

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data, error } = await supabase
    .from("merchant_transactions")
    .select("*")
    .eq("id", id)
    .eq("partner_id", session.partnerId) // ← enforces merchant isolation
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ order: data });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newStatus = body.status as MerchantActionStatus | undefined;

  if (!newStatus || !TIMESTAMP_FOR_STATUS[newStatus]) {
    return NextResponse.json(
      {
        error: `Invalid status. Allowed: ${Object.keys(TIMESTAMP_FOR_STATUS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Fetch current order — enforce partner_id isolation
  const { data: order, error: fetchErr } = await supabase
    .from("merchant_transactions")
    .select("id, status, partner_id")
    .eq("id", id)
    .eq("partner_id", session.partnerId) // ← merchant cannot touch another merchant's orders
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

  const now = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("merchant_transactions")
    .update({
      status: newStatus,
      [TIMESTAMP_FOR_STATUS[newStatus]]: now,
    })
    .eq("id", id)
    .eq("partner_id", session.partnerId); // double-check on write

  if (updateErr) {
    console.error("[orders/[id]] update failed:", updateErr);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }

  // Write audit log — fire and forget
  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: `order.${newStatus}`,
    orderId: id,
    metadata: { previous_status: order.status, new_status: newStatus },
  });

  // Trigger compensation flow for cancellations (voucher reinstatement + refund record)
  if (newStatus === "cancelled") {
    void triggerCancellationCompensation(id);
  }

  return NextResponse.json({ ok: true, id, status: newStatus });
}
