import { describe, expect, it } from "vitest";
import { isValidEligibilityRule } from "@/lib/voucherFunds";

// akiba-funded-voucher-runtime-hardening-spec.md Phase 1 item 6: the cooldown
// field name mismatch (Admin sent cooldownSeconds, Platform reads days) and
// not_blocked silently passing. isValidEligibilityRule is the Admin-side
// boundary that must now reject both before a rule set ever reaches the RPC.
describe("isValidEligibilityRule — not_blocked", () => {
  it("is rejected outright, even though it remains a recognized rule type for historical display", () => {
    expect(isValidEligibilityRule({ type: "not_blocked" })).toBe(false);
  });
});

describe("isValidEligibilityRule — fund_claim_cooldown", () => {
  it("accepts a valid positive bounded integer days value", () => {
    expect(isValidEligibilityRule({ type: "fund_claim_cooldown", days: 30 })).toBe(true);
  });

  it.each([
    ["missing", {}],
    ["zero", { days: 0 }],
    ["negative", { days: -1 }],
    ["non-integer", { days: 1.5 }],
    ["over the 365-day bound", { days: 366 }],
    ["the legacy cooldownSeconds field name", { cooldownSeconds: 2592000 }],
    ["a string", { days: "30" }],
  ])("rejects %s", (_label, ruleExtra) => {
    expect(isValidEligibilityRule({ type: "fund_claim_cooldown", ...ruleExtra })).toBe(false);
  });
});

describe("isValidEligibilityRule — minimum_account_age_days", () => {
  it("accepts a valid positive bounded integer days value", () => {
    expect(isValidEligibilityRule({ type: "minimum_account_age_days", days: 7 })).toBe(true);
  });

  it.each([
    ["missing", {}],
    ["zero", { days: 0 }],
    ["negative", { days: -1 }],
    ["fractional", { days: 1.5 }],
    ["NaN", { days: NaN }],
    ["over the 3650-day bound", { days: 3651 }],
    ["a string", { days: "7" }],
    ["blank-string coerced input", { days: "" }],
  ])("rejects %s rather than silently becoming zero/no-minimum", (_label, ruleExtra) => {
    expect(isValidEligibilityRule({ type: "minimum_account_age_days", ...ruleExtra })).toBe(false);
  });
});

describe("isValidEligibilityRule — country_in", () => {
  it("accepts a non-empty list of canonical uppercase ISO-2 codes", () => {
    expect(isValidEligibilityRule({ type: "country_in", countries: ["KE"] })).toBe(true);
  });

  it.each([
    ["an empty list", { countries: [] }],
    ["missing", {}],
    ["a lowercase code", { countries: ["ke"] }],
    ["a display name", { countries: ["Kenya"] }],
    ["a three-letter code", { countries: ["KEN"] }],
    ["a non-array value", { countries: "KE" }],
  ])("rejects %s", (_label, ruleExtra) => {
    expect(isValidEligibilityRule({ type: "country_in", ...ruleExtra })).toBe(false);
  });
});
