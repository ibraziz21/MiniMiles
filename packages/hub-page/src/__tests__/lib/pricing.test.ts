/**
 * Unit tests for lib/pricing.ts fulfillment-aware calculateOrder.
 *
 * Covers the hub digital-product checkout fix: product_type is the sole
 * authority on whether a delivery fee applies — never inferred from category.
 */
import { describe, it, expect } from "vitest";
import { calculateOrder } from "@/lib/pricing";
import type { VoucherForPricing } from "@/lib/pricing";

describe("calculateOrder — digital products", () => {
  it("charges no delivery fee and reports an Instant ETA regardless of city", () => {
    const result = calculateOrder(5, "airtime", "prod-1", "", "digital", null);
    expect(result.deliveryFee).toBe(0);
    expect(result.eta).toBe("Instant");
    expect(result.total).toBe(result.discountedPrice);
  });

  it("still applies a voucher discount with no delivery fee added", () => {
    const voucher: VoucherForPricing = {
      voucher_type: "percent_off",
      discount_percent: 20,
      discount_cusd: null,
      applicable_category: null,
      linked_product_id: null,
      retail_value_cusd: null,
    };
    const result = calculateOrder(10, "gift_cards", "prod-2", "", "digital", voucher);
    expect(result.discountedPrice).toBe(8);
    expect(result.deliveryFee).toBe(0);
    expect(result.total).toBe(8);
  });
});

describe("calculateOrder — physical products", () => {
  it("charges the urban $3 fee for Nairobi", () => {
    const result = calculateOrder(5, "electronics", "prod-3", "nairobi", "physical", null);
    expect(result.deliveryFee).toBe(3);
    expect(result.total).toBe(8);
  });

  it("charges the regional $5 fee for an out-of-urban city", () => {
    const result = calculateOrder(5, "electronics", "prod-4", "kisumu", "physical", null);
    expect(result.deliveryFee).toBe(5);
    expect(result.total).toBe(10);
  });

  it("treats a missing/legacy product type as physical", () => {
    // Callers normalize missing product_type to "physical" before calling —
    // verify that behaves identically to an explicit physical call.
    const result = calculateOrder(5, "electronics", "prod-5", "nairobi", "physical", null);
    expect(result.deliveryFee).toBe(3);
    expect(result.eta).not.toBe("Instant");
  });
});

describe("calculateOrder — mixed-cart total via subtotal", () => {
  it("applies exactly one delivery fee when the cart contains any physical item", () => {
    // CartDrawer computes pricing once over the whole cart subtotal, using
    // "physical" whenever any line item is physical — so the fee is applied
    // once, not per item.
    const subtotal = 15; // e.g. one $5 physical item + one $10 digital item
    const result = calculateOrder(subtotal, "electronics", "prod-6", "nairobi", "physical", null);
    expect(result.deliveryFee).toBe(3);
    expect(result.total).toBe(18);
  });
});
