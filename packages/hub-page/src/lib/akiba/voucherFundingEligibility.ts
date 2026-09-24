// Member-facing copy for Akiba-Platform's eligibility rule type keys, shown
// on a Funded-by-Akiba offer card before the member attempts to claim.
// Keys match the `type` values evaluateAllocationEligibility() (Akiba-Platform
// packages/api/lib/voucherFunding/eligibility.ts) returns in
// `requirementsRemaining` — kept in sync with that function's rule catalogue,
// not the admin-facing labels (which describe the rule to an operator, not
// the action a member should take).
export const REQUIREMENT_COPY: Record<string, { text: string; href?: string; cta?: string }> = {
  pass_activated: { text: "Activate your Akiba Pass", href: "/pass", cta: "Activate Pass" },
  profile_country_set: { text: "Set your country in your profile", href: "/me", cta: "Update profile" },
  country_in: { text: "Not available in your country yet" },
  minimum_account_age_days: { text: "Your account needs to be a little older for this offer" },
  verified_activity_completed: { text: "Complete a qualifying activity first" },
  first_funded_voucher: { text: "Limited to members who haven't claimed an Akiba-funded voucher before" },
  no_prior_merchant_redemption: { text: "Limited to new customers of this merchant" },
  fund_claim_cooldown: { text: "You've claimed an Akiba-funded voucher recently — check back later" },
};

export function requirementCopy(type: string): { text: string; href?: string; cta?: string } {
  return REQUIREMENT_COPY[type] ?? { text: type.replaceAll("_", " ") };
}

export interface EligibilityPreview {
  eligible: boolean;
  alreadyClaimed: boolean;
  requirementsRemaining: string[];
  allocationAvailable: boolean;
  claimFriction?: import("@/lib/vouchers/claimIntent").VoucherClaimFriction;
}
