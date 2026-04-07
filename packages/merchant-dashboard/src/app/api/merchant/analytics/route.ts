// GET /api/merchant/analytics
// Returns: orders by city, top products, voucher usage, acceptance rate, 30-day trend

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [allOrdersRes, recentOrdersRes] = await Promise.all([
    supabase
      .from("merchant_transactions")
      .select("status,city,item_name,item_category,voucher_code,created_at")
      .eq("partner_id", session.partnerId),
    supabase
      .from("merchant_transactions")
      .select("status,city,item_name,item_category,voucher_code,created_at")
      .eq("partner_id", session.partnerId)
      .gte("created_at", thirtyDaysAgo),
  ]);

  const allOrders = allOrdersRes.data ?? [];
  const recentOrders = recentOrdersRes.data ?? [];

  // Orders by city
  const cityMap: Record<string, number> = {};
  for (const o of allOrders) {
    const c = o.city ?? "Unknown";
    cityMap[c] = (cityMap[c] ?? 0) + 1;
  }
  const by_city = Object.entries(cityMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([city, count]) => ({ city, count }));

  // Top products
  const productMap: Record<string, number> = {};
  for (const o of allOrders) {
    const name = o.item_name ?? "Unknown";
    productMap[name] = (productMap[name] ?? 0) + 1;
  }
  const top_products = Object.entries(productMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Voucher usage
  const total_with_voucher = allOrders.filter((o) => o.voucher_code).length;
  const voucher_usage_rate =
    allOrders.length > 0 ? Math.round((total_with_voucher / allOrders.length) * 100) : 0;

  // Acceptance / cancellation rates
  const total = allOrders.length;
  const accepted = allOrders.filter((o) =>
    ["accepted", "packed", "out_for_delivery", "delivered", "received", "completed"].includes(o.status)
  ).length;
  const cancelled = allOrders.filter((o) => o.status === "cancelled").length;
  const acceptance_rate = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const cancellation_rate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

  // 30-day daily trend
  const dayMap: Record<string, number> = {};
  for (const o of recentOrders) {
    const day = o.created_at.slice(0, 10);
    dayMap[day] = (dayMap[day] ?? 0) + 1;
  }
  const daily_trend = Object.entries(dayMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  return NextResponse.json({
    total_orders: total,
    by_city,
    top_products,
    voucher_usage_rate,
    total_with_voucher,
    acceptance_rate,
    cancellation_rate,
    daily_trend,
  });
}
