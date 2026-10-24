import { supabase } from "@/lib/supabase";
import { hasPermission, type AdminRole } from "@/types";

export type UsageMetrics = {
  total_users_awarded: number;
  total_miles_awarded: number;
  weekly_users_awarded: number;
  weekly_miles_awarded: number;
  weekly_average_spend: number;
};
export type HomeMetrics = UsageMetrics & {
  total_pass_users: number;
  new_users_this_week: number;
  vouchers_redeemed: number;
};

/** Monday 00:00 EAT through now, independent of the deployment's timezone. */
export function currentWeekStart(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const daysSinceMonday = (eat.getUTCDay() + 6) % 7;
  eat.setUTCDate(eat.getUTCDate() - daysSinceMonday);
  eat.setUTCHours(0, 0, 0, 0);
  return new Date(eat.getTime() - 3 * 60 * 60 * 1000).toISOString();
}

export async function getHomeMetrics(role: AdminRole, now = new Date()) {
  const from = currentWeekStart(now);
  const to = now.toISOString();
  const canReadUsers = hasPermission(role, "users.read");
  const canReadVouchers = hasPermission(role, "vouchers.read") || hasPermission(role, "voucher_funds.read");
  const [passes, signups, usage, vouchers] = await Promise.all([
    canReadUsers ? supabase.from("hub_user_passes").select("id", { count: "exact", head: true }) : null,
    canReadUsers ? supabase.from("hub_user_passes").select("id", { count: "exact", head: true }).gte("created_at", from).lte("created_at", to) : null,
    canReadUsers ? supabase.rpc("get_admin_usage_metrics", { p_week_start: from, p_as_of: to }) : null,
    canReadVouchers ? supabase.from("issued_vouchers").select("id", { count: "exact", head: true }).eq("status", "redeemed") : null,
  ]);
  // Missing/failed sources remain unavailable, never misleading zeroes.
  const metrics: Partial<HomeMetrics> = {};
  const unavailable: string[] = [];
  if (passes && !passes.error && passes.count !== null) metrics.total_pass_users = passes.count;
  else if (canReadUsers) unavailable.push("Pass users");
  if (signups && !signups.error && signups.count !== null) metrics.new_users_this_week = signups.count;
  else if (canReadUsers) unavailable.push("weekly signups");
  if (usage && !usage.error && usage.data) Object.assign(metrics, usage.data as UsageMetrics);
  else if (canReadUsers) unavailable.push("Akiba usage");
  if (vouchers && !vouchers.error && vouchers.count !== null) metrics.vouchers_redeemed = vouchers.count;
  else if (canReadVouchers) unavailable.push("voucher redemptions");
  return { metrics, unavailable, weekStart: from, asOf: to };
}
