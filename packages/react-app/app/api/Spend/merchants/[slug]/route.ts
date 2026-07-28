// GET /api/Spend/merchants/[slug]
// Returns merchant detail plus its active voucher templates.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { data: merchant, error: mErr } = await supabase
    .from("partners")
    .select("id, slug, name, country, image_url, partner_settings(logo_url, support_email, wallet_address)")
    .eq("slug", slug)
    .single();

  if (mErr || !merchant) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  const { data: templates, error: tErr } = await supabase
    .from("spend_voucher_templates")
    .select(
      `id, title, miles_cost, voucher_type, discount_percent, discount_cusd,
       applicable_category, cooldown_seconds, global_cap, expires_at,
       linked_product_id, retail_value_cusd`,
    )
    .eq("merchant_id", merchant.id)
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (tErr) {
    console.error("[GET /merchants/slug templates]", tErr);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }

  const settings = (merchant as any).partner_settings ?? null;
  return NextResponse.json({
    merchant: {
      id: merchant.id,
      slug: merchant.slug,
      name: merchant.name,
      country: merchant.country,
      image_url: settings?.logo_url ?? merchant.image_url,
      support_email: settings?.support_email ?? null,
      // Public on-chain address — the client needs it to send the stablecoin
      // transfer directly to the merchant, not just know whether one is set.
      wallet_address: settings?.wallet_address ?? null,
    },
    templates: templates ?? [],
  });
}
