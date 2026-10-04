import { describe, expect, it } from "vitest";
import { rankMerchantFundedOffers, rankMerchantVouchers } from "@/lib/merchants/voucherRanking";
import type { PublicVoucherSummary } from "@/lib/merchants/types";

function voucher(id: string, milesCost: number, expiresAt: string | null = null): PublicVoucherSummary {
  return {
    id,
    title: id,
    voucherType: "fixed_off",
    milesCost,
    discountPercent: null,
    discountCusd: 250,
    applicableCategory: null,
    linkedProductId: null,
    retailValueCusd: null,
    cooldownSeconds: 0,
    globalCap: null,
    expiresAt,
    branchIds: null,
  };
}

describe("rankMerchantVouchers", () => {
  it("puts affordable offers first, then orders by Miles price", () => {
    const result = rankMerchantVouchers([
      voucher("expensive", 900),
      voucher("cheapest", 100),
      voucher("affordable", 400),
    ], 500);

    expect(result.map((item) => item.id)).toEqual(["cheapest", "affordable", "expensive"]);
  });

  it("uses price ordering for signed-out members", () => {
    const result = rankMerchantVouchers([
      voucher("b", 500),
      voucher("a", 200),
    ], null);

    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("uses the nearest expiry as a stable tie-breaker", () => {
    const result = rankMerchantVouchers([
      voucher("later", 200, "2027-02-01T00:00:00.000Z"),
      voucher("sooner", 200, "2027-01-01T00:00:00.000Z"),
    ], 500);

    expect(result.map((item) => item.id)).toEqual(["sooner", "later"]);
  });
});

describe("rankMerchantFundedOffers", () => {
  it("keeps unclaimed offers ahead of already-claimed offers", () => {
    const result = rankMerchantFundedOffers(
      [{ allocationId: "claimed" }, { allocationId: "available" }],
      new Set(["claimed"]),
    );

    expect(result.map((offer) => offer.allocationId)).toEqual(["available", "claimed"]);
  });
});
