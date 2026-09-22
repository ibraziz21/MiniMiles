import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET /api/admin/merchants — cross-merchant directory
export async function GET() {
  const session = await requireAdminSession("merchants.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: partners, error } = await supabase
    .from("partners")
    .select("id, slug, name, country, image_url, status")
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to fetch merchants" }, { status: 500 });

  const partnerIds = (partners ?? []).map((p) => p.id);
  if (partnerIds.length === 0) return NextResponse.json({ merchants: [] });

  const [subscriptionsRes, vouchersRes, teamRes] = await Promise.all([
    supabase
      .from("partner_subscriptions")
      .select("partner_id, plan, status, created_at")
      .in("partner_id", partnerIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("spend_voucher_templates")
      .select("partner_id, lifecycle_state, active")
      .in("partner_id", partnerIds),
    supabase.from("merchant_users").select("partner_id").in("partner_id", partnerIds),
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

  const merchants = (partners ?? []).map((p) => ({
    ...p,
    subscription: subscriptionMap[p.id] ?? null,
    voucher_types: voucherMap[p.id]?.total ?? 0,
    active_voucher_types: voucherMap[p.id]?.active ?? 0,
    team_count: teamMap[p.id] ?? 0,
  }));

  return NextResponse.json({ merchants });
}
