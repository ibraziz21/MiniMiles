import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppingBag, Tag, Truck } from "lucide-react";
import { ShopFilters } from "./ShopFilters";
import Link from "next/link";

export const metadata = { title: "Shop & Earn — Akiba Hub" };
export const revalidate = 60;

type Merchant = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_url: string | null;
  delivery_cities: string[];
  product_count: number;
  voucher_count: number;
  categories: string[];
};

async function getMerchants(): Promise<Merchant[]> {
  const admin = createAdminClient();

  const { data: partners } = await admin
    .from("partners")
    .select(`id, slug, name, country, image_url, partner_settings!inner(store_active, logo_url, delivery_cities)`)
    .eq("partner_settings.store_active", true)
    .order("name");

  if (!partners?.length) return [];

  const ids = partners.map((p) => p.id);
  const [{ data: products }, { data: vCounts }] = await Promise.all([
    admin.from("merchant_products").select("merchant_id, category").in("merchant_id", ids).eq("active", true),
    admin.from("spend_voucher_templates").select("partner_id").in("partner_id", ids).eq("active", true),
  ]);

  return partners.map((p) => {
    const s = Array.isArray(p.partner_settings) ? p.partner_settings[0] : p.partner_settings;
    const merchantProducts = (products ?? []).filter((r) => r.merchant_id === p.id);
    const categories = [...new Set(merchantProducts.map((r) => r.category).filter(Boolean))];

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      country: p.country ?? "KE",
      image_url: s?.logo_url ?? p.image_url,
      delivery_cities: s?.delivery_cities ?? [],
      product_count: merchantProducts.length,
      voucher_count: (vCounts ?? []).filter((r) => r.partner_id === p.id).length,
      categories,
    };
  });
}

export default async function ShopPage() {
  const merchants = await getMerchants();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-sterling text-3xl font-semibold text-akiba-ink">Shop & Earn</h1>
          <p className="mt-2 text-akiba-muted">
            Buy from verified merchants using stablecoins or M-Pesa.{" "}
            Earn eligible AkibaMiles rewards after verified purchases.
          </p>
        </div>
        <Link href="/vouchers" className="flex items-center gap-2 rounded-full border border-akiba-teal/30 bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal hover:bg-akiba-teal hover:text-white transition">
          <Tag className="h-4 w-4" /> Browse vouchers
        </Link>
      </div>

      {/* How it works strip */}
      <div className="mb-8 grid gap-3 rounded-2xl bg-akiba-tint p-4 sm:grid-cols-3 sm:gap-6 sm:p-6">
        {[
          { icon: <ShoppingBag className="h-5 w-5 text-akiba-teal" />, text: "Add items to cart from any merchant" },
          { icon: <Tag className="h-5 w-5 text-akiba-teal" />, text: "Apply a voucher code to save on price" },
          { icon: <Truck className="h-5 w-5 text-akiba-teal" />, text: "Pay with M-Pesa or supported stablecoins; rewards issue after verification" },
        ].map(({ icon, text }, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-chip">
              {icon}
            </span>
            <p className="text-sm font-medium text-akiba-ink">{text}</p>
          </div>
        ))}
      </div>

      {/* Merchant grid with filters */}
      {merchants.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white px-6 py-16 text-center">
          <ShoppingBag className="mb-4 h-12 w-12 text-akiba-line" />
          <h2 className="font-sterling text-xl font-semibold text-akiba-ink">No merchants yet</h2>
          <p className="mt-2 max-w-xs text-sm text-akiba-muted">Partner merchants are being onboarded. Check back soon.</p>
        </div>
      ) : (
        <ShopFilters merchants={merchants} />
      )}
    </main>
  );
}
