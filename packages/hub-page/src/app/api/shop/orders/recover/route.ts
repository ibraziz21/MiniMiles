// POST /api/shop/orders/recover
// Finishes an order for a payment that already succeeded but whose order
// creation previously failed (paid-order-recovery-spec.md Phase 2).
//
// Never initiates a new payment. Reconstructs the original checkout body
// from the reconciliation incident's stored snapshot (product/recipient/
// payment_ref), merges in any corrected fields the recovery form collected,
// and replays it through the exact same POST /api/shop/orders handler —
// so payment re-verification, replay-safety (existing payment_ref short-
// circuits to the already-created order), and incident-writing-on-repeat-
// failure are identical to the original checkout path, not a second
// implementation that could drift out of sync with it.
//
// Body: { incident_id: string, recipient_name?, phone?, city?, location_details? }

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST as createOrder } from "../route";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    incident_id?: string;
    recipient_name?: string;
    phone?: string;
    city?: string;
    location_details?: string;
  } | null;

  if (!body?.incident_id) {
    return NextResponse.json({ error: "incident_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: incident } = await admin
    .from("reconciliation_incidents")
    .select("id, voucher_id, data, resolved")
    .eq("id", body.incident_id)
    .eq("type", "order_rpc_failed_after_payment")
    .maybeSingle();

  if (!incident) return NextResponse.json({ error: "Recovery record not found" }, { status: 404 });
  if (incident.resolved) return NextResponse.json({ error: "Already recovered" }, { status: 409 });

  const data = incident.data as Record<string, unknown>;
  if (data.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Atomically claim the incident before doing anything else: an admin could
  // be processing "refund instead" for the same incident right now. Without
  // this, both paths could pass the resolved===false check above and both
  // perform their side effect (order + refund for the same payment) before
  // either resolves the incident.
  const { data: claimRows, error: claimErr } = await admin.rpc("claim_reconciliation_incident", {
    p_incident_id: incident.id,
    p_actor: user.id,
  });
  const claimResult = (claimRows as Array<{ ok: boolean; error_code: string }> | null)?.[0];
  if (claimErr || !claimResult?.ok) {
    return NextResponse.json(
      { error: claimResult?.error_code ?? claimErr?.message ?? "Could not claim recovery — try again shortly" },
      { status: 409 },
    );
  }

  const paymentMethod = String(data.payment_method ?? "");
  const paymentRef = String(data.payment_ref ?? "");
  const isCrypto = paymentMethod.startsWith("crypto:");

  const rebuiltBody: Record<string, unknown> = {
    product_id: data.product_id,
    voucher_id: incident.voucher_id ?? undefined,
    recipient_name: body.recipient_name ?? data.recipient_name,
    phone: body.phone ?? data.phone,
    city: body.city ?? data.city,
    location_details: body.location_details ?? data.location_details,
  };
  if (isCrypto) {
    rebuiltBody.tx_hash = paymentRef;
    rebuiltBody.currency = paymentMethod.split(":")[1];
  } else {
    rebuiltBody.mpesa_checkout_id = paymentRef;
  }

  const syntheticRequest = new Request("http://localhost/api/shop/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rebuiltBody),
  });

  const result = await createOrder(syntheticRequest);
  const resultJson = await result.clone().json().catch(() => ({}));

  if (result.status === 200 || result.status === 201) {
    const { error: resolveErr } = await admin.rpc("resolve_reconciliation_incident", {
      p_incident_id: incident.id,
      p_resolution: { order_id: resultJson.order?.id ?? null, resolved_via: "customer_recovery" },
      p_actor_id: user.id,
    });
    if (resolveErr) {
      console.error("[orders/recover] Failed to resolve incident after successful recovery:", resolveErr.message);
    }
  } else {
    // Order creation failed (or replayed into another failure incident) —
    // release the claim so the customer can retry immediately instead of
    // waiting out the lease.
    const { error: releaseErr } = await admin.rpc("release_reconciliation_incident_claim", {
      p_incident_id: incident.id,
    });
    if (releaseErr) {
      console.error("[orders/recover] Failed to release incident claim:", releaseErr.message);
    }
  }

  return result;
}
