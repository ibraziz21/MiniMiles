import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import {
  Store, Mail, Phone, MessageCircle, Globe, ArrowLeft,
  Instagram, Facebook, Navigation,
} from "lucide-react";
import { buildDirectionsUrl, formatAddress } from "@/lib/merchants/directions";
import { BranchCard } from "@/components/merchants/BranchCard";
import { VoucherCard } from "@/components/merchants/VoucherCard";
import { OperatingBadges } from "@/components/merchants/OperatingBadges";
import { SaveMerchantButton } from "@/components/merchants/SaveMerchantButton";
import { TrackedAnchor } from "@/components/TrackedAnchor";
import { MerchantViewTracker } from "@/components/merchants/MerchantViewTracker";
import { MerchantPhotoTabs } from "@/components/merchants/MerchantPhotoTabs";
import { MerchantFundedVoucherCard } from "@/components/merchants/MerchantFundedVoucherCard";
import { MerchantProfileDisclosure } from "@/components/merchants/MerchantProfileDisclosure";
import { getSignedInBalance } from "@/lib/merchants/enrich";
import { getMemberVerifiedVisitSummary, hasOpenMerchantContributionRequest } from "@/lib/merchants/memberVisits";
import { isMerchantSaved } from "@/lib/merchants/savedMerchants";
import { rankMerchantFundedOffers, rankMerchantVouchers } from "@/lib/merchants/voucherRanking";
import {
  getClaimedMerchantFundedAllocationIds,
  getMerchantFundedOffers,
} from "@/lib/vouchers/merchantFundedOffers.server";
import type { PublicMerchantDetail } from "@/lib/merchants/types";

// A live-inventory merchant profile (publish state, hours, vouchers,
// storefront) must never be served from a stale static/ISR cache, and must
// never be statically executed at build time.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hub.akibamiles.com";

async function getSignedInIdentity(): Promise<{ userId: string | null; email: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { userId: user?.id ?? null, email: user?.email ?? null };
}

async function safeGetMerchant(
  slug: string,
  userId: string | null
): Promise<PublicMerchantDetail | null | "unavailable"> {
  try {
    return await getPublicMerchant(slug, userId);
  } catch (err) {
    if (err instanceof DirectoryUnavailableError) return "unavailable";
    throw err;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const { userId } = await getSignedInIdentity();
  const merchant = await safeGetMerchant(params.slug, userId);
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
  const { userId, email } = await getSignedInIdentity();
  const [result, balance] = await Promise.all([
    safeGetMerchant(params.slug, userId),
    getSignedInBalance(userId, email),
  ]);

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

  const isSignedIn = !!userId;
  const fundedOffers = await getMerchantFundedOffers(merchant.id);
  const rankedMilesVouchers = rankMerchantVouchers(merchant.vouchers, balance);
  const claimedFundedAllocationIds = await getClaimedMerchantFundedAllocationIds(
    fundedOffers.map((offer) => offer.allocationId),
    userId,
    email,
  );
  const rankedFundedOffers = rankMerchantFundedOffers(fundedOffers, claimedFundedAllocationIds);
  const totalVoucherCount = fundedOffers.length + rankedMilesVouchers.length;
  const affordableVoucherCount =
    balance != null ? rankedMilesVouchers.filter((v) => balance >= v.milesCost).length : null;
  const [initialSaved, memberVerifiedVisit, canAddVerifiedVisit] = userId
    ? await Promise.all([
        isMerchantSaved(userId, merchant.id),
        getMemberVerifiedVisitSummary(userId, merchant.id),
        hasOpenMerchantContributionRequest(userId, merchant.id),
      ])
    : [false, null, false];

  const hasPhysicalLocation = merchant.locations.length > 0;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-6 sm:py-6 lg:px-8">
      <MerchantViewTracker
        merchantId={merchant.id}
        hasVouchers={totalVoucherCount > 0}
      />
      {hasPhysicalLocation && <LocalBusinessJsonLd merchant={merchant} />}

      <a href="/merchants" className="mb-4 flex items-center gap-1.5 text-sm text-akiba-muted hover:text-akiba-ink sm:mb-6">
        <ArrowLeft className="h-4 w-4" /> All merchants
      </a>

      {/* Hero banner — full-bleed on mobile with the logo overlapping its
          bottom edge (Airbnb/Instagram-style profile hero). Falls back to
          the plain inline logo+name row below when there's no banner. */}
      {merchant.bannerUrl && (
        <div className="relative -mx-4 mb-8 h-28 overflow-hidden bg-akiba-card sm:mx-0 sm:mb-10 sm:h-48 sm:rounded-2xl lg:h-52">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={merchant.bannerUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute -bottom-6 left-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border-4 border-akiba-paper bg-white shadow-soft sm:-bottom-8 sm:h-24 sm:w-24">
            {merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={merchant.logoUrl} alt={merchant.name} className="h-full w-full object-contain p-2" />
            ) : (
              <Store className="h-8 w-8 text-akiba-muted" />
            )}
          </div>
        </div>
      )}

      {/* Profile — Instagram-style: avatar, name, bio and quick actions are
          one clean, borderless identity block (a single visual unit, not a
          stack of separate boxed sections). Content sections below (visit
          us, offers and vouchers) get cards; identity doesn't need one. */}
      <div className="pb-3 sm:pb-5">
        <div className="flex items-start gap-3">
          {!merchant.bannerUrl && (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-akiba-line bg-white">
              {merchant.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={merchant.logoUrl} alt={merchant.name} className="h-full w-full object-contain p-2" />
              ) : (
                <Store className="h-8 w-8 text-akiba-muted" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="relative">
              <h1 className="pr-12 font-sterling text-xl font-semibold leading-tight text-akiba-ink sm:text-2xl">{merchant.name}</h1>
              <div className="absolute right-0 top-0">
                <SaveMerchantButton slug={merchant.slug} isSignedIn={isSignedIn} initialSaved={initialSaved} />
              </div>
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
              <OperatingBadges operatingModel={merchant.operatingModel} />
            </div>
          </div>
        </div>

        <MerchantProfileDisclosure description={merchant.description} offerings={merchant.coreOfferings} />

        {/* Quick actions — one row, always visible (no desktop-only column,
            no separate floating bar, no boxed "Contact" card). Directions/
            Call/WhatsApp/Website are labeled; Instagram/Facebook/Email are
            compact icon-only since they're secondary. */}
        <div className="-mx-4 mt-3 flex snap-x snap-mandatory flex-nowrap items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {merchant.primaryLocation && (
            <TrackedAnchor
              event="merchant_directions_tap"
              eventProps={{ merchantId: merchant.id }}
              href={buildDirectionsUrl(merchant.locations.find((l) => l.isPrimary) ?? merchant.locations[0])}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 snap-start items-center justify-center gap-1.5 rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Navigation className="h-4 w-4" /> Directions
            </TrackedAnchor>
          )}
          {merchant.contacts.phone && (
            <TrackedAnchor
              event="merchant_call_tap"
              eventProps={{ merchantId: merchant.id }}
              href={`tel:${merchant.contacts.phone}`}
              className="flex shrink-0 snap-start items-center justify-center gap-1.5 rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-semibold text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
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
              className="flex shrink-0 snap-start items-center justify-center gap-1.5 rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-semibold text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </TrackedAnchor>
          )}
          {merchant.websiteUrl && (
            <TrackedAnchor
              event="merchant_website_tap"
              eventProps={{ merchantId: merchant.id }}
              href={merchant.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 snap-start items-center justify-center gap-1.5 rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-semibold text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Globe className="h-4 w-4" /> Website
            </TrackedAnchor>
          )}
          {merchant.contacts.instagram && (
            <a
              href={merchant.contacts.instagram}
              target="_blank" rel="noopener noreferrer"
              aria-label="Instagram" title="Instagram"
              className="flex h-9 w-9 shrink-0 snap-start items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40 hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Instagram className="h-4 w-4" />
            </a>
          )}
          {merchant.contacts.facebook && (
            <a
              href={merchant.contacts.facebook}
              target="_blank" rel="noopener noreferrer"
              aria-label="Facebook" title="Facebook"
              className="flex h-9 w-9 shrink-0 snap-start items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40 hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Facebook className="h-4 w-4" />
            </a>
          )}
          {merchant.contacts.email && (
            <a
              href={`mailto:${merchant.contacts.email}`}
              aria-label="Email" title="Email"
              className="flex h-9 w-9 shrink-0 snap-start items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40 hover:text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Mail className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      <MerchantPhotoTabs
        merchantName={merchant.name}
        merchantId={merchant.id}
        verifiedVisits={merchant.verifiedVisits}
        customerPhotos={merchant.approvedCustomerPhotos}
        merchantMedia={merchant.merchantMedia}
        memberVerifiedVisit={memberVerifiedVisit}
        contributionHref={canAddVerifiedVisit ? `/visit/merchant/${merchant.slug}` : null}
        voucherCount={totalVoucherCount}
        vouchersContent={totalVoucherCount > 0 ? (
          <>
            {affordableVoucherCount != null && rankedMilesVouchers.length > 0 && (
              <p className="mb-3 text-xs font-semibold text-akiba-teal">
                Your balance covers {affordableVoucherCount} of {rankedMilesVouchers.length} Miles voucher
                {rankedMilesVouchers.length === 1 ? "" : "s"} here.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {rankedFundedOffers.map((offer) => (
                <MerchantFundedVoucherCard
                  key={offer.allocationId}
                  offer={offer}
                  isSignedIn={isSignedIn}
                  alreadyClaimed={claimedFundedAllocationIds.has(offer.allocationId)}
                />
              ))}
              {rankedMilesVouchers.map((voucher) => (
                <VoucherCard
                  key={voucher.id}
                  voucher={voucher}
                  locations={merchant.locations}
                  isSignedIn={isSignedIn}
                  balance={balance}
                />
              ))}
            </div>
          </>
        ) : undefined}
        locationCount={merchant.locations.length}
        locationsContent={merchant.locations.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {merchant.locations.map((location) => (
              <BranchCard key={location.id} location={location} />
            ))}
          </div>
        ) : undefined}
      />
    </main>
  );
}
