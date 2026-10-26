import { isHiddenPartner } from "@/lib/akiba/hidden-partners";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";
import {
  FUNDED_OFFER_TEMPLATE_COLUMNS,
  toFundedOffer,
  type RawFundedPartner,
  type RawFundedTemplate,
} from "@/lib/vouchers/fundedOfferMapping";

type RawFundedAllocation = {
  id: string;
  claim_ends_at: string;
  claim_starts_at: string;
  metadata?: { redemption_schedule?: { days: number[]; timezone: string } | null };
  spend_voucher_templates: RawFundedTemplate | RawFundedTemplate[] | null;
  partners: RawFundedPartner | RawFundedPartner[] | null;
  voucher_eligibility_rule_sets:
    | { customer_copy: string | null }
    | Array<{ customer_copy: string | null }>
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getMerchantFundedOffers(merchantId: string): Promise<FundedOffer[]> {
  if (!akibaFundedVouchersHubFlag().enabled) return [];

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("voucher_funding_allocations")
    .select(`
      id, metadata, claim_starts_at, claim_ends_at,
      spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey ( ${FUNDED_OFFER_TEMPLATE_COLUMNS} ),
      partners ( id, name, slug, image_url, status ),
      voucher_eligibility_rule_sets ( customer_copy )
    `)
    .eq("merchant_id", merchantId)
    .in("state", ["active", "scheduled"])
    .gt("claim_ends_at", nowIso)
    .order("claim_ends_at", { ascending: true });

  if (error) {
    console.error("[merchant vouchers] funded offers query failed:", error.message);
    return [];
  }

  const offers: FundedOffer[] = [];
  for (const row of (data ?? []) as unknown as RawFundedAllocation[]) {
    const merchant = one(row.partners);
    const ruleSet = one(row.voucher_eligibility_rule_sets);
    if (!merchant || merchant.status !== "active" || isHiddenPartner(merchant.id)) continue;
    const offer = toFundedOffer({
      allocationId: row.id,
      claimEndsAt: row.claim_ends_at,
      template: one(row.spend_voucher_templates),
      partner: merchant,
      eligibilitySummary: ruleSet?.customer_copy ?? null,
    });
    if (offer) {
      offer.redemptionSchedule = row.metadata?.redemption_schedule ?? null;
      offer.claimStartsAt = row.claim_starts_at;
      offer.claimsOpen = row.claim_starts_at <= nowIso;
      offers.push(offer);
    }
  }
  return offers;
}

export async function getClaimedMerchantFundedAllocationIds(
  allocationIds: string[],
  userId: string | null,
  email: string | null,
): Promise<Set<string>> {
  if (!userId || allocationIds.length === 0) return new Set();
  const admin = createAdminClient();
  let canonicalId = userId;
  if (email) {
    const { data: link } = await admin
      .from("identity_links")
      .select("canonical_id")
      .eq("identity_type", "email")
      .eq("identity_value", email)
      .maybeSingle();
    if (link?.canonical_id) canonicalId = link.canonical_id;
  }

  const { data, error } = await admin
    .from("voucher_claims")
    .select("allocation_id")
    .eq("canonical_id", canonicalId)
    .in("allocation_id", allocationIds);
  if (error) {
    console.error("[merchant vouchers] claimed allocations query failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.allocation_id as string));
}
