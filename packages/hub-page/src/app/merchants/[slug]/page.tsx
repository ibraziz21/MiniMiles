import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import {
  Store, Tag, Mail, Phone, MessageCircle, Globe, ArrowLeft,
  Instagram, Facebook, Navigation, ShoppingBag, BadgeCheck,
} from "lucide-react";
import { buildDirectionsUrl, formatAddress } from "@/lib/merchants/directions";
import { BranchCard } from "@/components/merchants/BranchCard";
import { VoucherCard } from "@/components/merchants/VoucherCard";
import { AddToCart } from "@/app/shop/[slug]/AddToCart";
import { TrackedAnchor } from "@/components/TrackedAnchor";
import { MerchantViewTracker } from "@/components/merchants/MerchantViewTracker";
import type { PublicMerchantDetail } from "@/lib/merchants/types";

// A live-inventory merchant profile (publish state, hours, vouchers,
// storefront) must never be served from a stale static/ISR cache, and must
// never be statically executed at build time.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hub.akibamiles.com";

async function getSignedInUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function safeGetMerchant(slug: string): Promise<PublicMerchantDetail | null | "unavailable"> {
  const userId = await getSignedInUserId();
  try {
    return await getPublicMerchant(slug, userId);
  } catch (err) {
    if (err instanceof DirectoryUnavailableError) return "unavailable";
    throw err;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const merchant = await safeGetMerchant(params.slug);
  if (!merchant || merchant === "unavailable") {
    return { title: "Merchant — Akiba Pass" };
  }

  const title = `${merchant.name} — Akiba Pass`;
  const description = merchant.shortDescription ?? undefined;
  const image = merchant.bannerUrl ?? merchant.logoUrl ?? undefined;
  const url = `${SITE_URL}/merchants/${merchant.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  electronics: "Electronics", accessories: "Accessories", services: "Services",
  airtime: "Airtime", gift_cards: "Gift Cards", clothing: "Clothing",
  food: "Food & Drinks", general: "General",
};

function OperatingBadges({ operatingModel, storeActive }: { operatingModel: string; storeActive: boolean }) {
  return (
    <div className="flex gap-1.5">
      {(operatingModel === "physical" || operatingModel === "hybrid") && (
        <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2.5 py-0.5 text-[11px] font-medium text-akiba-muted">
          <Store className="h-3 w-3" /> In store
        </span>
      )}
      {(operatingModel === "online" || operatingModel === "hybrid") && storeActive && (
        <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2.5 py-0.5 text-[11px] font-medium text-akiba-muted">
          <Globe className="h-3 w-3" /> Online
        </span>
      )}
    </div>
  );
}

function LocalBusinessJsonLd({ merchant }: { merchant: PublicMerchantDetail }) {
  const primary = merchant.locations.find((l) => l.isPrimary) ?? merchant.locations[0];
  if (!primary) return null;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: merchant.name,
    url: `${SITE_URL}/merchants/${merchant.slug}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: formatAddress(primary),
      addressLocality: primary.city,
      addressCountry: primary.countryCode,
    },
  };
  if (merchant.logoUrl) jsonLd.image = merchant.logoUrl;
  if (merchant.contacts.phone) jsonLd.telephone = merchant.contacts.phone;
  if (primary.latitude != null && primary.longitude != null) {
    jsonLd.geo = { "@type": "GeoCoordinates", latitude: primary.latitude, longitude: primary.longitude };
  }

  return (
    <script
      type="application/ld+json"
      // Built only from already-public fields returned by get_public_merchant.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function MerchantPage({ params }: { params: { slug: string } }) {
  const result = await safeGetMerchant(params.slug);

  if (result === "unavailable") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <Store className="mx-auto mb-4 h-12 w-12 text-akiba-line" />
        <h1 className="font-sterling text-xl font-semibold text-akiba-ink">Merchant temporarily unavailable</h1>
        <p className="mt-2 text-sm text-akiba-muted">Something went wrong loading this profile. Please try again shortly.</p>
        <a href={`/merchants/${params.slug}`} className="mt-4 inline-block rounded-full bg-akiba-teal px-5 py-2 text-sm font-semibold text-white">
          Retry
        </a>
      </main>
    );
  }

  const merchant = result;
  if (!merchant) notFound();

  const isSignedIn = !!(await getSignedInUserId());

  const byCategory = merchant.products.reduce<Record<string, typeof merchant.products>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});
  const productCategories = Object.keys(byCategory).sort();
  const showShopOnline = merchant.storeActive && merchant.products.length > 0;
  const hasPhysicalLocation = merchant.locations.length > 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <MerchantViewTracker
        merchantId={merchant.id}
        hasVouchers={merchant.vouchers.length > 0}
        hasShopOnline={showShopOnline}
      />
      {hasPhysicalLocation && <LocalBusinessJsonLd merchant={merchant} />}

      <a href="/merchants" className="mb-6 flex items-center gap-1.5 text-sm text-akiba-muted hover:text-akiba-ink">
        <ArrowLeft className="h-4 w-4" /> All merchants
      </a>

      {/* Banner */}
      {merchant.bannerUrl && (
        <div className="mb-6 h-32 w-full overflow-hidden rounded-2xl bg-akiba-card sm:h-48">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={merchant.bannerUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-akiba-line bg-white">
          {merchant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={merchant.logoUrl} alt={merchant.name} className="h-full w-full object-contain p-2" />
          ) : (
            <Store className="h-8 w-8 text-akiba-muted" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">{merchant.name}</h1>
            <span
              className="flex items-center gap-1 rounded-full bg-akiba-tint px-2 py-0.5 text-[11px] font-semibold text-akiba-teal"
              title="Verified AkibaMiles merchant"
            >
              <BadgeCheck className="h-3.5 w-3.5" /> Verified
            </span>
          </div>
          {merchant.shortDescription && <p className="mt-1 text-sm text-akiba-muted">{merchant.shortDescription}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {merchant.primaryCategory && (
              <span className="rounded-full bg-akiba-tint px-2.5 py-0.5 text-xs font-semibold text-akiba-teal">
                {merchant.primaryCategory.name}
              </span>
            )}
            {merchant.categories
              .filter((c) => c.slug !== merchant.primaryCategory?.slug)
              .map((c) => (
                <span key={c.slug} className="rounded-full bg-akiba-card px-2.5 py-0.5 text-xs text-akiba-muted">
                  {c.name}
                </span>
              ))}
            <OperatingBadges operatingModel={merchant.operatingModel} storeActive={merchant.storeActive} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
          {merchant.primaryLocation && (
            <TrackedAnchor
              event="merchant_directions_tap"
              eventProps={{ merchantId: merchant.id }}
              href={buildDirectionsUrl(merchant.locations.find((l) => l.isPrimary) ?? merchant.locations[0])}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Navigation className="h-4 w-4" /> Directions
            </TrackedAnchor>
          )}
          {merchant.contacts.phone && (
            <TrackedAnchor
              event="merchant_call_tap"
              eventProps={{ merchantId: merchant.id }}
              href={`tel:${merchant.contacts.phone}`}
              className="flex items-center justify-center gap-1.5 rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-semibold text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Phone className="h-4 w-4" /> Call
            </TrackedAnchor>
          )}
          {merchant.contacts.whatsapp && (
            <TrackedAnchor
              event="merchant_whatsapp_tap"
              eventProps={{ merchantId: merchant.id }}
              href={`https://wa.me/${merchant.contacts.whatsapp.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-semibold text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </TrackedAnchor>
          )}
          {merchant.vouchers.length > 0 && (
            <a href="#vouchers" className="flex items-center justify-center gap-1.5 rounded-full border border-akiba-teal/30 bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal">
              <Tag className="h-4 w-4" /> View vouchers
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr,320px]">
        <div className="space-y-10">
          {/* Visit us / Branches */}
          {merchant.locations.length > 0 && (
            <section>
              <h2 className="mb-4 font-sterling text-lg font-semibold text-akiba-ink">
                {merchant.locations.length === 1 ? "Visit us" : "Branches"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {merchant.locations.map((loc) => (
                  <BranchCard key={loc.id} location={loc} />
                ))}
              </div>
            </section>
          )}

          {/* What they offer */}
          {merchant.coreOfferings.length > 0 && (
            <section>
              <h2 className="mb-4 font-sterling text-lg font-semibold text-akiba-ink">What they offer</h2>
              <div className="flex flex-wrap gap-2">
                {merchant.coreOfferings.map((o) => (
                  <span key={o.id} className="rounded-full border border-akiba-line bg-white px-3 py-1.5 text-sm text-akiba-ink" title={o.description ?? undefined}>
                    {o.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* About */}
          {merchant.description && (
            <section>
              <h2 className="mb-3 font-sterling text-lg font-semibold text-akiba-ink">About</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-akiba-muted">{merchant.description}</p>
            </section>
          )}

          {/* Shop online */}
          {showShopOnline && (
            <section>
              <h2 className="mb-4 font-sterling text-lg font-semibold text-akiba-ink">Shop online</h2>
              {productCategories.map((cat) => (
                <div key={cat} className="mb-8">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {byCategory[cat].map((product) => (
                      <div key={product.id} className="flex flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white">
                        <div className="flex h-40 items-center justify-center bg-akiba-card">
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                          ) : (
                            <ShoppingBag className="h-10 w-10 text-akiba-muted" />
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-4">
                          <h4 className="font-semibold text-akiba-ink">{product.name}</h4>
                          {product.description && (
                            <p className="mt-1 flex-1 text-xs leading-relaxed text-akiba-muted line-clamp-2">{product.description}</p>
                          )}
                          <div className="mt-3 flex items-center justify-between">
                            <span className="font-sterling text-xl font-semibold text-akiba-ink">${product.priceCusd.toFixed(2)}</span>
                          </div>
                          <AddToCart
                            product={{
                              id: product.id, name: product.name, price: product.priceCusd,
                              category: product.category, imageUrl: product.imageUrl, productType: product.productType,
                            }}
                            merchant={{ id: merchant.id, slug: merchant.slug, name: merchant.name }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {/* Vouchers */}
          {merchant.vouchers.length > 0 && (
            <div id="vouchers" className="rounded-2xl border border-akiba-line bg-white p-5">
              <h2 className="mb-4 flex items-center gap-2 font-sterling text-lg font-semibold text-akiba-ink">
                <Tag className="h-5 w-5 text-akiba-teal" /> Vouchers
              </h2>
              <p className="mb-4 text-xs text-akiba-muted">Burn miles to unlock offers at this merchant.</p>
              <div className="space-y-3">
                {merchant.vouchers.map((v) => (
                  <VoucherCard key={v.id} voucher={v} locations={merchant.locations} isSignedIn={isSignedIn} />
                ))}
              </div>
            </div>
          )}

          {/* Contact */}
          <div className="rounded-2xl border border-akiba-line bg-white p-5">
            <h2 className="mb-4 font-sterling text-lg font-semibold text-akiba-ink">Contact</h2>
            <div className="space-y-2.5 text-sm">
              {merchant.contacts.phone && (
                <a href={`tel:${merchant.contacts.phone}`} className="flex items-center gap-2 text-akiba-ink hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal" aria-label={`Call ${merchant.name}`}>
                  <Phone className="h-4 w-4 text-akiba-muted" /> {merchant.contacts.phone}
                </a>
              )}
              {merchant.contacts.whatsapp && (
                <a
                  href={`https://wa.me/${merchant.contacts.whatsapp.replace(/[^\d]/g, "")}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-akiba-ink hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
                  aria-label={`Message ${merchant.name} on WhatsApp`}
                >
                  <MessageCircle className="h-4 w-4 text-akiba-muted" /> WhatsApp
                </a>
              )}
              {merchant.contacts.email && (
                <a href={`mailto:${merchant.contacts.email}`} className="flex items-center gap-2 text-akiba-ink hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal" aria-label={`Email ${merchant.name}`}>
                  <Mail className="h-4 w-4 text-akiba-muted" /> {merchant.contacts.email}
                </a>
              )}
              {merchant.websiteUrl && (
                <TrackedAnchor
                  event="merchant_website_tap"
                  eventProps={{ merchantId: merchant.id }}
                  href={merchant.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-akiba-ink hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
                  aria-label={`${merchant.name} website`}
                >
                  <Globe className="h-4 w-4 text-akiba-muted" /> Website
                </TrackedAnchor>
              )}
              {merchant.contacts.instagram && (
                <a href={merchant.contacts.instagram} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-akiba-ink hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal" aria-label={`${merchant.name} on Instagram`}>
                  <Instagram className="h-4 w-4 text-akiba-muted" /> Instagram
                </a>
              )}
              {merchant.contacts.facebook && (
                <a href={merchant.contacts.facebook} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-akiba-ink hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal" aria-label={`${merchant.name} on Facebook`}>
                  <Facebook className="h-4 w-4 text-akiba-muted" /> Facebook
                </a>
              )}
              {!merchant.contacts.phone &&
                !merchant.contacts.whatsapp &&
                !merchant.contacts.email &&
                !merchant.websiteUrl &&
                !merchant.contacts.instagram &&
                !merchant.contacts.facebook && (
                  <p className="text-akiba-muted">No public contact provided.</p>
                )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
