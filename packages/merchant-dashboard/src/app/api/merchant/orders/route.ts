// GET /api/merchant/orders
// Returns paginated orders for the authenticated merchant.
// Query params:
//   status  — filter by OrderStatus (optional)
//   page    — 1-indexed page number (default: 1)
//   limit   — page size (default: 20, max: 100)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";

export async function GET(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") as OrderStatus | null;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  if (statusFilter && !ORDER_STATUSES.includes(statusFilter)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  let query = supabase
    .from("merchant_transactions")
    .select(
      `id,partner_id,user_address,status,
       item_name,item_category,product_id,
       payment_ref,payment_currency,amount_cusd,amount_kes,
       voucher_code,voucher_id,
       recipient_name,phone,city,location_details,
       created_at,accepted_at,packed_at,dispatched_at,delivered_at,received_at,cancelled_at`,
      { count: "exact" },
    )
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[orders] query error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }

  return NextResponse.json({
    orders: data ?? [],
    total: count ?? 0,
    page,
    pageSize: limit,
  });
}
