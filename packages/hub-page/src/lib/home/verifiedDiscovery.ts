import { createAdminClient } from "@/lib/supabase/admin";
import { isDiscoverySpotlightEnabled } from "@/lib/akiba/verifiedDiscoveryPublicProofFlags";
import { extractPublicExperienceLabels } from "@/lib/discovery/publicExperienceLabels";
import type { VerifiedDiscoveryHighlight, VerifiedRecommendationBand } from "./types";

// Still a fixed scan cap, not the full eligible corpus — removing this
// entirely is the separate, not-yet-built P1 "full-corpus projection"
// (hardening spec §5.2/§5.4/§9). What this module fixes now is correctness
// and safety within that capped window: the canonical eligibility
// projection (never a hand-rolled predicate), same-member/day dedup, and
// threshold-safe aggregate claims (§4.3).
const CONTRIBUTION_SCAN_LIMIT = 500;
// Ranking V1's "configured 90-day window" (§5.3) — also what
// recompute_merchant_discovery_snapshot (091) uses, so the live path here
// and the shadow snapshot stay comparable instead of silently diverging on
// how far back either one looks.
const RANKING_WINDOW_DAYS = 90;
const HIGHLIGHT_LIMIT = 3;
// §7.1: "Public customer-photo signed URLs have a maximum 15-minute
// lifetime and private/no-store response caching."
const PHOTO_URL_TTL_SECONDS = 15 * 60;
const DERIVED_PHOTO_BUCKET = "discovery-visit-photos-derived";
// §4.3: "one to four contributions render `New from verified visits`, not
// `1 verified visit`."
const EXACT_COUNT_BAND_THRESHOLD = 5;
// §4.3: "Discovery-level `What people loved` labels require at least five
// unique eligible contributors and at least 20% of eligible tag
// respondents in the active window."
const LOVED_LABEL_MIN_CONTRIBUTORS = 5;
const LOVED_LABEL_MIN_RESPONDENT_SHARE = 0.2;
// §4.3 / parent spec customer-favourite threshold, reused verbatim here:
// "five unique eligible contributors."
const RECOMMENDED_ITEM_MIN_CONTRIBUTORS = 5;

type EligibleVisitRow = {
  contribution_id: string;
  partner_id: string;
  submitted_at: string;
  experience_option_ids: unknown;
  template_snapshot: unknown;
  dedup_key: string;
};

type EligiblePhotoRow = {
  photo_id: string;
  contribution_id: string;
  partner_id: string;
  thumbnail_key: string;
  display_key: string;
};

type PartnerRow = {
  partner_id: string;
  partners: unknown;
};

/**
 * The same per-partner aggregate this module uses to decide what's safe to
 * publish, independent of the spotlight's top-3 cutoff and photo signing.
 * Exists so a shadow/canary comparison (hardening spec §12 Phase B) can look
 * up ANY merchant's live-computed value, not only whichever three are
 * currently ranked highest.
 */
export type VerifiedDiscoveryPartnerAggregate = {
  partnerId: string;
  uniqueContributorCount: number;
  band: VerifiedRecommendationBand;
  lovedLabels: string[];
  recommendedItems: string[];
  coverPhotoId: string | null;
  coverPhotoThumbnailKey: string | null;
  coverPhotoDisplayKey: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function relatedRecord(value: unknown): Record<string, unknown> | null {
  return record(Array.isArray(value) ? value[0] : value);
}

function safeSignedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function band(uniqueContributorCount: number): VerifiedRecommendationBand {
  return uniqueContributorCount < EXACT_COUNT_BAND_THRESHOLD
    ? { kind: "new" }
    : { kind: "exact", count: uniqueContributorCount };
}

/** Ranks entries by unique-contributor count descending, ties broken by key ascending. */
function rankByUniqueCount(counts: Map<string, Set<string>>): Array<readonly [string, number]> {
  return [...counts.entries()]
    .map(([key, contributors]) => [key, contributors.size] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function getQualifiedRecommendedItems(
  admin: ReturnType<typeof createAdminClient>,
  contributionToPartner: Map<string, string>,
  contributionToDedupKey: Map<string, string>,
): Promise<Map<string, string[]>> {
  const contributionIds = [...contributionToPartner.keys()];
  if (contributionIds.length === 0) return new Map();

  try {
    const { data: itemRows, error: itemError } = await admin
      .from("merchant_discovery_contribution_items")
      .select("contribution_id, item_mention_id")
      .in("contribution_id", contributionIds)
      .eq("is_recommended", true);
    if (itemError || !itemRows?.length) return new Map();

    const mentionIds = [...new Set(itemRows.map((row: { item_mention_id: string }) => row.item_mention_id))];
    const { data: mentionRows, error: mentionError } = await admin
      .from("merchant_discovery_item_mentions")
      .select("id, canonical_item_id")
      .in("id", mentionIds)
      .eq("moderation_status", "accepted")
      .not("canonical_item_id", "is", null);
    if (mentionError || !mentionRows?.length) return new Map();

    const mentionToCanonical = new Map<string, string>();
    for (const row of mentionRows as Array<{ id: string; canonical_item_id: string }>) {
      mentionToCanonical.set(row.id, row.canonical_item_id);
    }
    const canonicalIds = [...new Set(mentionToCanonical.values())];
    const { data: canonicalRows, error: canonicalError } = await admin
      .from("merchant_discovery_items")
      .select("id, canonical_name")
      .in("id", canonicalIds)
      .eq("status", "qualified");
    if (canonicalError || !canonicalRows?.length) return new Map();

    const canonicalNames = new Map(
      (canonicalRows as Array<{ id: string; canonical_name: string }>).map((row) => [
        row.id,
        row.canonical_name.trim().slice(0, 80),
      ]),
    );

    // partnerId -> item name -> set of unique contributors (dedup_key), so
    // the same member recommending the same item twice in one day still
    // counts once toward the five-unique-contributor threshold.
    const perPartnerItemContributors = new Map<string, Map<string, Set<string>>>();
    for (const row of itemRows as Array<{ contribution_id: string; item_mention_id: string }>) {
      const partnerId = contributionToPartner.get(row.contribution_id);
      const dedupKey = contributionToDedupKey.get(row.contribution_id);
      const canonicalId = mentionToCanonical.get(row.item_mention_id);
      const name = canonicalId ? canonicalNames.get(canonicalId) : null;
      if (!partnerId || !dedupKey || !name) continue;
      const itemMap = perPartnerItemContributors.get(partnerId) ?? new Map<string, Set<string>>();
      const contributors = itemMap.get(name) ?? new Set<string>();
      contributors.add(dedupKey);
      itemMap.set(name, contributors);
      perPartnerItemContributors.set(partnerId, itemMap);
    }

    return new Map(
      [...perPartnerItemContributors].map(([partnerId, itemMap]) => [
        partnerId,
        rankByUniqueCount(itemMap)
          .filter(([, count]) => count >= RECOMMENDED_ITEM_MIN_CONTRIBUTORS)
          .slice(0, 2)
          .map(([name]) => name),
      ]),
    );
  } catch (error) {
    console.error("[home-verified-discovery] recommended-item projection failed:", error instanceof Error ? error.message : error);
    return new Map();
  }
}

/**
 * Fetches the windowed eligible corpus once and computes every partner's
 * aggregate from it — the one place this module's dedup/banding/threshold
 * rules are implemented. `getVerifiedDiscoveryHighlights` (public, ranked,
 * photo-signed) and the shadow comparison report are both thin callers of
 * this, rather than each re-deriving the aggregation rules.
 */
async function computeVerifiedDiscoveryPartnerAggregates(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Map<string, VerifiedDiscoveryPartnerAggregate>> {
  const windowStart = new Date(Date.now() - RANKING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .rpc("eligible_public_merchant_visits")
    .gte("submitted_at", windowStart)
    .order("submitted_at", { ascending: false })
    .limit(CONTRIBUTION_SCAN_LIMIT);

  if (error || !data?.length) {
    if (error) console.error("[home-verified-discovery] contribution lookup failed:", error.message);
    return new Map();
  }

  const visits = data as EligibleVisitRow[];
  const contributionToPartner = new Map(visits.map((row) => [row.contribution_id, row.partner_id]));
  const contributionToDedupKey = new Map(visits.map((row) => [row.contribution_id, row.dedup_key]));

  const uniqueContributorsByPartner = new Map<string, Set<string>>();
  const respondentsByPartner = new Map<string, Set<string>>();
  const lovedCandidatesByPartner = new Map<string, Map<string, Set<string>>>();

  for (const visit of visits) {
    const contributors = uniqueContributorsByPartner.get(visit.partner_id) ?? new Set<string>();
    contributors.add(visit.dedup_key);
    uniqueContributorsByPartner.set(visit.partner_id, contributors);

    const labels = extractPublicExperienceLabels(visit.template_snapshot, visit.experience_option_ids);
    if (labels.length > 0) {
      const respondents = respondentsByPartner.get(visit.partner_id) ?? new Set<string>();
      respondents.add(visit.dedup_key);
      respondentsByPartner.set(visit.partner_id, respondents);
    }
    const labelMap = lovedCandidatesByPartner.get(visit.partner_id) ?? new Map<string, Set<string>>();
    for (const label of labels) {
      const labelContributors = labelMap.get(label) ?? new Set<string>();
      labelContributors.add(visit.dedup_key);
      labelMap.set(label, labelContributors);
    }
    lovedCandidatesByPartner.set(visit.partner_id, labelMap);
  }

  const [{ data: photoRows, error: photoError }, recommendedItems] = await Promise.all([
    admin.rpc("eligible_public_merchant_visit_photos").order("approved_at", { ascending: false }),
    getQualifiedRecommendedItems(admin, contributionToPartner, contributionToDedupKey),
  ]);
  if (photoError) {
    console.error("[home-verified-discovery] photo projection lookup failed:", photoError.message);
    return new Map();
  }

  const firstPhotoByPartner = new Map<string, EligiblePhotoRow>();
  for (const photo of (photoRows ?? []) as EligiblePhotoRow[]) {
    if (!firstPhotoByPartner.has(photo.partner_id)) firstPhotoByPartner.set(photo.partner_id, photo);
  }

  const aggregates = new Map<string, VerifiedDiscoveryPartnerAggregate>();
  for (const [partnerId, contributors] of uniqueContributorsByPartner) {
    const respondents = respondentsByPartner.get(partnerId)?.size ?? 0;
    const lovedLabels = rankByUniqueCount(lovedCandidatesByPartner.get(partnerId) ?? new Map())
      .filter(([, count]) => count >= LOVED_LABEL_MIN_CONTRIBUTORS && count / respondents >= LOVED_LABEL_MIN_RESPONDENT_SHARE)
      .slice(0, 3)
      .map(([label]) => label);

    const coverPhoto = firstPhotoByPartner.get(partnerId) ?? null;
    aggregates.set(partnerId, {
      partnerId,
      uniqueContributorCount: contributors.size,
      band: band(contributors.size),
      lovedLabels,
      recommendedItems: recommendedItems.get(partnerId) ?? [],
      coverPhotoId: coverPhoto?.photo_id ?? null,
      coverPhotoThumbnailKey: coverPhoto?.thumbnail_key ?? null,
      coverPhotoDisplayKey: coverPhoto?.display_key ?? null,
    });
  }
  return aggregates;
}

/**
 * Returns up to three earned discovery slots, ranked by the number of
 * unique active positive contributors (same-member/same-merchant/same-day
 * activity counts once — hardening spec §4.3). A merchant needs at least
 * one eligible approved visit photo to appear. Eligibility — active
 * earning event, submitted request, unwithdrawn/unsuppressed contribution,
 * published merchant with structured proof enabled — comes entirely from
 * the canonical `eligible_public_merchant_visits`/
 * `eligible_public_merchant_visit_photos` projections; this module never
 * re-derives that predicate. Only template-owned public labels and
 * independently qualified canonical item names — both past their
 * five-unique-contributor threshold — are projected; identities and raw
 * answers never leave this server-side function.
 */
export async function getVerifiedDiscoveryHighlights(): Promise<VerifiedDiscoveryHighlight[]> {
  if (!isDiscoverySpotlightEnabled()) return [];

  const admin = createAdminClient();
  try {
    const aggregates = await computeVerifiedDiscoveryPartnerAggregates(admin);
    if (aggregates.size === 0) return [];

    const rankedPartnerIds = [...aggregates.values()]
      .sort((a, b) => b.uniqueContributorCount - a.uniqueContributorCount || a.partnerId.localeCompare(b.partnerId))
      .map((a) => a.partnerId);

    const eligibleIds = rankedPartnerIds.filter((id) => aggregates.get(id)?.coverPhotoId).slice(0, HIGHLIGHT_LIMIT);
    if (eligibleIds.length === 0) return [];

    const { data: partnerRows, error: partnerError } = await admin
      .from("partner_settings")
      .select("partner_id, partners!inner(id, slug, name, type, status)")
      .in("partner_id", eligibleIds)
      .eq("directory_status", "published")
      .eq("partners.type", "merchant")
      .eq("partners.status", "active");

    if (partnerError) {
      console.error("[home-verified-discovery] public projection lookup failed:", partnerError.message);
      return [];
    }

    const partners = new Map<string, { slug: string; name: string }>();
    for (const row of (partnerRows ?? []) as PartnerRow[]) {
      const partner = relatedRecord(row.partners);
      if (typeof partner?.slug !== "string" || typeof partner.name !== "string") continue;
      partners.set(row.partner_id, { slug: partner.slug, name: partner.name });
    }

    const publishableIds = eligibleIds.filter((id) => partners.has(id));
    if (publishableIds.length === 0) return [];

    const paths = publishableIds.flatMap((id) => {
      const aggregate = aggregates.get(id)!;
      return [aggregate.coverPhotoThumbnailKey!, aggregate.coverPhotoDisplayKey!];
    });
    const { data: signed, error: signError } = await admin.storage
      .from(DERIVED_PHOTO_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    if (signError || !signed) {
      console.error("[home-verified-discovery] photo signing failed:", signError?.message ?? "no signed URLs");
      return [];
    }

    return publishableIds.flatMap((partnerId, index) => {
      const partner = partners.get(partnerId)!;
      const aggregate = aggregates.get(partnerId)!;
      const thumbnailUrl = safeSignedUrl(signed[index * 2]?.signedUrl);
      const displayUrl = safeSignedUrl(signed[index * 2 + 1]?.signedUrl);
      if (!thumbnailUrl || !displayUrl) return [];

      return [{
        merchantId: partnerId,
        merchantSlug: partner.slug,
        merchantName: partner.name,
        verifiedRecommendationBand: aggregate.band,
        lovedLabels: aggregate.lovedLabels,
        recommendedItems: aggregate.recommendedItems,
        photo: {
          id: aggregate.coverPhotoId!,
          thumbnailUrl,
          displayUrl,
          altText: `Photo from a verified visit to ${partner.name}`,
        },
      }];
    });
  } catch (error) {
    console.error("[home-verified-discovery] highlight projection failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Shadow comparison (hardening spec §12 Phase B): the live, per-partner
 * aggregate this app would currently show, for every partner that has one —
 * not just the top three the spotlight displays. Used only by the internal
 * shadow-report endpoint to diff against the SQL snapshot
 * (recompute_merchant_discovery_snapshot, 091); never served publicly.
 */
export async function getVerifiedDiscoveryPartnerAggregates(): Promise<Map<string, VerifiedDiscoveryPartnerAggregate>> {
  const admin = createAdminClient();
  try {
    return await computeVerifiedDiscoveryPartnerAggregates(admin);
  } catch (error) {
    console.error("[home-verified-discovery] partner aggregate projection failed:", error instanceof Error ? error.message : error);
    return new Map();
  }
}
