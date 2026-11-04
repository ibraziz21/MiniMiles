import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Store, Ticket } from "lucide-react";
import { Eyebrow } from "@/components/Eyebrow";
import { Panel } from "@/components/Panel";
import { SectionHeader } from "@/components/SectionHeader";
import { ButtonLink } from "@/components/ButtonLink";
import { DirectoryUnavailable, listDirectoryMerchants } from "@/lib/directory/client";
import { siteConfig } from "@/content/site";
import type { DirectoryMerchantSummary } from "@/lib/directory/types";

export const metadata: Metadata = {
  title: "Shops on Akiba",
  description:
    "Browse businesses on Akiba in Kenya — what they sell, where to find them, their current offers, and the vouchers you can get with AkibaMiles.",
  alternates: { canonical: `${siteConfig.siteUrl}/shops` },
};

// The directory is live inventory: publish state, offers and voucher
// availability all change without a deploy. The underlying API is cached for
// five minutes, which is where the actual caching happens.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

function locationLabel(merchant: DirectoryMerchantSummary): string | null {
  if (!merchant.primaryLocation) {
    return merchant.operatingModel === "online" ? "Online" : null;
  }
  const { locality, city } = merchant.primaryLocation;
  return locality ? `${locality}, ${city}` : city;
}

function ShopCard({ merchant }: { merchant: DirectoryMerchantSummary }) {
  const where = locationLabel(merchant);

  return (
    <Link
      href={`/shops/${merchant.slug}`}
      className="flex flex-col gap-3 rounded-2xl border border-akiba-line bg-white p-5 no-underline transition hover:border-akiba-teal/40 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        {merchant.logoUrl ? (
          // Merchant image URLs are validated as https but not host-restricted
          // (see safePublicImageUrl in the Pass app), so next/image would
          // either need every storage host in remotePatterns or a wildcard
          // that turns this site into an open image proxy. Fixed dimensions
          // and lazy loading keep the cost of a plain img down.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={merchant.logoUrl}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded-xl border border-akiba-line object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-akiba-line bg-akiba-paper">
            <Store className="h-5 w-5 text-akiba-muted" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-sterling text-lg font-medium leading-6 text-akiba-ink">
            {merchant.name}
          </h3>
          {merchant.primaryCategory && (
            <p className="mt-0.5 text-sm text-akiba-muted">{merchant.primaryCategory.name}</p>
          )}
        </div>
      </div>

      {merchant.shortDescription && (
        <p className="line-clamp-3 text-sm leading-6 text-akiba-muted">
          {merchant.shortDescription}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-akiba-muted">
        {where && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4" aria-hidden />
            {where}
          </span>
        )}
        {merchant.branchCount > 1 && <span>{merchant.branchCount} branches</span>}
        {merchant.voucherCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Ticket className="h-4 w-4" aria-hidden />
            {merchant.voucherCount} {merchant.voucherCount === 1 ? "voucher" : "vouchers"}
          </span>
        )}
      </div>
    </Link>
  );
}

export default async function ShopsPage() {
  let merchants: DirectoryMerchantSummary[] = [];
  let unavailable = false;

  try {
    const result = await listDirectoryMerchants({ limit: PAGE_SIZE });
    merchants = result.merchants;
  } catch (error) {
    // A directory outage must not take the page down — it still explains what
    // Akiba is and links onward. Returning a 200 with an honest notice beats
    // a 500 that search engines record as a broken URL.
    if (!(error instanceof DirectoryUnavailable)) throw error;
    unavailable = true;
  }

  const cities = Array.from(
    new Set(
      merchants
        .map((m) => m.primaryLocation?.city)
        .filter((city): city is string => Boolean(city))
    )
  ).sort();

  return (
    <main>
      <Panel tone="wash" bare>
        <div className="px-5 py-12 sm:px-10 sm:py-16 lg:px-14">
          <SectionHeader
            eyebrow="Shops on Akiba"
            title="Find shops worth going to, and get rewarded for going."
            body="Every business here issues AkibaMiles at the counter. Browse what they sell, where to find them, and what you can get with the Miles you earn."
            as="h1"
          />
          {cities.length > 0 && (
            <p className="mt-6 text-sm text-akiba-muted">
              Currently in {cities.join(", ")}.
            </p>
          )}
        </div>
      </Panel>

      <Panel>
        {unavailable ? (
          <div className="rounded-2xl border border-akiba-line bg-akiba-paper p-8 text-center">
            <Store className="mx-auto mb-3 h-10 w-10 text-akiba-muted" aria-hidden />
            <h2 className="font-sterling text-xl font-medium text-akiba-ink">
              The shop directory is temporarily unavailable
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-akiba-muted">
              Something went wrong loading the list. You can still browse every shop in the Akiba
              Pass app while we sort it out.
            </p>
            <ButtonLink href={siteConfig.passUrl} className="mt-5">
              Open Akiba Pass
            </ButtonLink>
          </div>
        ) : merchants.length === 0 ? (
          <div className="rounded-2xl border border-akiba-line bg-akiba-paper p-8 text-center">
            <h2 className="font-sterling text-xl font-medium text-akiba-ink">
              No shops listed here yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-akiba-muted">
              We publish a shop here once it has its full details — what it sells, where it is, and
              its opening hours. More are on the way.
            </p>
            <ButtonLink href="/for-business" variant="secondary" className="mt-5">
              Put your business on Akiba
            </ButtonLink>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {merchants.map((merchant) => (
              <ShopCard key={merchant.slug} merchant={merchant} />
            ))}
          </div>
        )}
      </Panel>

      <Panel tone="teal">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Eyebrow tone="onDark">Earning Miles</Eyebrow>
            <h2 className="mt-3 font-sterling text-2xl font-medium">
              Show your Pass at the counter to start earning.
            </h2>
            <p className="mt-2 max-w-xl leading-7 text-white/75">
              AkibaMiles are funded by the business you&apos;re shopping with, and you spend them on
              vouchers at shops like these.
            </p>
          </div>
          <ButtonLink href={siteConfig.passUrl} variant="onDark" className="shrink-0">
            Get your Akiba Pass
          </ButtonLink>
        </div>
      </Panel>
    </main>
  );
}
