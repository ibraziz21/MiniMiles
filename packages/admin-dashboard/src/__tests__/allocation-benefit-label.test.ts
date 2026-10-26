/**
 * The Admin Dashboard's funded-allocation benefit label.
 *
 * Three surfaces previously read spend_voucher_templates.discount_kes
 * directly and fell back to 0, so a percentage allocation read as "KES 0":
 * the allocation summary, the fund's allocation list, and — the one that
 * mattered most — the issue-voucher confirmation an operator reads before
 * granting a voucher to a member.
 *
 * They now share allocationBenefitLabel, so these cases cover all three.
 */
import { describe, it, expect } from "vitest";
import { allocationBenefitLabel } from "@/lib/voucherFunds";

describe("allocationBenefitLabel", () => {
  it("states the percentage and its cap", () => {
    expect(
      allocationBenefitLabel({
        voucherType: "percent_off",
        discountKes: null,
        discountPercent: 10,
        maximumDiscountKes: 200,
      }),
    ).toBe("10% off, up to KES 200");
  });

  it("never renders a percentage allocation as a KES amount", () => {
    // The regression this file exists for: discount_kes is null by design on
    // a percentage template, and "KES 0" told the operator the voucher was
    // worth nothing.
    const label = allocationBenefitLabel({
      voucherType: "percent_off",
      discountKes: null,
      discountPercent: 10,
      maximumDiscountKes: 200,
    });
    expect(label).not.toMatch(/KES 0\b/);
    expect(label).toContain("10%");
  });

  it("omits the cap rather than printing null when there is none", () => {
    expect(
      allocationBenefitLabel({
        voucherType: "percent_off",
        discountKes: null,
        discountPercent: 10,
        maximumDiscountKes: null,
      }),
    ).toBe("10% off");
  });

  it("renders a flat allocation as a KES amount", () => {
    expect(
      allocationBenefitLabel({
        voucherType: "fixed_off",
        discountKes: 100,
        discountPercent: null,
        maximumDiscountKes: null,
      }),
    ).toBe("KES 100 off");
  });

  it("treats a missing voucher_type as flat, for rows predating the column", () => {
    expect(
      allocationBenefitLabel({
        voucherType: null,
        discountKes: 500,
        discountPercent: null,
        maximumDiscountKes: null,
      }),
    ).toBe("KES 500 off");
  });

  it("ignores a stray percent on a flat allocation", () => {
    // A template edited outside the authoring RPC must not read as both.
    expect(
      allocationBenefitLabel({
        voucherType: "fixed_off",
        discountKes: 100,
        discountPercent: 10,
        maximumDiscountKes: 200,
      }),
    ).toBe("KES 100 off");
  });

  it("thousand-separates large amounts", () => {
    expect(
      allocationBenefitLabel({
        voucherType: "percent_off",
        discountKes: null,
        discountPercent: 15,
        maximumDiscountKes: 2500,
      }),
    ).toBe("15% off, up to KES 2,500");
  });
});
