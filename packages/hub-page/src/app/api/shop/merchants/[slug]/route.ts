import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 60;

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const admin = createAdminClient();

  const { data: partner, error } = await admin
    .from("partners")
    .select(`
      id, slug, name, country, image_url,
      partner_settings (
        store_active, logo_url, delivery_cities, wallet_address,
        support_email, support_phone
      )
    `)
    .eq("slug", params.slug)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!partner) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const settings = Array.isArray(partner.partner_settings)
    ? partner.partner_settings[0]
    : partner.partner_settings;

  if (!settings?.store_active) {
    return NextResponse.json({ error: "Store is not active" }, { status: 404 });
  }

  const [{ data: products }, { data: templates }] = await Promise.all([
    admin
      .from("merchant_products")
      .select("id, name, description, price_cusd, category, image_url")
      .eq("merchant_id", partner.id)
      .eq("active", true)
      .order("category")
      .order("name"),
    admin
      .from("spend_voucher_templates")
      .select(`
        id, title, voucher_type, miles_cost,
        discount_percent, discount_cusd,
        applicable_category, linked_product_id,
        retail_value_cusd, cooldown_seconds,
        global_cap, expires_at
      `)
      .eq("partner_id", partner.id)
      .eq("active", true)
      .order("miles_cost"),
  ]);

  return NextResponse.json({
    merchant: {
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      country: partner.country,
      image_url: settings.logo_url ?? partner.image_url,
      delivery_cities: settings.delivery_cities ?? [],
      wallet_address: settings.wallet_address,
      support_email: settings.support_email,
    },
    products: products ?? [],
    voucher_templates: templates ?? [],
  });
}
