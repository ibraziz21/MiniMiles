// GET /api/Spend/deals
// Public, cached: active spend_voucher_templates + merchant join for the
// "Merchant deals" shelf on /spend (spend-earn-redesign-spec.md §1c/§3).
// Mirrors the manual-join pattern used by vouchers/user/[address] — no FK
// auto-detection between spend_voucher_templates and partners.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const revalidate = 300;

const DEALS_LIMIT = 10;

export async function GET() {
  const nowIso = new Date().toISOString();

  const { data: templates, error: tErr } = await supabase
    .from("spend_voucher_templates")
    .select(
      `id, title, miles_cost, voucher_type, discount_percent, discount_cusd,
       applicable_category, linked_product_id, retail_value_cusd,
       cooldown_seconds, global_cap, merchant_id, created_at`,
    )
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(DEALS_LIMIT * 3); // headroom for sold-out templates filtered out below

  if (tErr) {
    console.error("[GET /Spend/deals] templates query", tErr);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }

  if (!templates || templates.length === 0) {
    return NextResponse.json({ deals: [] });
  }

  // Exclude sold-out templates (global_cap reached) — mirrors the cap check
  // in sql/reserve_voucher_atomic.sql.
  const cappedIds = templates.filter((t) => t.global_cap != null).map((t) => t.id);
  const issuedCounts = new Map<string, number>();
  if (cappedIds.length > 0) {
    const { data: issuedRows, error: iErr } = await supabase
      .from("issued_vouchers")
      .select("voucher_template_id")
      .in("voucher_template_id", cappedIds)
      .neq("status", "void");

    if (iErr) {
      console.error("[GET /Spend/deals] issued count query", iErr);
    }
    for (const row of issuedRows ?? []) {
      const key = row.voucher_template_id as string;
      issuedCounts.set(key, (issuedCounts.get(key) ?? 0) + 1);
    }
  }

  const available = templates.filter((t) => {
    if (t.global_cap == null) return true;
    return (issuedCounts.get(t.id) ?? 0) < t.global_cap;
  });

  const merchantIds = [...new Set(available.map((t) => t.merchant_id).filter(Boolean))];
  const { data: merchants, error: mErr } = merchantIds.length
    ? await supabase.from("partners").select("id, name, slug, image_url, country").in("id", merchantIds)
    : { data: [], error: null };

  if (mErr) {
    console.error("[GET /Spend/deals] merchants query", mErr);
  }

  const merchantMap = new Map((merchants ?? []).map((m: any) => [m.id, m]));

  const deals = available.slice(0, DEALS_LIMIT).map((t: any) => ({
    ...t,
    spend_merchants: merchantMap.get(t.merchant_id) ?? null,
  }));

  return NextResponse.json({ deals });
}
