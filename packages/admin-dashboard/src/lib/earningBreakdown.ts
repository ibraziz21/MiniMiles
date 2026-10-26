import { supabase } from "@/lib/supabase";
import { currentWeekStart } from "@/lib/overviewMetrics";

export type EarningPeriod = "all" | "week";
export type MerchantEarnings = {
  merchant_key: string;
  merchant_name: string;
  users_awarded: number;
  miles_awarded: number;
  miles_per_user: number;
  estimated_spend_kes: number;
};
export type MemberEarnings = {
  member_id: string;
  username: string | null;
  miles_awarded: number;
  estimated_spend_kes: number;
  award_count: number;
  last_earned_at: string;
};
export type EarningBreakdown = {
  users_awarded: number;
  miles_awarded: number;
  miles_per_user: number;
  estimated_spend_kes: number;
  merchant_name: string | null;
  total_rows: number;
  merchants: MerchantEarnings[];
  members: MemberEarnings[];
};
export function earningFilters(params: { period?: string; page?: string }) {
  const requested = Number(params.page ?? 1);
  return {
    period: params.period === "week" ? "week" as const : "all" as const,
    page: Number.isSafeInteger(requested) && requested >= 1 && requested <= 10000 ? requested : 1,
  };
}
export function isMerchantKey(key: string) {
  return key === "unattributed" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}
export async function getEarningBreakdown(period: EarningPeriod, page: number, merchantKey: string | null = null, now = new Date()) {
  const { data, error } = await supabase.rpc("get_admin_earning_breakdown", {
    p_from: period === "week" ? currentWeekStart(now) : null,
    p_as_of: now.toISOString(), p_merchant_key: merchantKey, p_page: page,
  });
  return { data: error ? null : data as EarningBreakdown | null, error: Boolean(error || !data) };
}
export function formatSpendKes(amount: number) {
  return `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(amount)}`;
}
