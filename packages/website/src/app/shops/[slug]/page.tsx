import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Clock, Facebook, Globe, Instagram, MapPin, Navigation, Phone, Store, Ticket,
} from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { Eyebrow } from "@/components/Eyebrow";
import { Panel } from "@/components/Panel";
import { getDirectoryMerchant } from "@/lib/directory/client";
import { formatWeekHours } from "@/lib/directory/hours";
import { buildBreadcrumbJsonLd, buildShopJsonLd, serializeJsonLd } from "@/lib/directory/seo";
import { siteConfig } from "@/content/site";
import type {
  DirectoryLocation,
  DirectoryMerchantProfile,
  DirectoryOffer,
  DirectoryVoucher,
} from "@/lib/directory/types";

// Live inventory — offers and vouchers change without a deploy. The
// directory API is cached for five minutes, which is where caching belongs.
export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * An outage must not be served as a 404: that teaches search engines the
 * profile is gone. `DirectoryUnavailable` is deliberately left to propagate,
 * so the request fails loudly and is retried, and only a genuine "no such
 * profile" — a null body, meaning the API answered 404 — reaches `notFound`.
 */
async function loadMerchant(slug: string): Promise<DirectoryMerchantProfile> {
  const merchant = await getDirectoryMerchant(slug);
  if (!merchant) notFound();
  return merchant;
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  let merchant: DirectoryMerchantProfile | null = null;
  try {
    merchant = await getDirectoryMerchant(params.slug);
  } catch {
    // Metadata must never be the reason a page fails; the body will raise the
    // outage, and this placeholder is noindexed so a blip can't be indexed.
    return { title: "Shop on Akiba", robots: { index: false, follow: true } };
  }
  if (!merchant) return { title: "Shop not found", robots: { index: false, follow: true } };

  const where = merchant.locations[0]?.city ?? null;
  const category = merchant.primaryCategory?.name;
  const title = where && category ? `${merchant.name} — ${category} in ${where}` : merchant.name;
  const description =
    merchant.shortDescription ??
    merchant.description ??
    `${merchant.name} issues AkibaMiles when you shop. See what they sell, where to find them and their current offers.`;
  const canonical = `${siteConfig.siteUrl}/shops/${merchant.slug}`;
  const image = merchant.bannerUrl ?? merchant.logoUrl ?? undefined;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
  };
}

function offerWhen(offer: DirectoryOffer): string {
  if (offer.schedule === "always") return "Always on";
  const days = offer.daysOfWeek.map((d) => DAY_NAMES[d] ?? "").filter(Boolean).join(", ");
  const time = offer.startTime && offer.endTime ? ` · ${offer.startTime}–${offer.endTime}` : "";
  return days ? `${days}${time}` : "Selected days";
}

function voucherValue(voucher: DirectoryVoucher): string {
  if (voucher.voucherType === "percent_off" && voucher.discountPercent != null) {
    return `${voucher.discountPercent}% off`;
  }
  if (voucher.voucherType === "fixed_off" && voucher.discountCusd != null) {
    return `${voucher.discountCusd} off`;
  }
  return "Free item";
}

function BranchCard({ location }: { location: DirectoryLocation }) {
  const week = formatWeekHours(location.openingHours);

  return (
    <div className="rounded-2xl border border-akiba-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-sterling text-lg font-medium text-akiba-ink">{location.name}</h3>
        {location.isPrimary && <Eyebrow className="shrink-0 px-3 py-1 text-xs">Main</Eyebrow>}
      </div>

      <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-akiba-muted">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {location.streetAddress}
          {location.streetAddress && ", "}
          {location.city}
          {location.landmark && (
            <>
              <br />
              <span className="text-akiba-muted/80">Near {location.landmark}</span>
            </>
          )}
        </span>
      </p>

      {week.length > 0 && (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-akiba-ink">
            <Clock className="h-4 w-4" aria-hidden />
            Opening hours
          </p>
          <dl className="mt-2 space-y-1 text-sm text-akiba-muted">
            {week.map((day) => (
              <div key={day.label} className="flex items-baseline justify-between gap-4">
                <dt>{day.label}</dt>
                <dd className="tabular-nums">{day.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <a
        href={location.directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline"
      >
        <Navigation className="h-4 w-4" aria-hidden />
        Get directions
      </a>
    </div>
  );
}

export default async function ShopProfilePage({ params }: { params: { slug: string } }) {
  const merchant = await loadMerchant(params.slug);
  const canonical = `${siteConfig.siteUrl}/shops/${merchant.slug}`;
  const jsonLd = buildShopJsonLd(merchant, canonical);
  const breadcrumbs = buildBreadcrumbJsonLd(merchant, siteConfig.siteUrl);

  const businessPhotos = merchant.media.filter((m) => m.kind === "business");
  const productPhotos = merchant.media.filter((m) => m.kind === "product");
  const labels = Array.from(
    new Set(merchant.verifiedVisits.flatMap((visit) => visit.experienceLabels))
  );

  return (
    <main>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbs) }}
      />

      <Panel tone="wash" bare>
        <div className="px-5 py-10 sm:px-10 sm:py-14 lg:px-14">
          <Link
            href="/shops"
            className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All shops
          </Link>

          <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
            {merchant.logoUrl ? (
              // Merchant image hosts are not restricted to a known set, so
              // next/image would need a remotePatterns wildcard — an open
              // image proxy. Explicit dimensions keep this from shifting.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merchant.logoUrl}
                alt=""
                width={72}
                height={72}
                className="h-16 w-16 shrink-0 rounded-2xl border border-akiba-line object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-akiba-line bg-white">
                <Store className="h-7 w-7 text-akiba-muted" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <h1 className="font-sterling text-3xl font-medium leading-tight text-akiba-ink sm:text-4xl">
                {merchant.name}
              </h1>
              <p className="mt-2 text-akiba-muted">
                {[merchant.primaryCategory?.name, merchant.locations[0]?.city]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {merchant.shortDescription && (
                <p className="mt-4 max-w-2xl text-lg leading-8 text-akiba-ink/80">
                  {merchant.shortDescription}
                </p>
              )}
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href={siteConfig.passUrl}>Earn Miles here</ButtonLink>
            {merchant.locations[0] && (
              <ButtonLink
                href={merchant.locations[0].directionsUrl}
                variant="secondary"
                className="inline-flex items-center gap-2"
              >
                <Navigation className="h-4 w-4" aria-hidden />
                Directions
              </ButtonLink>
            )}
          </div>
        </div>
      </Panel>

      {merchant.description && (
        <Panel>
          <h2 className="font-sterling text-2xl font-medium text-akiba-ink">About</h2>
          <p className="mt-3 max-w-3xl whitespace-pre-line text-base leading-8 text-akiba-muted">
            {merchant.description}
          </p>
        </Panel>
      )}

      {merchant.coreOfferings.length > 0 && (
        <Panel tone="paper">
          <h2 className="font-sterling text-2xl font-medium text-akiba-ink">What they sell</h2>
          <ul className="mt-4 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {merchant.coreOfferings.map((offering) => (
              <li
                key={offering.name}
                className="rounded-2xl border border-akiba-line bg-white p-4"
              >
                <p className="font-semibold text-akiba-ink">{offering.name}</p>
                {offering.description && (
                  <p className="mt-1 text-sm leading-6 text-akiba-muted">{offering.description}</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {merchant.offers.length > 0 && (
        <Panel>
          <h2 className="font-sterling text-2xl font-medium text-akiba-ink">Current offers</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {merchant.offers.map((offer) => (
              <div key={offer.title} className="rounded-2xl border border-akiba-line bg-white p-5">
                <p className="font-sterling text-lg font-medium text-akiba-ink">{offer.title}</p>
                <p className="mt-1 text-sm font-semibold text-akiba-teal">{offerWhen(offer)}</p>
                <p className="mt-2 text-sm leading-6 text-akiba-muted">{offer.description}</p>
                {offer.terms && (
                  <p className="mt-3 text-xs leading-5 text-akiba-muted/80">{offer.terms}</p>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {merchant.vouchers.length > 0 && (
        <Panel tone="paper">
          <h2 className="font-sterling text-2xl font-medium text-akiba-ink">
            What you can get with Miles
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-akiba-muted">
            Earn AkibaMiles when you shop here, then claim these in the Akiba Pass app.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {merchant.vouchers.map((voucher) => (
              <div
                key={voucher.title}
                className="flex flex-col rounded-2xl border border-akiba-line bg-white p-5"
              >
                <Ticket className="h-5 w-5 text-akiba-teal" aria-hidden />
                <p className="mt-3 font-semibold text-akiba-ink">{voucher.title}</p>
                <p className="mt-1 text-sm text-akiba-muted">{voucherValue(voucher)}</p>
                <p className="mt-3 text-sm font-semibold text-akiba-ink">
                  {voucher.milesCost.toLocaleString()} Miles
                </p>
              </div>
            ))}
          </div>
          <ButtonLink href={siteConfig.passUrl} className="mt-6">
            Claim in Akiba Pass
          </ButtonLink>
        </Panel>
      )}

      {(businessPhotos.length > 0 || productPhotos.length > 0) && (
        <Panel>
          <h2 className="font-sterling text-2xl font-medium text-akiba-ink">Photos</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...businessPhotos, ...productPhotos].map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.imageUrl}
                src={photo.imageUrl}
                alt={photo.altText}
                loading="lazy"
                className="aspect-[4/3] w-full rounded-2xl border border-akiba-line object-cover"
              />
            ))}
          </div>
        </Panel>
      )}

      {(merchant.verifiedVisitFavoriteProduct || labels.length > 0) && (
        <Panel tone="paper">
          <Eyebrow>From verified visits</Eyebrow>
          <h2 className="mt-3 font-sterling text-2xl font-medium text-akiba-ink">
            What customers say
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-akiba-muted">
            Only people whose visit we could verify can leave these.
          </p>
          {merchant.verifiedVisitFavoriteProduct && (
            <p className="mt-4 text-lg text-akiba-ink">
              Most recommended: <strong>{merchant.verifiedVisitFavoriteProduct}</strong>
            </p>
          )}
          {labels.length > 0 && (
            <ul className="mt-4 flex list-none flex-wrap gap-2 p-0">
              {labels.map((label) => (
                <li key={label}>
                  <Eyebrow className="px-3 py-1 text-sm">{label}</Eyebrow>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {merchant.locations.length > 0 && (
        <Panel>
          <h2 className="font-sterling text-2xl font-medium text-akiba-ink">
            {merchant.locations.length === 1 ? "Where to find them" : "Branches"}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {merchant.locations.map((location) => (
              <BranchCard key={location.id} location={location} />
            ))}
          </div>
        </Panel>
      )}

      <Panel tone="paper">
        <h2 className="font-sterling text-2xl font-medium text-akiba-ink">Get in touch</h2>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {merchant.contacts.phone && (
            <a
              href={`tel:${merchant.contacts.phone}`}
              className="inline-flex items-center gap-2 font-semibold text-akiba-teal no-underline"
            >
              <Phone className="h-4 w-4" aria-hidden />
              {merchant.contacts.phone}
            </a>
          )}
          {merchant.websiteUrl && (
            <a
              href={merchant.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-semibold text-akiba-teal no-underline"
            >
              <Globe className="h-4 w-4" aria-hidden />
              Website
            </a>
          )}
          {merchant.contacts.instagram && (
            <a
              href={merchant.contacts.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-semibold text-akiba-teal no-underline"
            >
              <Instagram className="h-4 w-4" aria-hidden />
              Instagram
            </a>
          )}
          {merchant.contacts.facebook && (
            <a
              href={merchant.contacts.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-semibold text-akiba-teal no-underline"
            >
              <Facebook className="h-4 w-4" aria-hidden />
              Facebook
            </a>
          )}
        </div>
      </Panel>
    </main>
  );
}
