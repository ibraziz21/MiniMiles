// POST /api/admin/incidents/[id]/refund
// "Refund instead" for an orphaned-payment incident (confirmed payment,
// order creation failed, admin decides not to push the customer through
// recovery). Creates an order-less refund tracking row — order_id is
// nullable specifically for this case (migration 039) — and resolves the
// incident so it drops out of the reconciliation queue.
//
// Deliberately does NOT attempt to recreate the order itself: that's the
// customer's own "Finish order" recovery banner on My Orders, which reuses
// the exact payment-verification/order-creation path. This route only
// records the decision to refund instead.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: incident } = await supabase
    .from("reconciliation_incidents")
    .select("id, voucher_id, data, resolved")
    .eq("id", params.id)
    .eq("type", "order_rpc_failed_after_payment")
    .maybeSingle();

  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  if (incident.resolved) return NextResponse.json({ error: "Already resolved" }, { status: 409 });

  // Atomically claim the incident before doing anything else: the customer
  // could be running their own "Finish order" recovery for the same
  // incident right now. Without this, both paths could pass the resolved
  // check above and both perform their side effect (refund + order) before
  // either resolves the incident.
  const actorId = adminIdForWrite(session) ?? "admin";
  const { data: claimRows, error: claimErr } = await supabase.rpc("claim_reconciliation_incident", {
    p_incident_id: incident.id,
    p_actor: actorId,
  });
  const claimResult = (claimRows as Array<{ ok: boolean; error_code: string }> | null)?.[0];
  if (claimErr || !claimResult?.ok) {
    return NextResponse.json(
      { error: claimResult?.error_code ?? claimErr?.message ?? "Could not claim incident — try again shortly" },
      { status: 409 },
    );
  }

  const data = incident.data as Record<string, unknown>;
  const paymentMethod = String(data.payment_method ?? "");
  const rail = paymentMethod.startsWith("crypto:") || paymentMethod === "onchain_transfer" ? "crypto" : "mpesa";

  const { error: insertErr } = await supabase.from("order_cancellation_compensations").insert({
    order_id: null,
    user_address: data.user_address ?? "unknown",
    partner_id: data.partner_id ?? null,
    amount_cusd: data.amount_cusd ?? null,
    amount_kes: rail === "mpesa" ? data.amount_kes ?? null : null,
    payment_ref: data.payment_ref ?? null,
    payment_currency: data.payment_currency ?? null,
    voucher_id: incident.voucher_id,
    voucher_reinstated: false,
    refund_status: "pending_manual",
    rail,
    reason: "orphaned_payment_admin_refund",
  });

  if (insertErr) {
    await supabase.rpc("release_reconciliation_incident_claim", { p_incident_id: incident.id });
    const alreadyRefunded = insertErr.code === "23505";
    return NextResponse.json(
      { error: alreadyRefunded ? "This payment has already been refunded" : "Failed to create refund record" },
      { status: alreadyRefunded ? 409 : 500 },
    );
  }

  const { error: resolveErr } = await supabase.rpc("resolve_reconciliation_incident", {
    p_incident_id: incident.id,
    p_resolution: { resolved_via: "admin_refund_instead" },
    p_actor_id: actorId,
  });
  if (resolveErr) {
    console.error("[incidents/refund] resolve_reconciliation_incident failed:", resolveErr.message);
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "incident.refund_instead",
    targetType: "reconciliation_incident",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
