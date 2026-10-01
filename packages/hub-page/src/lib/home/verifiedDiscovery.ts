import { createAdminClient } from "@/lib/supabase/admin";
import type { VerifiedDiscoveryHighlight } from "./types";

const CONTRIBUTION_SCAN_LIMIT = 500;
const HIGHLIGHT_LIMIT = 3;
const PHOTO_URL_TTL_SECONDS = 60 * 60;
const DERIVED_PHOTO_BUCKET = "discovery-visit-photos-derived";

type ContributionRow = {
  id: string;
  partner_id: string;
  experience_option_ids: unknown;
  discovery_contribution_requests: unknown;
};

type PhotoRow = {
  id: string;
  contribution_id: string;
  partner_id: string;
  thumbnail_key: string;
  display_key: string;
};

type PartnerRow = {
  partner_id: string;
  partners: unknown;
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

function publicExperienceLabels(row: ContributionRow): string[] {
  const request = relatedRecord(row.discovery_contribution_requests);
  const event = relatedRecord(request?.verified_earning_events);
  const template = record(request?.template_snapshot);
  if (request?.state !== "submitted" || event?.verification_status !== "active" || !template) return [];

  const selected = new Set(
    Array.isArray(row.experience_option_ids)
      ? row.experience_option_ids.filter((id): id is string => typeof id === "string")
      : [],
  );
  const options = Array.isArray(template.experience_options) ? template.experience_options : [];
  return options.flatMap((option) => {
    const value = record(option);
    if (!value || typeof value.id !== "string" || !selected.has(value.id)) return [];
    if (typeof value.publicLabel !== "string") return [];
    const label = value.publicLabel.trim().slice(0, 80);
    return label ? [label] : [];
  });
}

function topLabels(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

async function getQualifiedRecommendedItems(
  admin: ReturnType<typeof createAdminClient>,
  contributionToPartner: Map<string, string>,
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
    const counts = new Map<string, Map<string, number>>();
    for (const row of itemRows as Array<{ contribution_id: string; item_mention_id: string }>) {
      const partnerId = contributionToPartner.get(row.contribution_id);
      const canonicalId = mentionToCanonical.get(row.item_mention_id);
      const name = canonicalId ? canonicalNames.get(canonicalId) : null;
      if (!partnerId || !name) continue;
      const partnerCounts = counts.get(partnerId) ?? new Map<string, number>();
      partnerCounts.set(name, (partnerCounts.get(name) ?? 0) + 1);
      counts.set(partnerId, partnerCounts);
    }

    return new Map([...counts].map(([partnerId, itemCounts]) => [partnerId, topLabels(itemCounts, 2)]));
  } catch (error) {
    console.error("[home-verified-discovery] recommended-item projection failed:", error instanceof Error ? error.message : error);
    return new Map();
  }
}

/**
 * Returns up to three earned discovery slots, ranked by the number of
 * active positive verified visits. A merchant needs at least one approved
 * visit photo to appear. Only template-owned public labels and independently
 * qualified canonical item names are projected; identities and raw answers
 * never leave this server-side function.
 */
export async function getVerifiedDiscoveryHighlights(): Promise<VerifiedDiscoveryHighlight[]> {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from("merchant_discovery_contributions")
      .select(
        "id, partner_id, experience_option_ids, discovery_contribution_requests!inner(state, template_snapshot, verified_earning_events!inner(verification_status))",
      )
      .is("withdrawn_at", null)
      .eq("would_recommend", true)
      .eq("discovery_contribution_requests.state", "submitted")
      .eq("discovery_contribution_requests.verified_earning_events.verification_status", "active")
      .order("submitted_at", { ascending: false })
      .limit(CONTRIBUTION_SCAN_LIMIT);

    if (error || !data?.length) {
      if (error) console.error("[home-verified-discovery] contribution lookup failed:", error.message);
      return [];
    }

    const contributions = data as ContributionRow[];
    const contributionToPartner = new Map(contributions.map((row) => [row.id, row.partner_id]));
    const counts = new Map<string, number>();
    const lovedCounts = new Map<string, Map<string, number>>();
    for (const contribution of contributions) {
      counts.set(contribution.partner_id, (counts.get(contribution.partner_id) ?? 0) + 1);
      const labels = lovedCounts.get(contribution.partner_id) ?? new Map<string, number>();
      for (const label of publicExperienceLabels(contribution)) {
        labels.set(label, (labels.get(label) ?? 0) + 1);
      }
      lovedCounts.set(contribution.partner_id, labels);
    }

    const rankedPartnerIds = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([partnerId]) => partnerId);

    const [{ data: partnerRows, error: partnerError }, { data: photoRows, error: photoError }, recommendedItems] = await Promise.all([
      admin
        .from("partner_settings")
        .select("partner_id, partners!inner(id, slug, name, type, status)")
        .in("partner_id", rankedPartnerIds)
        .eq("directory_status", "published")
        .eq("partners.type", "merchant")
        .eq("partners.status", "active"),
      admin
        .from("merchant_visit_photos")
        .select("id, contribution_id, partner_id, thumbnail_key, display_key")
        .in("contribution_id", contributions.map((row) => row.id))
        .eq("moderation_status", "approved")
        .not("thumbnail_key", "is", null)
        .not("display_key", "is", null)
        .order("approved_at", { ascending: false }),
      getQualifiedRecommendedItems(admin, contributionToPartner),
    ]);

    if (partnerError || photoError) {
      console.error("[home-verified-discovery] public projection lookup failed:", partnerError?.message ?? photoError?.message);
      return [];
    }

    const partners = new Map<string, { slug: string; name: string }>();
    for (const row of (partnerRows ?? []) as PartnerRow[]) {
      const partner = relatedRecord(row.partners);
      if (typeof partner?.slug !== "string" || typeof partner.name !== "string") continue;
      partners.set(row.partner_id, { slug: partner.slug, name: partner.name });
    }

    const firstPhotoByPartner = new Map<string, PhotoRow>();
    for (const photo of (photoRows ?? []) as PhotoRow[]) {
      if (!firstPhotoByPartner.has(photo.partner_id)) firstPhotoByPartner.set(photo.partner_id, photo);
    }
    const eligibleIds = rankedPartnerIds.filter((id) => partners.has(id) && firstPhotoByPartner.has(id)).slice(0, HIGHLIGHT_LIMIT);
    if (eligibleIds.length === 0) return [];

    const paths = eligibleIds.flatMap((id) => {
      const photo = firstPhotoByPartner.get(id)!;
      return [photo.thumbnail_key, photo.display_key];
    });
    const { data: signed, error: signError } = await admin.storage
      .from(DERIVED_PHOTO_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    if (signError || !signed) {
      console.error("[home-verified-discovery] photo signing failed:", signError?.message ?? "no signed URLs");
      return [];
    }

    return eligibleIds.flatMap((partnerId, index) => {
      const partner = partners.get(partnerId)!;
      const photo = firstPhotoByPartner.get(partnerId)!;
      const thumbnailUrl = safeSignedUrl(signed[index * 2]?.signedUrl);
      const displayUrl = safeSignedUrl(signed[index * 2 + 1]?.signedUrl);
      if (!thumbnailUrl || !displayUrl) return [];
      return [{
        merchantId: partnerId,
        merchantSlug: partner.slug,
        merchantName: partner.name,
        verifiedVisitCount: counts.get(partnerId) ?? 0,
        lovedLabels: topLabels(lovedCounts.get(partnerId) ?? new Map(), 3),
        recommendedItems: recommendedItems.get(partnerId) ?? [],
        photo: {
          id: photo.id,
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
