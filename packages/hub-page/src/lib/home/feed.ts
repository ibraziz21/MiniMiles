import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_PARTNER_FILTER } from "@/lib/akiba/hidden-partners";
import { dealLabel, type VoucherTemplate } from "@/lib/akiba/deals";
import { getUserBalance } from "@/lib/akiba/balance";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { getActiveVoucherSummary, getLinkedWalletAddresses, getSoonestExpiringVoucher } from "@/lib/akiba/myVouchers";
import { listPublicMerchants } from "@/lib/merchants/queries";
import { getTopOffers, toMerchantValueSummary, getPurchaseAffinity, type TopOffer } from "@/lib/merchants/enrich";
import { getNextRewardSummary } from "@/lib/akiba/nextReward";
import { getActiveIntents, getIntentBySlug } from "./intents";
import type { HomeFeedResponse, HomeFeedSection, MatchReason, MerchantValueSummary } from "./types";

const RANKING_VERSION = "home-v2-phase1";
const NEARBY_RADIUS_KM = 15;
// A small teaser into Directory's own "Near me", not a full rail
// (discovery-blueprint.md §3) — independent of the shared limitPerSection.
const NEARBY_TEASER_LIMIT = 3;
// Small and deliberate (discovery-blueprint.md §3) — this is an
// introduction, not a rail to fill.
const NEW_MERCHANTS_LIMIT = 3;

export type HomeFeedParams = {
  userId: string | null;
  /** Passed by the caller (already has it from its own auth check) rather
   *  than resolved here via an extra admin.auth lookup. */
  userEmail?: string | null;
  lat?: number;
  lng?: number;
  intent?: string;
  limitPerSection?: number;
};

async function buildForYouSection(
  params: HomeFeedParams,
  intentQuery: string | null,
  intentLabel: string | null,
  balance: number | null,
  limit: number,
  purchaseAffinity: Promise<Set<string>>
): Promise<HomeFeedSection> {
  const nearby = params.lat != null && params.lng != null;
  const { merchants } = await listPublicMerchants({
    q: intentQuery ?? undefined,
    lat: params.lat,
    lng: params.lng,
    limit,
  });

  const [offers, affinity] = await Promise.all([
    getTopOffers(merchants.map((m) => m.id), params.userId),
    purchaseAffinity,
  ]);
  const hasAnyAffinityMatch = merchants.some((m) => affinity.has(m.id));

  // Cold-start order (spec §6.3, extended by §15 Phase 3 principle #6
  // "verified behavior beats proxy behavior"): intent/location relevance
  // already ordered by the RPC; otherwise a verified previous purchase
  // outranks "current offer value" (has an offer, cheapest first), then name.
  const ranked = [...merchants].sort((a, b) => {
    if (intentQuery || nearby) return 0; // RPC ordering (relevance/distance) already applies
    const affinityA = affinity.has(a.id);
    const affinityB = affinity.has(b.id);
    if (affinityA !== affinityB) return affinityA ? -1 : 1;
    const offerA = offers[a.id];
    const offerB = offers[b.id];
    if (!!offerA !== !!offerB) return offerA ? -1 : 1;
    if (offerA && offerB && offerA.milesCost !== offerB.milesCost) return offerA.milesCost - offerB.milesCost;
    return a.name.localeCompare(b.name);
  });

  const personalized = Boolean(intentQuery) || nearby || hasAnyAffinityMatch;
  const title = personalized
    ? "Deals for you"
    : params.userId
      ? "Worth a look"
      : "Places to explore";

  return {
    id: "for_you",
    title,
    personalized,
    merchants: ranked.map((m) =>
      toMerchantValueSummary(m, offers[m.id], balance, intentLabel, undefined, affinity.has(m.id))
    ),
  };
}

async function buildNearbySection(
  params: HomeFeedParams,
  balance: number | null
): Promise<HomeFeedSection | null> {
  if (params.lat == null || params.lng == null) return null;

  const { merchants } = await listPublicMerchants({
    lat: params.lat,
    lng: params.lng,
    radiusKm: NEARBY_RADIUS_KM,
    limit: NEARBY_TEASER_LIMIT,
  });
  if (merchants.length === 0) return null;

  const offers = await getTopOffers(merchants.map((m) => m.id), params.userId);

  return {
    id: "nearby",
    title: "Near you",
    personalized: true,
    merchants: merchants.map((m) => toMerchantValueSummary(m, offers[m.id], balance, null)),
  };
}

async function buildLimitedTimeSection(
  hubUserId: string | null,
  balance: number | null,
  limit: number
): Promise<HomeFeedSection | null> {
  const admin = createAdminClient();

  const { data: templates, error } = await admin
    .from("spend_voucher_templates")
    .select(
      `id, title, voucher_type, discount_percent, discount_cusd, miles_cost, expires_at,
       partners!inner (
         id, slug, name, image_url, type, status,
         partner_settings!inner ( directory_status, banner_url )
       )`
    )
    .eq("active", true)
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .eq("partners.type", "merchant")
    .eq("partners.status", "active")
    .eq("partners.partner_settings.directory_status", "published")
    .not("partner_id", "in", HIDDEN_PARTNER_FILTER)
    .order("expires_at", { ascending: true })
    .limit(limit * 3); // headroom before the availability filter below

  if (error) {
    console.error("[home-feed] limited_time query failed:", error.message);
    return null;
  }
  if (!templates || templates.length === 0) return null;

  const { data: availableRows } = await admin.rpc("list_available_voucher_template_ids_hub", {
    p_hub_user_id: hubUserId,
  });
  const availableIds = new Set(
    (availableRows ?? []).map((r: { template_id: string } | string) =>
      typeof r === "string" ? r : r.template_id
    )
  );

  type RowPartner = {
    id: string; slug: string; name: string; image_url: string | null;
    partner_settings: { banner_url: string | null } | Array<{ banner_url: string | null }>;
  };
  type Row = {
    id: string; title: string; voucher_type: VoucherTemplate["voucher_type"];
    discount_percent: number | null; discount_cusd: number | null; miles_cost: number; expires_at: string;
    partners: RowPartner | RowPartner[];
  };

  const merchants: MerchantValueSummary[] = [];
  for (const row of templates as unknown as Row[]) {
    if (!availableIds.has(row.id)) continue;
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    if (!partner) continue;
    const partnerSettings = Array.isArray(partner.partner_settings) ? partner.partner_settings[0] : partner.partner_settings;

    const offer: TopOffer = {
      templateId: row.id,
      label: dealLabel(row as unknown as VoucherTemplate),
      milesCost: row.miles_cost,
      expiresAt: row.expires_at,
    };
    const affordable = balance != null ? balance >= offer.milesCost : null;
    // Same priority rule as toMerchantValueSummary (enrich.ts) — "affordable"
    // outranks the plain "voucher" reason when both are true, since it's
    // the stronger, more differentiating truthful signal.
    const reasons: MatchReason[] = affordable
      ? [{ kind: "affordable", templateId: offer.templateId }]
      : [{ kind: "voucher", label: offer.label, templateId: offer.templateId }];

    merchants.push({
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      logoUrl: partner.image_url,
      bannerUrl: partnerSettings?.banner_url ?? null,
      primaryCategory: null,
      matchedOffering: null,
      operatingModel: "hybrid",
      nearestLocation: null,
      topOffer: { ...offer, affordable },
      earnSummary: null,
      reasons,
    });

    if (merchants.length >= limit) break;
  }

  if (merchants.length === 0) return null;

  return { id: "limited_time", title: "Ending soon", personalized: false, merchants };
}

/**
 * Recently published merchants (discovery-blueprint.md §3, deferred out of
 * Phase 1 pending confirming directory_published_at reliability — since
 * verified: 100% of currently-published partner_settings rows carry a
 * non-null, distinct-per-merchant timestamp, not a bulk-backfill artifact).
 * No offer/affordability enrichment — this module's only claim is "new",
 * so the section title alone is the reason; no per-card chip repeats it.
 */
async function buildNewMerchantsSection(): Promise<HomeFeedSection | null> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("partner_settings")
    .select(
      `directory_published_at, banner_url,
       partners!inner ( id, slug, name, image_url, type, status )`
    )
    .eq("directory_status", "published")
    .not("directory_published_at", "is", null)
    .eq("partners.type", "merchant")
    .eq("partners.status", "active")
    .not("partners.id", "in", HIDDEN_PARTNER_FILTER)
    .order("directory_published_at", { ascending: false })
    .limit(NEW_MERCHANTS_LIMIT);

  if (error) {
    console.error("[home-feed] new_merchants query failed:", error.message);
    return null;
  }
  if (!rows || rows.length === 0) return null;

  type RowPartner = { id: string; slug: string; name: string; image_url: string | null };
  type Row = { banner_url: string | null; partners: RowPartner | RowPartner[] };

  const merchants: MerchantValueSummary[] = (rows as unknown as Row[]).flatMap((row) => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    if (!partner) return [];
    return [{
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      logoUrl: partner.image_url,
      bannerUrl: row.banner_url,
      primaryCategory: null,
      matchedOffering: null,
      operatingModel: "hybrid" as const,
      nearestLocation: null,
      topOffer: null,
      earnSummary: null,
      reasons: [],
    }];
  });

  if (merchants.length === 0) return null;

  return { id: "new", title: "New on Akiba", personalized: false, merchants };
}

async function getRewardsSnapshot(userId: string, email: string | null) {
  const [{ walletAddress }, walletAddresses] = await Promise.all([
    resolveHubProfile({ userId, email }),
    getLinkedWalletAddresses(userId),
  ]);

  const [{ balance }, { publicPassId }, voucherSummary, continueVoucher] = await Promise.all([
    getUserBalance({ walletAddress, email }),
    getOrCreatePass({ userId, email, walletAddress }),
    getActiveVoucherSummary({ userId, walletAddresses }),
    getSoonestExpiringVoucher({ userId, walletAddresses }),
  ]);

  return {
    balance,
    hasPass: !!publicPassId,
    activeVoucherCount: voucherSummary.activeCount,
    continueVoucher,
  };
}

export async function getHomeFeed(params: HomeFeedParams): Promise<HomeFeedResponse> {
  const limit = Math.min(Math.max(params.limitPerSection ?? 6, 1), 10);
  const intent = getIntentBySlug(params.intent);
  const intentQuery = intent?.query ?? null;
  const intentLabel = intent?.label ?? null;

  // Shared across buildForYouSection and getNextRewardSummary so a signed-in
  // load never queries merchant_transactions for purchase affinity twice.
  const purchaseAffinityPromise = getPurchaseAffinity(params.userId);

  let balance: number | null = null;
  let rewards: HomeFeedResponse["rewards"] = null;
  let nextReward: HomeFeedResponse["nextReward"] = null;

  if (params.userId) {
    const [snapshotResult, nextRewardResult] = await Promise.allSettled([
      getRewardsSnapshot(params.userId, params.userEmail ?? null),
      purchaseAffinityPromise.then((purchaseAffinity) =>
        getNextRewardSummary({ hubUserId: params.userId as string, email: params.userEmail ?? null, purchaseAffinity })
      ),
    ]);

    if (snapshotResult.status === "fulfilled") {
      balance = snapshotResult.value.balance;
      rewards = {
        milesBalance: snapshotResult.value.balance,
        activeVoucherCount: snapshotResult.value.activeVoucherCount,
        hasPass: snapshotResult.value.hasPass,
        continueVoucher: snapshotResult.value.continueVoucher,
      };
    } else {
      console.error("[home-feed] rewards snapshot failed:", snapshotResult.reason);
    }

    if (nextRewardResult.status === "fulfilled") {
      nextReward = nextRewardResult.value;
    } else {
      console.error("[home-feed] next reward summary failed:", nextRewardResult.reason);
    }
  }

  const sections: HomeFeedSection[] = [];

  const results = await Promise.allSettled([
    buildForYouSection(params, intentQuery, intentLabel, balance, limit, purchaseAffinityPromise),
    buildNearbySection(params, balance),
    buildLimitedTimeSection(params.userId, balance, limit),
    buildNewMerchantsSection(),
  ]);

  const [forYou, nearby, limitedTime, newMerchants] = results;
  if (forYou.status === "fulfilled" && forYou.value.merchants.length > 0) sections.push(forYou.value);
  else if (forYou.status === "rejected") console.error("[home-feed] for_you section failed:", forYou.reason);

  if (nearby.status === "fulfilled" && nearby.value) sections.push(nearby.value);
  else if (nearby.status === "rejected") console.error("[home-feed] nearby section failed:", nearby.reason);

  if (limitedTime.status === "fulfilled" && limitedTime.value) sections.push(limitedTime.value);
  else if (limitedTime.status === "rejected") console.error("[home-feed] limited_time section failed:", limitedTime.reason);

  if (newMerchants.status === "fulfilled" && newMerchants.value) sections.push(newMerchants.value);
  else if (newMerchants.status === "rejected") console.error("[home-feed] new_merchants section failed:", newMerchants.reason);

  return {
    rankingVersion: RANKING_VERSION,
    generatedAt: new Date().toISOString(),
    intents: getActiveIntents(),
    sections,
    rewards,
    nextReward,
  };
}
