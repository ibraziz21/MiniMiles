import { describe, it, expect } from "vitest";
import { getDeliveryTier, applyVoucher, calculateOrderTotal } from "../lib/spendOrderPricing";

// ── getDeliveryTier ───────────────────────────────────────────────────────────

describe("getDeliveryTier", () => {
  it("returns $3 urban rate for Nairobi", () => {
    expect(getDeliveryTier("Nairobi").fee_cusd).toBe(3.0);
    expect(getDeliveryTier("nairobi").fee_cusd).toBe(3.0);
    expect(getDeliveryTier("  Nairobi  ").fee_cusd).toBe(3.0);
  });

  it("returns $3 urban rate for Mombasa", () => {
    expect(getDeliveryTier("Mombasa").fee_cusd).toBe(3.0);
  });

  it("returns $5 rate for known towns", () => {
    expect(getDeliveryTier("Kisumu").fee_cusd).toBe(5.0);
    expect(getDeliveryTier("Eldoret").fee_cusd).toBe(5.0);
  });

  it("returns $5 default for unknown cities", () => {
    expect(getDeliveryTier("Somewhere").fee_cusd).toBe(5.0);
  });

  it("returns correct ETAs", () => {
    expect(getDeliveryTier("Nairobi").eta).toBe("1–2 days");
    expect(getDeliveryTier("Kisumu").eta).toBe("3–5 days");
    expect(getDeliveryTier("Somewhere").eta).toBe("3–5 days");
  });
});

// ── applyVoucher ──────────────────────────────────────────────────────────────

describe("applyVoucher", () => {
  it("returns original price when no voucher", () => {
    expect(applyVoucher(10, "electronics", null)).toBe(10);
  });

  it("free voucher: zeros price when product <= max value", () => {
    expect(applyVoucher(10, "food", { voucher_type: "free", max_item_value_cusd: 15 })).toBe(0);
    expect(applyVoucher(15, "food", { voucher_type: "free", max_item_value_cusd: 15 })).toBe(0);
  });

  it("free voucher: leaves price unchanged when product > max value", () => {
    expect(applyVoucher(20, "food", { voucher_type: "free", max_item_value_cusd: 15 })).toBe(20);
  });

  it("free voucher: uses default max 15 when not specified", () => {
    expect(applyVoucher(14, "food", { voucher_type: "free" })).toBe(0);
    expect(applyVoucher(16, "food", { voucher_type: "free" })).toBe(16);
  });

  it("percent_off: applies discount correctly", () => {
    expect(applyVoucher(100, "electronics", { voucher_type: "percent_off", discount_percent: 20 })).toBe(80);
    expect(applyVoucher(50, "electronics", { voucher_type: "percent_off", discount_percent: 10 })).toBe(45);
  });

  it("fixed_off: subtracts fixed amount, floor at 0", () => {
    expect(applyVoucher(20, "clothing", { voucher_type: "fixed_off", discount_cusd: 5 })).toBe(15);
    expect(applyVoucher(3, "clothing", { voucher_type: "fixed_off", discount_cusd: 5 })).toBe(0);
  });

  it("category restriction: does not apply when category mismatches", () => {
    const voucher = { voucher_type: "percent_off" as const, discount_percent: 50, applicable_category: "food" };
    expect(applyVoucher(100, "electronics", voucher)).toBe(100);
  });

  it("category restriction: applies when category matches", () => {
    const voucher = { voucher_type: "percent_off" as const, discount_percent: 50, applicable_category: "food" };
    expect(applyVoucher(100, "food", voucher)).toBe(50);
  });

  it("category restriction: applies when product category is null (unknown)", () => {
    // Unknown product category → restriction not enforced, voucher applies
    const voucher = { voucher_type: "percent_off" as const, discount_percent: 25, applicable_category: "food" };
    expect(applyVoucher(100, null, voucher)).toBe(75);
  });
});

// ── calculateOrderTotal ───────────────────────────────────────────────────────

describe("calculateOrderTotal", () => {
  it("calculates total without voucher (Nairobi urban)", () => {
    const result = calculateOrderTotal({
      product_price_cusd: 10,
      product_category: "general",
      city: "Nairobi",
      voucher: null,
    });
    expect(result.product_price_cusd).toBe(10);
    expect(result.delivery_fee_cusd).toBe(3);
    expect(result.total_cusd).toBe(13);
    expect(result.voucher_applied).toBe(false);
    expect(result.discounted_product_cusd).toBe(10);
  });

  it("calculates total with percent_off voucher", () => {
    const result = calculateOrderTotal({
      product_price_cusd: 20,
      product_category: "electronics",
      city: "Nairobi",
      voucher: { voucher_type: "percent_off", discount_percent: 50 },
    });
    expect(result.discounted_product_cusd).toBe(10);
    expect(result.delivery_fee_cusd).toBe(3);
    expect(result.total_cusd).toBe(13);
    expect(result.voucher_applied).toBe(true);
  });

  it("calculates total with free voucher", () => {
    const result = calculateOrderTotal({
      product_price_cusd: 10,
      product_category: "food",
      city: "Mombasa",
      voucher: { voucher_type: "free", max_item_value_cusd: 15 },
    });
    expect(result.discounted_product_cusd).toBe(0);
    expect(result.delivery_fee_cusd).toBe(3);
    expect(result.total_cusd).toBe(3);
    expect(result.voucher_applied).toBe(true);
  });

  it("voucher_applied is false when voucher does not reduce price (category mismatch)", () => {
    const result = calculateOrderTotal({
      product_price_cusd: 20,
      product_category: "electronics",
      city: "Nairobi",
      voucher: { voucher_type: "percent_off", discount_percent: 50, applicable_category: "food" },
    });
    expect(result.discounted_product_cusd).toBe(20);
    expect(result.voucher_applied).toBe(false);
  });

  it("total_kes is correctly converted at 130 rate", () => {
    const result = calculateOrderTotal({
      product_price_cusd: 10,
      product_category: null,
      city: "Nairobi",
      voucher: null,
    });
    // 13 cUSD * 130 = 1690
    expect(result.total_kes).toBe(1690);
  });

  it("avoids floating-point drift on round totals", () => {
    const result = calculateOrderTotal({
      product_price_cusd: 7,
      product_category: null,
      city: "Kisumu",
      voucher: null,
    });
    // 7 + 5 = 12.000000 — should not be 12.000000000001
    expect(result.total_cusd).toBe(12);
  });
});
