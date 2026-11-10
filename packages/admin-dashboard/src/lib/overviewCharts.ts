import { supabase } from "@/lib/supabase";
import {
  defaultPassAnalyticsRange,
  shiftIsoDate,
  type PassAnalytics,
} from "@/lib/passAnalytics";
import { getEarningBreakdown } from "@/lib/earningBreakdown";
import { hasPermission, type AdminRole } from "@/types";

export function overviewDays(
  value: string | string[] | undefined
): 7 | 30 | 90 {
  return value === "7" ? 7 : value === "90" ? 90 : 30;
}

// Page through financial views rather than silently summing PostgREST's
// default first page. A failed/incomplete source must not produce a total.
async function sumView(
  table: string,
  key: string,
  amount: string,
  states?: string[]
) {
  let total = 0;
  for (let offset = 0; offset < 100_000; offset += 500) {
    let query = supabase
      .from(table)
      .select(`${key}, ${amount}`)
      .eq("currency", "KES")
      .order(key)
      .range(offset, offset + 499);
    if (states) query = query.in("state", states);
    const { data, error } = await query;
    if (error || !data) throw new Error("Reimbursement totals unavailable");
    for (const row of data as unknown as Record<string, unknown>[]) {
      const value = Number(row[amount]);
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        !Number.isSafeInteger(total + value)
      )
        throw new Error("Invalid reimbursement amount");
      total += value;
    }
    if (data.length < 500) return total;
  }
  throw new Error("Reimbursement result exceeds reporting limit");
}

async function reimbursements() {
  try {
    const [unbatched, batched, paid] = await Promise.all([
      sumView(
        "v_unbatched_voucher_payables",
        "voucher_redemption_id",
        "net_payable_minor"
      ),
      sumView("v_partner_settlement_batches", "id", "total_amount_minor", [
        "draft",
        "submitted",
      ]),
      sumView("v_partner_settlement_batches", "id", "total_amount_minor", [
        "paid",
      ]),
    ]);
    return { paid: paid / 100, outstanding: (unbatched + batched) / 100 };
  } catch {
    return null;
  }
}

export async function getOverviewCharts(
  role: AdminRole,
  days: number,
  now = new Date()
) {
  const to = defaultPassAnalyticsRange(now).to;
  const from = shiftIsoDate(to, -(days - 1));
  const users = hasPermission(role, "users.read");
  const [passes, earnings, finance, merchants] = await Promise.all([
    users
      ? supabase.rpc("get_admin_pass_analytics", { p_from: from, p_to: to })
      : null,
    users ? getEarningBreakdown("all", 1, null, now) : null,
    hasPermission(role, "voucher_settlements.read") ? reimbursements() : null,
    hasPermission(role, "merchants.read")
      ? supabase
          .from("partners")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
      : null,
  ]);
  return {
    from,
    to,
    passes:
      passes && !passes.error ? (passes.data as PassAnalytics | null) : null,
    merchants: earnings?.data?.merchants.slice(0, 5) ?? null,
    finance,
    activeMerchants: merchants && !merchants.error ? merchants.count : null,
  };
}
