// GET /api/merchant/stats
// Returns order counts by status + 10 most recent orders.
// Scoped to the authenticated merchant's partner_id.

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { OrderStatus, OrderStatsResponse } from "@/types";
import { ORDER_STATUSES } from "@/types";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { partnerId } = session;

  // Parallel: counts + recent orders
  const [countRes, recentRes] = await Promise.all([
    supabase
      .from("merchant_transactions")
      .select("status", { count: "exact" })
      .eq("partner_id", partnerId),
    supabase
      .from("merchant_transactions")
      .select(
        `id,partner_id,user_address,status,
         item_name,item_category,product_id,
         payment_ref,payment_currency,amount_cusd,amount_kes,
         voucher_code,voucher_id,
         recipient_name,phone,city,location_details,
         created_at,accepted_at,packed_at,dispatched_at,delivered_at,received_at,cancelled_at`,
      )
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (countRes.error) {
    console.error("[stats] count error:", countRes.error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }

  // Aggregate counts by status
  const by_status = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
    OrderStatus,
    number
  >;

  for (const row of countRes.data ?? []) {
    const s = row.status as OrderStatus;
    if (s in by_status) by_status[s]++;
  }

  const response: OrderStatsResponse = {
    new_orders: by_status.placed,
    by_status,
    recent_orders: recentRes.data ?? [],
  };

  return NextResponse.json(response);
}
