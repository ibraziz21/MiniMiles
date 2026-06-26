import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const revalidate = 60;

export async function GET() {
  const admin = createAdminClient();

  // Join partners → partner_settings (store_active, logo_url, delivery_cities)
  // Count products and voucher templates per merchant
  const { data: partners, error } = await admin
    .from("partners")
    .select(`
      id,
      slug,
      name,
      country,
      image_url,
      partner_settings!inner (
        store_active,
        logo_url,
        delivery_cities
      )
    `)
    .eq("partner_settings.store_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!partners || partners.length === 0) {
    return NextResponse.json({ merchants: [] });
  }

  const ids = partners.map((p) => p.id);

  // Product counts
  const { data: productCounts } = await admin
    .from("merchant_products")
    .select("merchant_id")
    .in("merchant_id", ids)
    .eq("active", true);

  // Voucher template counts
  const { data: voucherCounts } = await admin
    .from("spend_voucher_templates")
    .select("partner_id")
    .in("partner_id", ids)
    .eq("active", true);

  const pCount = (id: string) =>
    (productCounts ?? []).filter((r) => r.merchant_id === id).length;
  const vCount = (id: string) =>
    (voucherCounts ?? []).filter((r) => r.partner_id === id).length;

  const merchants = partners.map((p) => {
    const settings = Array.isArray(p.partner_settings)
      ? p.partner_settings[0]
      : p.partner_settings;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      country: p.country,
      image_url: settings?.logo_url ?? p.image_url,
      delivery_cities: settings?.delivery_cities ?? [],
      product_count: pCount(p.id),
      voucher_count: vCount(p.id),
    };
  });

  return NextResponse.json({ merchants });
}
