import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { MerchantsListView } from "@/components/merchants/MerchantsListView";

async function getMerchants() {
  const [partnersRes, subscriptionsRes, vouchersRes, teamRes] = await Promise.all([
    supabase.from("partners").select("id, slug, name, country, image_url").order("name"),
    supabase
      .from("partner_subscriptions")
      .select("partner_id, plan, status, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("spend_voucher_templates").select("partner_id, lifecycle_state, active"),
    supabase.from("merchant_users").select("partner_id"),
  ]);

  const subscriptionMap: Record<string, { plan: string; status: string }> = {};
  for (const subscription of subscriptionsRes.data ?? []) {
    if (!subscriptionMap[subscription.partner_id]) {
      subscriptionMap[subscription.partner_id] = {
        plan: subscription.plan,
        status: subscription.status,
      };
    }
  }

  const voucherMap: Record<string, { total: number; active: number }> = {};
  for (const voucher of vouchersRes.data ?? []) {
    if (!voucherMap[voucher.partner_id]) voucherMap[voucher.partner_id] = { total: 0, active: 0 };
    voucherMap[voucher.partner_id].total++;
    if (voucher.lifecycle_state === "published" && voucher.active) {
      voucherMap[voucher.partner_id].active++;
    }
  }

  const teamMap: Record<string, number> = {};
  for (const u of teamRes.data ?? []) teamMap[u.partner_id] = (teamMap[u.partner_id] ?? 0) + 1;

  return (partnersRes.data ?? []).map((p) => ({
    ...p,
    subscription: subscriptionMap[p.id] ?? null,
    voucher_types: voucherMap[p.id]?.total ?? 0,
    active_voucher_types: voucherMap[p.id]?.active ?? 0,
    team_count: teamMap[p.id] ?? 0,
  }));
}

export default async function MerchantsPage() {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const merchants = await getMerchants();

  return (
    <div>
      <PageHeader title="Merchants" subtitle={`${merchants.length} merchant${merchants.length !== 1 ? "s" : ""} registered`} />
      <div className="p-4 sm:p-6">
        <MerchantsListView merchants={merchants} />
      </div>
    </div>
  );
}
