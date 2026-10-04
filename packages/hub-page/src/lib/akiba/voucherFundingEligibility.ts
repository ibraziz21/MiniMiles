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
  // Akiba-funded country gate (profile-country-eligibility spec §8.2/§9.1) —
  // distinct from the generic rules above: an unset profile is fixable right
  // now, a mismatched one is a hard "not for you" with no CTA.
  profile_country_required: { text: "Set your profile country to Kenya to claim this offer.", href: "/me", cta: "Update profile" },
  profile_country_mismatch: { text: "This offer is available only to members whose profile country is Kenya." },
  // Web2 username identity gate (voucher-web2-username-identity-spec.md
  // §3.4) — every funded claim requires an active Akiba @username; never a
  // wallet, so the CTA always points at choosing one, never connecting.
  username_required: { text: "Choose an Akiba username to claim this offer.", href: "/me", cta: "Choose username" },
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
