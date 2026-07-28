// PATCH /api/admin/refunds/[id] — resolve a refund tracking row
// Body: { status: "refunded" | "not_applicable", refund_tx_hash?: string, notes?: string }
//
// order_cancellation_compensations rows are created atomically by
// advance_order_status when an order with a consumed payment is cancelled
// (order-lifecycle-completion-spec.md §4.1). Actual reversal execution
// (M-Pesa/crypto) stays manual for the pilot — this just records it.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

const VALID_STATUSES = new Set(["refunded", "not_applicable"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { status?: string; refund_tx_hash?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: "status must be refunded | not_applicable" }, { status: 400 });
  }
  if (body.status === "refunded" && !body.refund_tx_hash?.trim()) {
    return NextResponse.json({ error: "refund_tx_hash / receipt reference is required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("order_cancellation_compensations")
    .select("id, refund_status, order_id, user_address")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Refund record not found" }, { status: 404 });
  if (existing.refund_status !== "pending_manual") {
    return NextResponse.json({ error: `Already resolved (${existing.refund_status})` }, { status: 409 });
  }

  const { error } = await supabase
    .from("order_cancellation_compensations")
    .update({
      refund_status: body.status,
      refund_tx_hash: body.refund_tx_hash?.trim() || null,
      notes: body.notes?.trim() || null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: "Failed to update refund record" }, { status: 500 });

  if (body.status === "refunded") {
    const { error: notifErr } = await supabase.from("notification_outbox").insert({
      user_ref: existing.user_address,
      order_id: existing.order_id,
      template: "refund_completed",
      status: "sent",
      sent_at: new Date().toISOString(),
      dedupe_key: `notif:refund:${params.id}:refund_completed`,
      metadata: { refund_tx_hash: body.refund_tx_hash },
    });
    if (notifErr && notifErr.code !== "23505") {
      console.error("[refunds] Failed to write refund_completed notification:", notifErr.message);
    }
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `refund.${body.status}`,
    targetType: "order_cancellation_compensation",
    targetId: params.id,
    metadata: { refund_tx_hash: body.refund_tx_hash, notes: body.notes },
  });

  return NextResponse.json({ ok: true });
}
