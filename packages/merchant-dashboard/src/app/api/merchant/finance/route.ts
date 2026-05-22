// GET /api/merchant/finance
// Returns revenue totals, voucher stats, estimated receivables, and monthly breakdown.
// All figures scoped to the authenticated merchant's partner_id.

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { FinanceStats, FinanceMonthly } from "@/types";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { partnerId } = session;

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [txRes, settingsRes, voucherTemplatesRes] = await Promise.all([
    supabase
      .from("merchant_transactions")
      .select("status, amount_cusd, created_at")
      .eq("partner_id", partnerId),
    supabase
      .from("partner_settings")
      .select("wallet_address")
      .eq("partner_id", partnerId)
      .single(),
    supabase
      .from("spend_voucher_templates")
      .select("id, active")
      .eq("partner_id", partnerId),
  ]);

  const txs = txRes.data ?? [];

  // Revenue: only count completed orders (status = 'completed' | 'received' | 'delivered')
  const PAID_STATUSES = new Set(["delivered", "received", "completed"]);
  const IN_FLIGHT_STATUSES = new Set(["accepted", "packed", "out_for_delivery"]);

  const paidTxs = txs.filter((t) => PAID_STATUSES.has(t.status));
  const inFlightTxs = txs.filter((t) => IN_FLIGHT_STATUSES.has(t.status));

  const sumCusd = (rows: typeof txs) =>
    rows.reduce((acc, t) => acc + (t.amount_cusd ?? 0), 0);

  const total_revenue_cusd = Math.round(sumCusd(paidTxs) * 100) / 100;

  const thisMonthPaid = paidTxs.filter((t) => t.created_at >= thisMonthStart);
  const this_month_revenue_cusd = Math.round(sumCusd(thisMonthPaid) * 100) / 100;

  const lastMonthPaid = paidTxs.filter(
    (t) => t.created_at >= lastMonthStart && t.created_at < thisMonthStart,
  );
  const last_month_revenue_cusd = Math.round(sumCusd(lastMonthPaid) * 100) / 100;

  const total_completed_orders = paidTxs.length;
  const this_month_completed_orders = thisMonthPaid.length;

  const estimated_receivable_cusd = Math.round(sumCusd(inFlightTxs) * 100) / 100;

  // Voucher stats from templates
  const templates = voucherTemplatesRes.data ?? [];
  const active_voucher_templates = templates.filter((v) => v.active).length;

  // Outstanding issued (not redeemed) vouchers — scoped to this partner
  const { count: outstanding } = await supabase
    .from("issued_vouchers")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", partnerId)
    .eq("status", "issued");

  const issued_vouchers_outstanding = outstanding ?? 0;

  // Monthly breakdown: last 6 months
  const recentPaidTxs = paidTxs.filter((t) => t.created_at >= sixMonthsAgo);
  const monthMap: Record<string, { revenue: number; count: number }> = {};
  for (const t of recentPaidTxs) {
    const month = t.created_at.slice(0, 7); // "YYYY-MM"
    if (!monthMap[month]) monthMap[month] = { revenue: 0, count: 0 };
    monthMap[month].revenue += t.amount_cusd ?? 0;
    monthMap[month].count += 1;
  }
  const monthly: FinanceMonthly[] = Object.entries(monthMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, { revenue, count }]) => ({
      month,
      revenue_cusd: Math.round(revenue * 100) / 100,
      order_count: count,
    }));

  const wallet_address = settingsRes.data?.wallet_address ?? null;

  const result: FinanceStats = {
    total_revenue_cusd,
    this_month_revenue_cusd,
    last_month_revenue_cusd,
    total_completed_orders,
    this_month_completed_orders,
    active_voucher_templates,
    issued_vouchers_outstanding,
    estimated_receivable_cusd,
    monthly,
    wallet_address,
  };

  return NextResponse.json(result);
}
