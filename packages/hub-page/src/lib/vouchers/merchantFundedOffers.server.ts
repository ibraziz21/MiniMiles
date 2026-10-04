import { isHiddenPartner } from "@/lib/akiba/hidden-partners";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";

type RawFundedAllocation = {
  id: string;
  claim_ends_at: string;
  spend_voucher_templates:
    | { title: string; terms_text: string | null; discount_kes: number | null; minimum_spend_kes: number | null }
    | Array<{ title: string; terms_text: string | null; discount_kes: number | null; minimum_spend_kes: number | null }>
    | null;
  partners:
    | { id: string; name: string; slug: string; image_url: string | null; status: string }
    | Array<{ id: string; name: string; slug: string; image_url: string | null; status: string }>
    | null;
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
      id, claim_ends_at,
      spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey ( title, terms_text, discount_kes, minimum_spend_kes ),
      partners ( id, name, slug, image_url, status ),
      voucher_eligibility_rule_sets ( customer_copy )
    `)
    .eq("merchant_id", merchantId)
    .eq("state", "active")
    .lte("claim_starts_at", nowIso)
    .gt("claim_ends_at", nowIso)
    .order("claim_ends_at", { ascending: true });

  if (error) {
    console.error("[merchant vouchers] funded offers query failed:", error.message);
    return [];
  }

  const offers: FundedOffer[] = [];
  for (const row of (data ?? []) as unknown as RawFundedAllocation[]) {
    const template = one(row.spend_voucher_templates);
    const merchant = one(row.partners);
    const ruleSet = one(row.voucher_eligibility_rule_sets);
    if (!template || !merchant || merchant.status !== "active" || isHiddenPartner(merchant.id)) continue;
    if (template.discount_kes == null || template.minimum_spend_kes == null) continue;
    offers.push({
      allocationId: row.id,
      title: template.title,
      discountKes: template.discount_kes,
      minimumSpendKes: template.minimum_spend_kes,
      terms: template.terms_text,
      eligibilitySummary: ruleSet?.customer_copy ?? null,
      claimEndsAt: row.claim_ends_at,
      merchant: { name: merchant.name, slug: merchant.slug, imageUrl: merchant.image_url },
    });
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
