// GET /api/merchant/stats
// Returns order counts by status, recent orders, monthly financial summary,
// and voucher stats. Scoped to the authenticated merchant's partner_id.

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { OrderStatus, OrderStatsResponse } from "@/types";
import { ORDER_STATUSES } from "@/types";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { partnerId } = session;

  const now = new Date();

  const [countRes, recentRes, voucherRes, issuedVoucherRes] = await Promise.all([
    supabase
      .from("merchant_transactions")
      .select("status, amount_cusd, voucher_code, created_at")
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
    supabase
      .from("spend_voucher_templates")
      .select("id, active, expires_at")
      .eq("partner_id", partnerId),
    supabase
      .from("issued_vouchers")
      .select("id, status, created_at")
      .eq("merchant_id", partnerId)
      .eq("status", "issued"),
  ]);

  const rows = countRes.data ?? [];

  // ── Order counts by status (all time within window) ──────────────────────────
  const by_status = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
    OrderStatus,
    number
  >;
  for (const row of rows) {
    const s = row.status as OrderStatus;
    if (s in by_status) by_status[s]++;
  }

  // ── Monthly financial breakdown ───────────────────────────────────────────────
  // Keys: "YYYY-MM"
  const PAID_STATUSES = new Set(["delivered", "received", "completed"]);
  const IN_FLIGHT_STATUSES = new Set(["accepted", "packed", "out_for_delivery"]);

  type MonthBucket = {
    items_sold: number;
    value_sold_cusd: number;
    in_flight_cusd: number;       // only relevant for current month
    vouchers_used: number;
    voucher_value_cusd: number;
  };

  const monthMap: Record<string, MonthBucket> = {};

  // Pre-fill last 12 months so months with no orders still appear
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap[key] = { items_sold: 0, value_sold_cusd: 0, in_flight_cusd: 0, vouchers_used: 0, voucher_value_cusd: 0 };
  }

  for (const row of rows) {
    const month = row.created_at.slice(0, 7);
    if (!monthMap[month]) continue; // outside our window, skip

    const cusd = row.amount_cusd ?? 0;

    if (PAID_STATUSES.has(row.status)) {
      monthMap[month].items_sold += 1;
      monthMap[month].value_sold_cusd += cusd;
    }
    if (IN_FLIGHT_STATUSES.has(row.status)) {
      monthMap[month].in_flight_cusd += cusd;
    }
    if (row.voucher_code) {
      monthMap[month].vouchers_used += 1;
      // Approximate: voucher discount not stored on tx, track volume
    }
  }

  // Round all values
  for (const b of Object.values(monthMap)) {
    b.value_sold_cusd = Math.round(b.value_sold_cusd * 100) / 100;
    b.in_flight_cusd = Math.round(b.in_flight_cusd * 100) / 100;
  }

  const monthly = Object.entries(monthMap)
    .sort((a, b) => b[0].localeCompare(a[0])) // newest first
    .map(([month, data]) => ({ month, ...data }));

  // ── Voucher stats ──────────────────────────────────────────────────────────────
  const templates = voucherRes.data ?? [];
  const active_templates = templates.filter((t) => t.active).length;

  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const expiring_soon = templates.filter(
    (t) => t.active && t.expires_at && t.expires_at <= thirtyDaysFromNow,
  ).length;

  const outstanding_issued = (issuedVoucherRes.data ?? []).length;

  const response: OrderStatsResponse = {
    new_orders: by_status.placed,
    by_status,
    recent_orders: recentRes.data ?? [],
    // Extended fields
    monthly,
    voucher_stats: {
      active_templates,
      outstanding_issued,
      expiring_soon,
    },
  };

  return NextResponse.json(response);
}
