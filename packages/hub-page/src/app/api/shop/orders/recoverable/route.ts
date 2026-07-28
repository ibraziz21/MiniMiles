// GET /api/shop/orders/recoverable
// Lists the current user's confirmed-payment-but-no-order incidents
// (paid-order-recovery-spec.md Phase 2). These are written by
// POST /api/shop/orders whenever a verified payment's order creation fails —
// reconciliation_incidents already stores the product/recipient/payment
// snapshot needed to finish the order without a second payment.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: incidents } = await admin
    .from("reconciliation_incidents")
    .select("id, voucher_id, data, created_at")
    .eq("type", "order_rpc_failed_after_payment")
    .eq("resolved", false)
    .eq("data->>user_id", user.id)
    .order("created_at", { ascending: false });

  if (!incidents || incidents.length === 0) {
    return NextResponse.json({ recoverable: [] });
  }

  const productIds = [...new Set(incidents.map((i) => i.data?.product_id).filter(Boolean))];
  const { data: products } = productIds.length
    ? await admin.from("merchant_products").select("id, name, price_cusd, merchant_id").in("id", productIds)
    : { data: [] };
  const productMap = new Map((products ?? []).map((p) => [p.id, p]));

  const recoverable = incidents.map((incident) => {
    const data = incident.data as Record<string, unknown>;
    const product = productMap.get(data.product_id as string);
    return {
      incident_id: incident.id,
      product_id: data.product_id ?? null,
      item_name: product?.name ?? data.item_name ?? "Your order",
      price_cusd: product?.price_cusd ?? null,
      recipient_name: data.recipient_name ?? null,
      phone: data.phone ?? null,
      city: data.city ?? null,
      location_details: data.location_details ?? null,
      // Missing-details detection — the recovery form only needs to ask for
      // whatever the stored snapshot doesn't already have.
      missing_fields: [
        !data.recipient_name && "recipient_name",
        !data.phone && "phone",
      ].filter(Boolean),
      created_at: incident.created_at,
    };
  });

  return NextResponse.json({ recoverable });
}
