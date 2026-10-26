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
import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";

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
  template: RawFundedTemplate | null;
  partner: RawFundedPartner | null;
  eligibilitySummary: string | null;
}): FundedOffer | null {
  const { template, partner } = input;
  if (!template || !partner) return null;
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
    merchant: { name: partner.name, slug: partner.slug, imageUrl: partner.image_url },
  };
}
