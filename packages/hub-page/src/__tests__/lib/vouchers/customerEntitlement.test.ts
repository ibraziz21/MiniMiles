import { describe, expect, it } from "vitest";
import { entitlementFromOffer, entitlementFromIssued, entitlementBenefit, entitlementConditions, entitlementDates, entitlementScope } from "@/lib/vouchers/customerEntitlement";
const merchants = ["A", "B", "C"].map(id => ({ id, name: `Trader ${id}`, slug: id.toLowerCase(), imageUrl: null }));
const offer = { title: "Market voucher", voucherType: "percent_off", discountPercent: 10, discountKes: null,
  maximumDiscountKes: 200, minimumSpendKes: 300, terms: "One transaction. No cash exchange.",
  claimEndsAt: "2026-12-30T20:00:00Z", voucherValiditySeconds: 604800,
  redemptionSchedule: { days: [0, 6], timezone: "Africa/Nairobi" }, merchants };
const snapshot = { title: offer.title, voucher_type: "percent_off", discount_percent: 10, maximum_discount_kes: 200,
  minimum_spend_kes: 300, terms_text: offer.terms, eligible_merchant_ids: ["A", "B", "C"], redemption_schedule: offer.redemptionSchedule };

describe("customer entitlement contract", () => {
  it("keeps the same benefit, conditions, terms and full merchant set before and after issuance", () => {
    const before = entitlementFromOffer(offer);
    const after = entitlementFromIssued({ snapshot, expiresAt: "2026-11-05T10:00:00Z", merchants });
    expect(entitlementBenefit(before)).toBe("10% off, up to KES 200");
    expect(entitlementBenefit(after)).toBe(entitlementBenefit(before));
    expect(entitlementConditions(after)).toEqual(entitlementConditions(before));
    expect(after.terms).toBe(offer.terms);
    expect(entitlementScope(after)).toBe("Use once at any of 3 merchants");
    expect(after.merchants).toEqual(before.merchants);
    expect(after.title).not.toMatch(/200|300/); // A title cannot conceal missing conditions.
  });
  it("shows the exact event window before and after claim rather than promising later weekends", () => {
    const schedule = { ...offer.redemptionSchedule, startDate: "2026-10-31", endDate: "2026-11-01" };
    const before = entitlementFromOffer({ ...offer, redemptionSchedule: schedule });
    const after = entitlementFromIssued({ snapshot: { ...snapshot, redemption_schedule: schedule }, expiresAt: "2026-11-01T20:59:59.999Z", merchants });
    expect(entitlementConditions(before)).toContain("Use only 31 Oct 2026–1 Nov 2026 (Africa/Nairobi)");
    expect(entitlementConditions(after)).toEqual(entitlementConditions(before));
    expect(entitlementDates(before)[1]).toContain("up to 7 days");
    expect(entitlementDates(before)[1]).toContain("within the event dates");
  });
  it("separates claim deadline, duration and committed expiry", () => {
    expect(entitlementDates(entitlementFromOffer(offer))).toEqual([
      expect.stringMatching(/^Claim by .*30 Dec 2026/), "Valid for 7 days after claiming",
    ]);
    const committed = entitlementFromIssued({ snapshot, expiresAt: "2026-11-05T10:00:00Z", merchants });
    expect(entitlementDates(committed)).toEqual([expect.stringMatching(/^Use by .*5 Nov 2026/)]);
    expect(entitlementDates(committed).join(" ")).not.toContain("Dec");
  });
  it("uses the immutable snapshot even after live benefit/terms/category/product edits", () => {
    const issued = entitlementFromIssued({ snapshot: { ...snapshot, applicable_category: "food_drink", linked_product_id: "original-item" },
      template: { title: "Changed", voucher_type: "percent_off", discount_percent: 80, maximum_discount_kes: 900,
        minimum_spend_kes: 2000, terms_text: "Changed terms", applicable_category: "travel", linked_product_id: "new-item" },
      expiresAt: null, merchants });
    expect(entitlementBenefit(issued)).toBe("10% off, up to KES 200");
    expect(entitlementConditions(issued)).toContain("Minimum purchase KES 300");
    expect(entitlementConditions(issued)).toContain("On food drink");
    expect(entitlementConditions(issued)).toContain("Selected items only");
    expect(issued.terms).toBe(offer.terms);
    expect(issued.linkedProductId).toBe("original-item");
  });
  it("honours explicit null snapshot fields without resurrecting newer restrictions", () => {
    const issued = entitlementFromIssued({ snapshot: { ...snapshot, terms_text: null, applicable_category: null, linked_product_id: null },
      template: { terms_text: "New", applicable_category: "travel", linked_product_id: "new-item" }, expiresAt: null, merchants });
    expect(issued.terms).toBeNull(); expect(issued.linkedProductId).toBeNull(); expect(issued.applicableCategory).toBeNull();
  });
  it("never shrinks the merchant count or substitutes a live primary when profiles are missing", () => {
    const issued = entitlementFromIssued({ snapshot, merchants: merchants.slice(1), primaryMerchant: merchants[0], expiresAt: null });
    expect(issued.merchantCount).toBe(3); expect(issued.merchants).toHaveLength(2); expect(issued.merchantsIncomplete).toBe(true);
    expect(entitlementScope(issued)).toBe("Use once at any of 3 merchants");
  });
  it("does not guess validity when a legacy discovery payload lacks duration", () => {
    expect(entitlementDates(entitlementFromOffer({ ...offer, voucherValiditySeconds: null }))[1]).toBe("Validity details unavailable");
  });
  it("supports a legacy single merchant and KES/USD fixed benefits without inventing zero values", () => {
    const issued = entitlementFromIssued({ snapshot: null, template: { voucher_type: "fixed_off", discount_kes: 150 },
      primaryMerchant: merchants[0], merchants: [], expiresAt: null });
    expect(entitlementScope(issued)).toBe("Use once at Trader A"); expect(entitlementBenefit(issued)).toBe("KES 150 off");
    expect(entitlementBenefit({ ...issued, discountKes: null, discountCusd: 2.5 })).toBe("$2.50 off");
    expect(entitlementBenefit({ ...issued, discountKes: null })).toBe("Benefit details unavailable");
  });
});
