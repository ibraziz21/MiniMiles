import { FundedDiscoveryUnavailable } from "@/lib/vouchers/fundedDiscovery";
/**
 * Resolves the full participant list for funded offers, in batches.
 *
 * A funded allocation may name merchants beyond its primary (BDR-006). The
 * authoritative set is the primary plus `voucher_allocation_merchants`; this
 * module turns that into displayable merchant summaries for discovery.
 *
 * Two rules shape the design:
 *
 *  - **Batched, never per-offer.** One query for all memberships and one for
 *    all partner profiles, regardless of how many offers are on the page.
 *  - **Fail closed, never shrink.** If a membership or a participant's public
 *    profile cannot be resolved, the offer is withheld rather than advertised
 *    with a shorter list. Telling a member a voucher works at three stalls
 *    when it works at six is a smaller error than telling them it works at
 *    six when one of those is gone — but both mislead, and only withholding
 *    is honest about not knowing.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { isHiddenPartner } from "@/lib/akiba/hidden-partners";
import {
  multiMerchantFundedOffersV1Flag,
  percentFundedOffersV1Flag,
} from "@/lib/featureFlags.server";
import type { MerchantSummary } from "@/components/vouchers/FundedOfferCard";

/** Public partner columns a participant summary needs — nothing private. */
const PARTICIPANT_COLUMNS = "id, name, slug, image_url, status";

type PartnerRow = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  status: string;
};

function toSummary(row: PartnerRow): MerchantSummary {
  return { id: row.id, name: row.name, slug: row.slug, imageUrl: row.image_url };
}

/**
 * `null` for an allocation whose participants could not be fully resolved —
 * the caller must withhold that offer rather than fall back to the primary.
 */
export type ResolvedParticipants = Map<string, MerchantSummary[] | null>;

/**
 * Allocation ids where the given partner is an additional (non-primary)
 * participant. Used so a trader's own merchant page shows offers they honour
 * but do not host.
 */
export async function allocationIdsForParticipant(partnerId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voucher_allocation_merchants")
    .select("allocation_id")
    .eq("partner_id", partnerId);

  if (error || !Array.isArray(data)) {
    throw new FundedDiscoveryUnavailable("participant_allocations");
  }
  return (data ?? []).map((row) => row.allocation_id as string);
}

/**
 * Participant summaries per allocation, primary first then the rest sorted
 * deterministically by name.
 *
 * `primaries` carries each allocation's primary merchant, already loaded by
 * the caller's own query, so this never re-fetches it.
 */
export async function resolveAllocationParticipants(
  primaries: Map<string, MerchantSummary>,
): Promise<ResolvedParticipants> {
  const resolved: ResolvedParticipants = new Map();
  const allocationIds = [...primaries.keys()];
  if (allocationIds.length === 0) return resolved;

  const admin = createAdminClient();
  const { data: memberships, error: membershipError } = await admin
    .from("voucher_allocation_merchants")
    .select("allocation_id, partner_id")
    .in("allocation_id", allocationIds);

  if (membershipError || !Array.isArray(memberships)) {
    // Cannot tell which allocations have extra participants, so none can be
    // advertised honestly.
    throw new FundedDiscoveryUnavailable("memberships", allocationIds);
  }

  const extrasByAllocation = new Map<string, string[]>();
  for (const row of memberships ?? []) {
    const allocationId = row.allocation_id as string;
    const partnerId = row.partner_id as string;
    const primary = primaries.get(allocationId);
    // The set function unions the primary in anyway; skip it here so a row
    // naming the primary cannot produce a duplicate entry.
    if (primary && partnerId === primary.id) continue;
    extrasByAllocation.set(allocationId, [...(extrasByAllocation.get(allocationId) ?? []), partnerId]);
  }

  const extraPartnerIds = [...new Set([...extrasByAllocation.values()].flat())];
  const partnersById = new Map<string, MerchantSummary>();
  if (extraPartnerIds.length > 0) {
    const { data: partners, error: partnerError } = await admin
      .from("partners")
      .select(PARTICIPANT_COLUMNS)
      .in("id", extraPartnerIds);

    if (partnerError || !Array.isArray(partners)) {
      throw new FundedDiscoveryUnavailable("participant_profiles", allocationIds);
    }
    for (const row of (partners ?? []) as PartnerRow[]) {
      if (row.status !== "active") continue;
      if (isHiddenPartner(row.id)) continue;
      partnersById.set(row.id, toSummary(row));
    }
  }

  for (const allocationId of allocationIds) {
    const primary = primaries.get(allocationId)!;
    const extras = extrasByAllocation.get(allocationId) ?? [];
    const summaries: MerchantSummary[] = [];
    let complete = true;

    for (const partnerId of extras) {
      const summary = partnersById.get(partnerId);
      if (!summary) {
        // Named participant that is inactive, hidden or missing. The
        // advertised set would be wrong, so the offer is withheld.
        complete = false;
        break;
      }
      summaries.push(summary);
    }

    if (!complete) {
      throw new FundedDiscoveryUnavailable("participant_incomplete", [allocationId]);
    }

    summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    resolved.set(allocationId, [primary, ...summaries]);
  }

  return resolved;
}

/**
 * Whether a v1 client may claim this allocation at all.
 *
 * Hiding an offer from the catalogue is not protection: a client holding an
 * allocation id — from an earlier response, a deep link, or a replayed
 * request — can POST straight to the claim route. Without this check such a
 * request succeeds and the member ends up holding a voucher their build
 * cannot describe, which is the failure the catalogue filter exists to
 * prevent in the first place.
 *
 * Reads the two facts the flags gate on rather than rebuilding a whole
 * FundedOffer: the benefit type and how many merchants the allocation names.
 * Returns a reason when unsupported so the caller can answer in the API's
 * existing error envelope.
 */
export type V1ClaimSupport =
  | { supported: true }
  /** The shape is known and this client cannot render it — updating helps. */
  | { supported: false; kind: "unsupported_shape"; reason: string }
  /**
   * We could not establish the shape. Telling the member to update their app
   * would be a guess, and a wrong one whenever the cause is a transient
   * lookup failure, so this is surfaced as unavailability instead.
   */
  | { supported: false; kind: "unavailable"; reason: string };

export async function v1ClaimSupport(allocationId: string): Promise<V1ClaimSupport> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("voucher_funding_allocations")
    .select(
      "id, spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey ( voucher_type )",
    )
    .eq("id", allocationId)
    .maybeSingle();

  if (error) {
    console.error("[funded offers] v1 claim support lookup failed:", error.message);
    return { supported: false, kind: "unavailable", reason: "support_lookup_failed" };
  }
  if (!data) {
    return { supported: false, kind: "unavailable", reason: "allocation_not_found" };
  }

  const template = Array.isArray(data.spend_voucher_templates)
    ? data.spend_voucher_templates[0]
    : data.spend_voucher_templates;
  const voucherType = (template as { voucher_type: string | null } | null)?.voucher_type ?? null;

  // A missing benefit type is not "not a percentage" — it is an unknown
  // shape, and a client must not be handed a voucher whose benefit nobody
  // could read. Fail closed rather than defaulting to the supported case.
  if (!voucherType) {
    return { supported: false, kind: "unavailable", reason: "voucher_type_unknown" };
  }

  if (voucherType === "percent_off" && !percentFundedOffersV1Flag().enabled) {
    return { supported: false, kind: "unsupported_shape", reason: "percentage_offer_unsupported" };
  }

  const { count, error: countError } = await admin
    .from("voucher_allocation_merchants")
    .select("partner_id", { count: "exact", head: true })
    .eq("allocation_id", allocationId);

  if (countError) {
    console.error("[funded offers] v1 claim merchant count failed:", countError.message);
    return { supported: false, kind: "unavailable", reason: "merchant_count_failed" };
  }

  // A null count means the count was not returned, not that there are zero
  // rows. Treating it as zero would quietly classify a multi-merchant offer
  // as single-merchant and serve it to a build that cannot show it.
  if (count === null || count === undefined) {
    return { supported: false, kind: "unavailable", reason: "merchant_count_unknown" };
  }

  // Any extra merchant makes the eligible set larger than one, since the set
  // is the primary plus these rows.
  if (count > 0 && !multiMerchantFundedOffersV1Flag().enabled) {
    return { supported: false, kind: "unsupported_shape", reason: "multi_merchant_offer_unsupported" };
  }

  return { supported: true };
}

/**
 * Resolved participants for an issued voucher, from its snapshot IDs.
 *
 * `count` is always the number of IDs the snapshot recorded, never the number
 * of profiles that happened to resolve. That distinction is the whole point:
 * an archived or renamed partner must not quietly turn a six-merchant
 * entitlement into a five-merchant one on the member's screen. When
 * `incomplete` is true the caller shows an explicit "some details
 * unavailable" state rather than a shorter list presented as complete.
 *
 * The entitlement itself is never affected — that lives in the voucher row
 * and its snapshot, both untouched here.
 */
export type SnapshotParticipants = {
  merchants: MerchantSummary[];
  /** How many merchants the snapshot named. */
  count: number;
  /** True when at least one named merchant could not be resolved to a profile. */
  incomplete: boolean;
};

export async function resolveSnapshotParticipants(
  snapshotIds: string[],
): Promise<SnapshotParticipants> {
  if (snapshotIds.length === 0) {
    return { merchants: [], count: 0, incomplete: false };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("partners")
    .select(PARTICIPANT_COLUMNS)
    .in("id", snapshotIds);

  if (error) {
    console.error("[owned voucher] participant resolution failed:", error.message);
    // The count is still known from the snapshot, so the member is told how
    // many merchants their voucher covers even when none can be named.
    return { merchants: [], count: snapshotIds.length, incomplete: true };
  }

  const byId = new Map<string, MerchantSummary>();
  for (const row of (data ?? []) as PartnerRow[]) {
    // Hidden or inactive partners are still named: the voucher genuinely
    // covers them, and hiding one would misstate the entitlement.
    byId.set(row.id, toSummary(row));
  }

  // Snapshot order is preserved — the primary was written first.
  const merchants = snapshotIds.map((id) => byId.get(id)).filter((m): m is MerchantSummary => !!m);
  return {
    merchants,
    count: snapshotIds.length,
    incomplete: merchants.length !== snapshotIds.length,
  };
}
