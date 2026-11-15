/**
 * "New offer at a place you saved" (migration 125).
 *
 * Collects every offer the app currently shows — merchant offers, Akiba-funded
 * offers and Miles vouchers — through the same loaders the app's screens use,
 * so an offer is announced exactly when a member could open it, and never one
 * the app hides (unpublished merchant, hidden partner, kill switch off).
 *
 * record_offer_sightings does the rest in the database: it remembers which
 * offers it has seen, and for the newly seen ones queues one push per member
 * who saved a participating merchant (at most one a day per member, never
 * between 21:00 and 09:00 Nairobi time).
 *
 * Each source is recorded separately. Every loader is called in strict mode,
 * so a failed read throws and that source is skipped for this run — it is
 * never recorded as empty. That matters most on a source's first run, which
 * silently records what is live as the baseline: a baseline taken from a
 * failed read would make every existing offer look new the next time.
 * An empty list never removes anything — sightings are only ever added.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listPublicMerchantOffers } from "@/lib/merchants/publicOffers";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllTemplates, getFundedOffers } from "@/lib/vouchers/catalogue.server";

export type OfferSource = "merchant_offer" | "funded" | "template";

export type SightedOffer = {
  key: string;
  title: string;
  merchants: Array<{ id: string; name: string; slug: string }>;
};

export type SourceResult =
  | { source: OfferSource; status: "recorded"; baselined: boolean; quietHours: boolean; newOffers: number; queued: number }
  | { source: OfferSource; status: "unavailable" | "failed"; error: string };

type Loader = () => Promise<SightedOffer[]>;

export const OFFER_LOADERS: Record<OfferSource, Loader> = {
  merchant_offer: async () =>
    (await listPublicMerchantOffers(50, { strict: true })).map((offer) => ({
      key: `merchant_offer:${offer.id}`,
      title: offer.title,
      merchants: [{ id: offer.partner.id, name: offer.partner.name, slug: offer.partner.slug }],
    })),

  funded: async () => {
    // Switched off reads as an empty list; for the scanner it must read as
    // "unknown", or turning funded vouchers back on would announce every
    // offer that was live all along.
    if (!akibaFundedVouchersHubFlag().enabled) throw new Error("funded vouchers are switched off");
    return (await getFundedOffers())
      // A sold-out campaign isn't something a member can act on.
      .filter((offer) => offer.quantityRemaining !== 0)
      .map((offer) => ({
        key: `funded:${offer.allocationId}`,
        title: offer.title,
        merchants: offer.merchants.map(({ id, name, slug }) => ({ id, name, slug })),
      }));
  },

  template: async () =>
    (await getAllTemplates(null, { strict: true })).flatMap((template) =>
      template.partners
        ? [{
            key: `template:${template.id}`,
            title: template.title,
            merchants: [{ id: template.partners.id, name: template.partners.name, slug: template.partners.slug }],
          }]
        : [],
    ),
};

export async function processOfferAlerts(
  admin: SupabaseClient = createAdminClient(),
  loaders: Record<OfferSource, Loader> = OFFER_LOADERS,
): Promise<SourceResult[]> {
  const results: SourceResult[] = [];

  for (const source of Object.keys(loaders) as OfferSource[]) {
    let offers: SightedOffer[];
    try {
      offers = await loaders[source]();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[offer-alerts] ${source} offers unavailable:`, error);
      results.push({ source, status: "unavailable", error });
      continue;
    }

    const { data, error } = await admin.rpc("record_offer_sightings", {
      p_source: source,
      p_offers: offers,
    });
    if (error) {
      console.error(`[offer-alerts] record_offer_sightings(${source}) failed:`, error.message);
      results.push({ source, status: "failed", error: error.message });
      continue;
    }

    const row = (data ?? {}) as { baselined?: boolean; quiet_hours?: boolean; new_offers?: number; queued?: number };
    results.push({
      source,
      status: "recorded",
      baselined: row.baselined === true,
      quietHours: row.quiet_hours === true,
      newOffers: Number(row.new_offers ?? 0),
      queued: Number(row.queued ?? 0),
    });
  }

  return results;
}

/** Send-time guard: the member may have unsaved the place since. */
export async function merchantStillSaved(
  admin: SupabaseClient,
  hubUserId: string,
  merchantId: unknown,
): Promise<boolean> {
  if (typeof merchantId !== "string" || !merchantId) return false;
  const { data, error } = await admin
    .from("hub_user_saved_merchants")
    .select("id")
    .eq("hub_user_id", hubUserId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  // A failed lookup sends: the place was saved when the push was queued.
  if (error) return true;
  return Boolean(data);
}
