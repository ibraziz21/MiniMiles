import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET /api/admin/merchants — cross-merchant directory
export async function GET() {
  const session = await requireAdminSession("merchants.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: partners, error } = await supabase
    .from("partners")
    .select("id, slug, name, country, image_url")
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to fetch merchants" }, { status: 500 });

  const partnerIds = (partners ?? []).map((p) => p.id);

  const [settingsRes, orderCountRes, teamRes] = await Promise.all([
    supabase.from("partner_settings").select("partner_id, store_active, wallet_address").in("partner_id", partnerIds),
    supabase.from("merchant_transactions").select("partner_id, status").in("partner_id", partnerIds),
    supabase.from("merchant_users").select("partner_id").in("partner_id", partnerIds),
  ]);

  const settingsMap: Record<string, { store_active: boolean; wallet_address: string | null }> = {};
  for (const s of settingsRes.data ?? []) settingsMap[s.partner_id] = s;

  const orderMap: Record<string, { total: number; active: number }> = {};
  for (const o of orderCountRes.data ?? []) {
    if (!orderMap[o.partner_id]) orderMap[o.partner_id] = { total: 0, active: 0 };
    orderMap[o.partner_id].total++;
    if (!["received", "completed", "cancelled"].includes(o.status)) orderMap[o.partner_id].active++;
  }

  const teamMap: Record<string, number> = {};
  for (const u of teamRes.data ?? []) teamMap[u.partner_id] = (teamMap[u.partner_id] ?? 0) + 1;

  const merchants = (partners ?? []).map((p) => ({
    ...p,
    store_active: settingsMap[p.id]?.store_active ?? null,
    wallet_address: settingsMap[p.id]?.wallet_address ?? null,
    total_orders: orderMap[p.id]?.total ?? 0,
    active_orders: orderMap[p.id]?.active ?? 0,
    team_count: teamMap[p.id] ?? 0,
  }));

  return NextResponse.json({ merchants });
}
