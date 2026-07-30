import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicMerchant } from "@/lib/merchants/queries";

/**
 * @deprecated Compatibility adapter for the pre-directory `/shop/[slug]` read
 * path. Delegates to the new public directory read (`get_public_merchant`)
 * instead of the old `store_active`-only lookup. Remove after the
 * `/merchants` migration window (see merchant-directory-in-store-discovery-spec.md §4).
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let merchant;
  try {
    merchant = await getPublicMerchant(params.slug, user?.id ?? null);
  } catch {
    return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  }
  if (!merchant) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  return NextResponse.json({
    merchant: {
      id: merchant.id,
      slug: merchant.slug,
      name: merchant.name,
      country: merchant.primaryLocation?.city ?? null,
      image_url: merchant.logoUrl,
      delivery_cities: [] as string[],
      wallet_address: null,
      support_email: merchant.contacts.email,
    },
    products: merchant.products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price_cusd: p.priceCusd,
      category: p.category,
      image_url: p.imageUrl,
      product_type: p.productType,
    })),
    voucher_templates: merchant.vouchers.map((v) => ({
      id: v.id,
      title: v.title,
      voucher_type: v.voucherType,
      miles_cost: v.milesCost,
      discount_percent: v.discountPercent,
      discount_cusd: v.discountCusd,
      applicable_category: v.applicableCategory,
      linked_product_id: v.linkedProductId,
      retail_value_cusd: v.retailValueCusd,
      cooldown_seconds: v.cooldownSeconds,
      global_cap: v.globalCap,
      expires_at: v.expiresAt,
    })),
  });
}
