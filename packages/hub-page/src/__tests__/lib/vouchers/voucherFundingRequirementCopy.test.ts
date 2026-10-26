/**
 * Member-facing copy for unmet funded-voucher eligibility rules.
 *
 * requirementCopy() falls back to `type.replaceAll("_", " ")` for an unknown
 * rule type, which puts a raw internal identifier on a customer-facing card —
 * a member tapping a weekend-only offer midweek was shown the literal words
 * "claim day of week".
 *
 * This matters more than it looks because discovery is not day-aware:
 * getFundedOffers() filters on allocation state and the claim window only, so
 * a weekend offer is visible every day of the week and midweek taps are the
 * normal case, not an edge one.
 */
import { describe, it, expect } from "vitest";
import { REQUIREMENT_COPY, requirementCopy } from "@/lib/akiba/voucherFundingEligibility";

/**
 * Every rule type the platform evaluator can report as unmet. Kept beside the
 * copy map because the fallback makes a missing entry silent — it renders
 * something, just not something a customer should read.
 */
const EVALUATOR_RULE_TYPES = [
  "country_in",
  "pass_activated",
  "profile_country_set",
  "minimum_account_age_days",
  "verified_activity_completed",
  "first_funded_voucher",
  "no_prior_merchant_redemption",
  "fund_claim_cooldown",
  "claim_day_of_week",
];

describe("funded voucher requirement copy", () => {
  it.each(EVALUATOR_RULE_TYPES)("has written copy for %s", (type) => {
    expect(REQUIREMENT_COPY[type], `${type} would fall back to its raw identifier`).toBeTruthy();
  });

  it.each(EVALUATOR_RULE_TYPES)("never shows the raw identifier for %s", (type) => {
    // The fallback's shape: underscores become spaces and nothing else.
    expect(requirementCopy(type).text).not.toBe(type.replaceAll("_", " "));
  });

  it("explains a weekend-only offer without naming days it cannot know", () => {
    const copy = requirementCopy("claim_day_of_week");
    expect(copy.text).toBe("Not available today — this offer only runs on certain days");
    // No CTA: unlike an unset profile country, there is no action the member
    // can take right now — they come back on an eligible day.
    expect(copy.cta).toBeUndefined();
    expect(copy.href).toBeUndefined();
  });

  it("still degrades readably for a rule type it has never seen", () => {
    expect(requirementCopy("some_future_rule").text).toBe("some future rule");
  });
});
