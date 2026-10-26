// Voucher catalogue reads — extracted from src/app/vouchers/page.tsx so the
// web page and the /api/v1/vouchers* routes call the same loaders instead
// of each reimplementing these queries (hub-mobile-app-migration-plan.md:
// "the API route should call the same domain loader. Do not independently
// reimplement a screen's query in its route").
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_PARTNER_FILTER, isHiddenPartner } from "@/lib/akiba/hidden-partners";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";
import {
  FUNDED_OFFER_TEMPLATE_COLUMNS,
  toFundedOffer,
  type RawFundedPartner,
  type RawFundedTemplate,
} from "@/lib/vouchers/fundedOfferMapping";
import type { LoyaltyOffer } from "@/components/vouchers/LoyaltyVoucherCard";

export type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  retail_value_cusd: number | null;
  partners: {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
  } | null;
};

export async function getAllTemplates(hubUserId: string | null): Promise<VoucherTemplate[]> {
  const admin = createAdminClient();
  const { data: availability, error: availabilityError } = await admin.rpc(
    "list_available_voucher_template_ids_hub",
    { p_hub_user_id: hubUserId },
  );
  if (availabilityError) {
    console.error("[vouchers] availability query failed:", availabilityError.message);
    return [];
  }
  const templateIds = (availability ?? []).map(
    (row: { template_id: string } | string) =>
      typeof row === "string" ? row : row.template_id,
  );
  if (templateIds.length === 0) return [];

  const { data } = await admin
    .from("spend_voucher_templates")
    .select(`
      id, title, voucher_type, miles_cost, discount_percent, discount_cusd,
      applicable_category, retail_value_cusd,
      partners ( id, slug, name, image_url )
    `)
    .in("id", templateIds)
    .not("partner_id", "in", HIDDEN_PARTNER_FILTER)
    .order("miles_cost", { ascending: true });

  return ((data ?? []) as unknown[]).map((item) => {
    const d = item as Record<string, unknown>;
    const partners = Array.isArray(d.partners) ? d.partners[0] ?? null : d.partners;
    return { ...d, partners } as VoucherTemplate;
  });
}

type RawFundedAllocation = {
  id: string;
  claim_ends_at: string;
  claim_starts_at: string;
  metadata?: { redemption_schedule?: { days: number[]; timezone: string } | null };
  spend_voucher_templates: RawFundedTemplate | RawFundedTemplate[] | null;
  partners: RawFundedPartner | RawFundedPartner[] | null;
  voucher_eligibility_rule_sets:
    | { customer_copy: string | null; rules?: Array<{ type: string; days?: number[] }> }
    | Array<{ customer_copy: string | null; rules?: Array<{ type: string; days?: number[] }> }>
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Active Akiba-funded voucher offers — mirrors the filter Akiba-Platform's
 * own public discovery endpoint (GET /api/v1/voucher-funding-allocations)
 * uses, queried directly since hub-page already holds a service-role client
 * for cross-service reads elsewhere (myVouchers.ts). Never Miles-priced —
 * see akiba-funded-voucher-admin-spec.md §7.3.
 */
export async function getFundedOffers(): Promise<FundedOffer[]> {
  // Kill switch (akiba-funded-voucher-launch-hardening-spec.md §3) — this
  // reads voucher_funding_allocations directly rather than through the
  // eligibility/claim proxy routes, so it needs its own flag check; nothing
  // upstream of this function would otherwise catch a disabled flag.
  if (!akibaFundedVouchersHubFlag().enabled) return [];

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("voucher_funding_allocations")
    .select(`
      id, metadata, claim_starts_at, claim_ends_at,
      spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey ( ${FUNDED_OFFER_TEMPLATE_COLUMNS} ),
      partners ( id, name, slug, image_url, status ),
      voucher_eligibility_rule_sets ( customer_copy, rules )
    `)
    .in("state", ["active", "scheduled"])
    .gt("claim_ends_at", nowIso);

  if (error) {
    console.error("[vouchers] funded offers query failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as RawFundedAllocation[];
  const offers: FundedOffer[] = [];
  for (const row of rows) {
    const merchant = one(row.partners);
    const ruleSet = one(row.voucher_eligibility_rule_sets);
    if (!merchant) continue;
    if (merchant.status !== "active") continue;
    if (isHiddenPartner(merchant.id)) continue;

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
      const dayRule = ruleSet?.rules?.find((rule) => rule.type === "claim_day_of_week");
      if (Array.isArray(dayRule?.days)) offer.claimDays = dayRule.days;
      offers.push(offer);
    }
  }
  return offers;
}

/**
 * Which of the current member's funded-offer allocations they've already
 * claimed — computed directly against the DB with the same canonical-id
 * resolution Akiba-Platform's own eligibility/claim routes use (identity_links
 * keyed by email, falling back to the Supabase user id), rather than routing
 * through Platform's HTTP+JWT chain from the client.
 */
export async function getClaimedAllocationIds(userId: string | null, email: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
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

  const { data, error } = await admin.from("voucher_claims").select("allocation_id").eq("canonical_id", canonicalId);
  if (error) {
    console.error("[vouchers] claimed-allocations query failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.allocation_id as string));
}

type RawLoyaltyOffer = {
  template_id: string; title: string; description: string | null;
  voucher_type: "free" | "percent_off" | "fixed_off" | "bogo";
  discount_percent: number | null; discount_kes: number | null; retail_value_kes: number | null;
  minimum_spend_kes: number | null; maximum_discount_kes: number | null;
  merchant_id: string; merchant_name: string; merchant_slug: string; merchant_image_url: string | null;
  access_policy: "public" | "loyalty_qualified"; acquisition_mode: "miles" | "free"; miles_cost: number;
  qualification_mode: "any" | "all" | null; customer_copy: string | null;
  progress: LoyaltyOffer["progress"]; eligible: boolean; already_claimed: boolean;
  remaining: number | null; ends_at: string | null;
};

/**
 * Loyalty-qualified-vouchers-spec.md offers — bridges into this module's
 * direct-DB-read pattern via list_loyalty_voucher_offers_hub
 * (supabase/migrations/078_loyalty_voucher_offers_listing.sql), which calls
 * Akiba-Platform's qualification functions directly since this is the same
 * Postgres project. Covers what the Miles-catalogue/program pipeline
 * structurally can't represent — any access_policy='loyalty_qualified'
 * template, or any acquisition_mode='free' template. Inherently
 * member-specific (eligible/already_claimed/progress are computed per
 * caller) — there is no anonymous/public rendering of this list, so it
 * always returns [] without a hubUserId.
 */
export async function getLoyaltyOffers(hubUserId: string | null, email: string | null): Promise<LoyaltyOffer[]> {
  if (!hubUserId) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_loyalty_voucher_offers_hub", {
    p_hub_user_id: hubUserId,
    p_email: email,
  });
  if (error) {
    console.error("[vouchers] loyalty offers query failed:", error.message);
    return [];
  }
  return ((data ?? []) as RawLoyaltyOffer[])
    .filter((row) => !isHiddenPartner(row.merchant_id))
    .map((row) => ({
      templateId: row.template_id,
      title: row.title,
      description: row.description,
      voucherType: row.voucher_type,
      discountPercent: row.discount_percent,
      discountKes: row.discount_kes,
      retailValueKes: row.retail_value_kes,
      minimumSpendKes: row.minimum_spend_kes,
      maximumDiscountKes: row.maximum_discount_kes,
      merchant: { id: row.merchant_id, name: row.merchant_name, slug: row.merchant_slug, imageUrl: row.merchant_image_url },
      accessPolicy: row.access_policy,
      acquisitionMode: row.acquisition_mode,
      milesCost: row.miles_cost,
      qualificationMode: row.qualification_mode,
      customerCopy: row.customer_copy,
      progress: row.progress ?? [],
      eligible: row.eligible,
      alreadyClaimed: row.already_claimed,
      remaining: row.remaining,
      endsAt: row.ends_at,
    }));
}
