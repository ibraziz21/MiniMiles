import { PlayStoreLink } from "@/components/PlayStoreLink";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BusinessOfferCard } from "@/components/home/BusinessOfferRail";
import { listPublicMerchantOffers } from "@/lib/merchants/publicOffers";
import { FundedOfferCard } from "@/components/vouchers/FundedOfferCard";
import { getClaimedAllocationIds, getFundedOffers } from "@/lib/vouchers/catalogue.server";
import { fundedDiscoveryResult } from "@/lib/vouchers/fundedDiscovery";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OffersPage() {
  const [offers, funded, { data: { user } }] = await Promise.all([
    listPublicMerchantOffers(50),
    fundedDiscoveryResult(getFundedOffers),
    (await createClient()).auth.getUser(),
  ]);
  const fundedOffers = funded.offers.filter((offer) => offer.showInBusinessOffers);
  const claimed = fundedOffers.length && user
    ? await getClaimedAllocationIds(user.id, user.email ?? null)
    : new Set<string>();

  return (
    <main className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:pt-9 lg:px-8">
      <Link href="/" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-semibold text-akiba-muted hover:text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </Link>
      <h1 className="font-sterling text-3xl font-semibold text-akiba-ink sm:text-4xl">Business offers</h1>
      <p className="mt-1 text-sm text-akiba-muted">Direct from businesses. No AkibaMiles required.</p>

      {offers.length > 0 || fundedOffers.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fundedOffers.map((offer) => (
            <FundedOfferCard key={offer.allocationId} offer={offer} isSignedIn={Boolean(user)} alreadyClaimed={claimed.has(offer.allocationId)} />
          ))}
          {offers.map((offer, index) => <BusinessOfferCard key={offer.id} offer={offer} position={index} />)}
        </div>
      ) : funded.unavailable ? (
        <p className="mt-10 text-sm text-akiba-muted">Offers are temporarily unavailable.</p>
      ) : (
        <p className="mt-10 text-sm text-akiba-muted">No offers are live right now.</p>
      )}
      <PlayStoreLink slot="offer" />
    </main>
  );
}
