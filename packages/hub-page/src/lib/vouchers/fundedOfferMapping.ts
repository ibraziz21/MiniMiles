/**
 * One definition of how a voucher_funding_allocations row becomes a
 * FundedOffer, shared by the vouchers catalogue and the merchant page.
 *
 * It exists because those two loaders previously each carried their own copy
 * of the template select list and the "is this row usable?" check, and both
 * copies dropped any offer whose discount_kes was null. A percentage benefit
 * stores discount_kes = NULL by design (Akiba-Platform 151 — a flat amount
 * beside a percentage would be a second, contradictory answer to what the
 * voucher is worth), so every percentage offer silently vanished from
 * discovery while the database and the claim path were working correctly.
 *
 * Keeping the select fragment next to the validity check is the point: a
 * column added to one and not the other is what produced that bug.
 */
import type { FundedOffer, MerchantSummary } from "@/components/vouchers/FundedOfferCard";
import { isMultiMerchantOffer, offerMerchants } from "@/components/vouchers/FundedOfferCard";
import {
  multiMerchantFundedOffersV1Flag,
  percentFundedOffersV1Flag,
} from "@/lib/featureFlags.server";

/** Template columns every funded-offer surface needs. */
export const FUNDED_OFFER_TEMPLATE_COLUMNS =
  "title, description, terms_text, voucher_type, discount_kes, discount_percent, maximum_discount_kes, minimum_spend_kes";

export type RawFundedTemplate = {
  title: string;
  description?: string | null;
  terms_text: string | null;
  voucher_type: string | null;
  discount_kes: number | null;
  discount_percent: number | null;
  maximum_discount_kes: number | null;
  minimum_spend_kes: number | null;
};

export type RawFundedPartner = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  status: string;
};

/**
 * Null when the row cannot be rendered honestly — a missing minimum spend, a
 * flat offer with no amount, or a percentage offer with no percent. A
 * percentage offer missing only its cap is still shown ("10% off"), because
 * the claim path refuses it with BENEFIT_CONFIGURATION_INVALID and the
 * customer is better served by seeing the offer and a failed claim than by
 * the offer disappearing with no trace.
 */
export function toFundedOffer(input: {
  allocationId: string;
  claimEndsAt: string;
  voucherValiditySeconds?: number | null;
  template: RawFundedTemplate | null;
  partner: RawFundedPartner | null;
  eligibilitySummary: string | null;
  /**
   * The resolved participant list, primary first. `null` means the set could
   * not be fully resolved — the offer is withheld rather than advertised with
   * a shorter list (BDR-006 / launch spec rule 7).
   */
  participants: MerchantSummary[] | null;
}): FundedOffer | null {
  const { template, partner, participants } = input;
  if (!template || !partner) return null;
  if (!participants || participants.length === 0) return null;
  if (template.minimum_spend_kes == null) return null;

  const isPercent = template.voucher_type === "percent_off";
  if (isPercent) {
    if (template.discount_percent == null) return null;
  } else if (template.discount_kes == null) {
    return null;
  }

  return {
    allocationId: input.allocationId,
    title: template.title,
    voucherType: isPercent ? "percent_off" : "fixed_off",
    discountKes: isPercent ? null : template.discount_kes,
    discountPercent: isPercent ? template.discount_percent : null,
    maximumDiscountKes: isPercent ? template.maximum_discount_kes : null,
    minimumSpendKes: template.minimum_spend_kes,
    terms: template.terms_text,
    eligibilitySummary: input.eligibilitySummary,
    claimEndsAt: input.claimEndsAt,
    voucherValiditySeconds: input.voucherValiditySeconds ?? null,
    merchant: { name: partner.name, slug: partner.slug, imageUrl: partner.image_url },
    merchants: participants,
  };
}

/**
 * Narrows a funded-offer list to what the /api/v1/* mobile contract can be
 * served safely, for the three v1 routes only. The web pages call the loaders
 * directly and always see everything.
 *
 * A released mobile build parses the funded-offer payload with
 * `discountKes: z.number()` via `schema.parse`, which throws — and the schema
 * covers the whole catalogue object, so one percentage offer (which carries
 * `discountKes: null` by design) fails validation for the entire response and
 * breaks the Rewards tab and merchant detail rather than hiding one card.
 *
 * Publishing an allocation reveals it to every surface at once, since the web
 * page and the v1 routes share getFundedOffers(). This is therefore the only
 * thing that makes "launch on web first" real.
 *
 * Remove this, and the flag, once the minimum supported build ships the
 * widened contract.
 */
export function fundedOffersForV1(offers: FundedOffer[]): FundedOffer[] {
  // Each shape is gated by its own flag and the two compose. The previous
  // `if (percentEnabled) return offers` short-circuit meant enabling
  // percentage offers also released every other unsupported shape, which is
  // exactly the kind of coupling that makes a compatibility gate useless.
  const percentAllowed = percentFundedOffersV1Flag().enabled;
  const multiMerchantAllowed = multiMerchantFundedOffersV1Flag().enabled;

  return offers.filter((offer) => {
    // Neither `merchants` nor `merchant`: the participant scope is unknown,
    // so the offer cannot be described honestly to any client. A legacy
    // offer carrying a valid `merchant` is fine — it really was
    // single-merchant — but one carrying neither is malformed, not legacy.
    if (offerMerchants(offer).length === 0) return false;
    if (!percentAllowed && offer.voucherType === "percent_off") return false;
    if (!multiMerchantAllowed && isMultiMerchantOffer(offer)) return false;
    return true;
  });
}

/** Whether a v1 client may be served this allocation at all. */
export function allocationSupportedByV1(offer: FundedOffer): boolean {
  return fundedOffersForV1([offer]).length === 1;
}
