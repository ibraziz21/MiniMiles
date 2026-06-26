import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { voucherLabel } from "@/lib/pricing";
import { ShoppingBag, Tag, MapPin, Mail, ArrowLeft } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import { AddToCart } from "./AddToCart";

export const revalidate = 60;

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cusd: number;
  category: string;
  image_url: string | null;
};

type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  linked_product_id: string | null;
  retail_value_cusd: number | null;
  cooldown_seconds: number;
  global_cap: number | null;
  expires_at: string | null;
};

type Merchant = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_url: string | null;
  delivery_cities: string[];
  wallet_address: string | null;
  support_email: string | null;
};

async function getMerchantPage(slug: string): Promise<{
  merchant: Merchant;
  products: Product[];
  voucher_templates: VoucherTemplate[];
} | null> {
  const admin = createAdminClient();

  const { data: partner } = await admin
    .from("partners")
    .select(`id, slug, name, country, image_url, partner_settings(store_active, logo_url, delivery_cities, wallet_address, support_email)`)
    .eq("slug", slug)
    .maybeSingle();

  if (!partner) return null;

  const s = Array.isArray(partner.partner_settings)
    ? partner.partner_settings[0]
    : partner.partner_settings;

  if (!s?.store_active) return null;

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
      .select("id, title, voucher_type, miles_cost, discount_percent, discount_cusd, applicable_category, linked_product_id, retail_value_cusd, cooldown_seconds, global_cap, expires_at")
      .eq("partner_id", partner.id)
      .eq("active", true)
      .order("miles_cost"),
  ]);

  return {
    merchant: {
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      country: partner.country,
      image_url: s.logo_url ?? partner.image_url,
      delivery_cities: s.delivery_cities ?? [],
      wallet_address: s.wallet_address,
      support_email: s.support_email,
    },
    products: products ?? [],
    voucher_templates: templates ?? [],
  };
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getMerchantPage(params.slug);
  return { title: data ? `${data.merchant.name} — Akiba Hub` : "Shop — Akiba Hub" };
}

const CATEGORY_LABELS: Record<string, string> = {
  electronics: "Electronics",
  accessories: "Accessories",
  services: "Services",
  clothing: "Clothing",
  food: "Food & Drinks",
  general: "General",
};

export default async function MerchantPage({ params }: { params: { slug: string } }) {
  const data = await getMerchantPage(params.slug);
  if (!data) notFound();

  const { merchant, products, voucher_templates } = data;

  // Group products by category
  const byCategory = products.reduce<Record<string, Product[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});
  const categories = Object.keys(byCategory).sort();

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Back */}
      <a href="/shop" className="mb-6 flex items-center gap-1.5 text-sm text-akiba-muted hover:text-akiba-ink">
        <ArrowLeft className="h-4 w-4" /> All merchants
      </a>

      {/* Merchant header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-akiba-line bg-white">
          {merchant.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={merchant.image_url} alt={merchant.name} className="h-full w-full object-contain p-2" />
          ) : (
            <ShoppingBag className="h-8 w-8 text-akiba-muted" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">{merchant.name}</h1>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-akiba-muted">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {merchant.country}
            </span>
            {merchant.support_email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" /> {merchant.support_email}
              </span>
            )}
          </div>
          {merchant.delivery_cities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {merchant.delivery_cities.map((city) => (
                <span key={city} className="rounded-full bg-akiba-card px-2.5 py-0.5 text-xs text-akiba-muted">
                  {city}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-akiba-tint px-4 py-2 text-center">
          <p className="text-xs text-akiba-muted">Earn per order</p>
          <MilesAmount amount={200} size="lg" prefix="+" className="text-akiba-teal" />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr,320px]">
        {/* Products */}
        <div>
          {products.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-12 text-center">
              <ShoppingBag className="mb-3 h-10 w-10 text-akiba-line" />
              <p className="font-medium text-akiba-ink">No products listed yet</p>
              <p className="mt-1 text-sm text-akiba-muted">Check back soon.</p>
            </div>
          ) : (
            categories.map((cat) => (
              <section key={cat} className="mb-8">
                <h2 className="mb-4 font-sterling text-lg font-semibold text-akiba-ink">
                  {CATEGORY_LABELS[cat] ?? cat}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {byCategory[cat].map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      merchant={merchant}
                      voucher_templates={voucher_templates}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Vouchers sidebar */}
        {voucher_templates.length > 0 && (
          <aside>
            <div className="sticky top-24 rounded-2xl border border-akiba-line bg-white p-5">
              <h2 className="mb-4 flex items-center gap-2 font-sterling text-lg font-semibold text-akiba-ink">
                <Tag className="h-5 w-5 text-akiba-teal" /> Vouchers
              </h2>
              <p className="mb-4 text-xs text-akiba-muted">
                Burn miles to unlock discounts. Apply at checkout.
              </p>
              <div className="space-y-3">
                {voucher_templates.map((t) => (
                  <VoucherTemplateRow key={t.id} template={t} />
                ))}
              </div>
              <div className="mt-4 rounded-xl bg-akiba-tint px-3 py-2.5 text-xs text-akiba-muted">
                Connect your wallet to issue vouchers with your miles.
              </div>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

function ProductCard({
  product,
  merchant,
  voucher_templates,
}: {
  product: Product;
  merchant: Merchant;
  voucher_templates: VoucherTemplate[];
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/30 hover:shadow-chip">
      {/* Image */}
      <div className="flex h-40 items-center justify-center bg-akiba-card">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white">
            <ShoppingBag className="h-7 w-7 text-akiba-muted" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-akiba-muted">
          {CATEGORY_LABELS[product.category] ?? product.category}
        </span>
        <h3 className="font-semibold text-akiba-ink">{product.name}</h3>
        {product.description && (
          <p className="mt-1 flex-1 text-xs leading-relaxed text-akiba-muted line-clamp-2">
            {product.description}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="font-sterling text-xl font-semibold text-akiba-ink">
            ${product.price_cusd.toFixed(2)}
          </span>
          <MilesAmount amount={200} size="xs" prefix="+" className="text-akiba-teal" />
        </div>

        <AddToCart
          product={{ id: product.id, name: product.name, price: product.price_cusd, category: product.category, imageUrl: product.image_url }}
          merchant={{ id: merchant.id, slug: merchant.slug, name: merchant.name, walletAddress: merchant.wallet_address }}
        />
      </div>
    </div>
  );
}

function VoucherTemplateRow({ template: t }: { template: VoucherTemplate }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-akiba-card p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-akiba-teal/10">
        <Tag className="h-4 w-4 text-akiba-teal" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-akiba-ink truncate">{t.title}</p>
        <p className="text-xs text-akiba-teal">{voucherLabel(t)}</p>
        {t.applicable_category && (
          <p className="text-[11px] text-akiba-muted">For {t.applicable_category} only</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-akiba-ink">{t.miles_cost.toLocaleString()}</p>
        <p className="text-[11px] text-akiba-muted">miles</p>
      </div>
    </div>
  );
}
