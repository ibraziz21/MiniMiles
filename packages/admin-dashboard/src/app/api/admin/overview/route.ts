import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { OverviewStats } from "@/types";

export async function GET() {
  const session = await requireAdminSession("merchants.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    usersRes,
    activeWalletsRes,
    milesRes,
    merchantsRes,
    ordersRes,
    vouchersRes,
    pollResponsesRes,
    incidentsRes,
  ] = await Promise.all([
    // Total users (distinct wallet addresses that have ever interacted)
    supabase.from("akiba_users").select("id", { count: "exact", head: true }),
    // Active wallets: users with a transaction in the last 30 days
    supabase
      .from("merchant_transactions")
      .select("user_address", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    // Miles minted/burned — from miles_ledger if it exists, else zeros
    supabase
      .from("miles_ledger")
      .select("type, amount")
      .in("type", ["mint", "burn"]),
    // Total merchants (partners)
    supabase.from("partners").select("id", { count: "exact", head: true }),
    // Active orders (not final state)
    supabase
      .from("merchant_transactions")
      .select("id", { count: "exact", head: true })
      .not("status", "in", '("received","completed","cancelled")'),
    // Vouchers
    supabase
      .from("issued_vouchers")
      .select("status", { count: "exact" }),
    // Poll responses
    supabase.from("poll_responses").select("id", { count: "exact", head: true }),
    // Open incidents
    supabase
      .from("ops_incidents")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "in_progress"]),
  ]);

  let milesMinted = 0;
  let milesBurned = 0;
  for (const row of milesRes.data ?? []) {
    if (row.type === "mint") milesMinted += row.amount ?? 0;
    if (row.type === "burn") milesBurned += row.amount ?? 0;
  }

  const voucherRows = vouchersRes.data ?? [];
  const vouchersIssued = voucherRows.length;
  const vouchersRedeemed = voucherRows.filter((v) => v.status === "redeemed").length;

  const stats: OverviewStats = {
    total_users: usersRes.count ?? 0,
    active_wallets: activeWalletsRes.count ?? 0,
    miles_minted: milesMinted,
    miles_burned: milesBurned,
    miles_outstanding: milesMinted - milesBurned,
    total_merchants: merchantsRes.count ?? 0,
    active_orders: ordersRes.count ?? 0,
    vouchers_issued: vouchersIssued,
    vouchers_redeemed: vouchersRedeemed,
    poll_response_count: pollResponsesRes.count ?? 0,
    open_incidents: incidentsRes.count ?? 0,
  };

  return NextResponse.json(stats);
}
