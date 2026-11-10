import { describe, it, expect } from "vitest";
import {
  fundReturnPath,
  fundMoney,
  allocationQuantity,
  fundDate,
} from "@/lib/voucherFundNavigation";
describe("fund UI boundaries", () => {
  it("preserves a filtered fund register and refuses other destinations", () => {
    expect(fundReturnPath("/vouchers/funds?state=draft")).toBe(
      "/vouchers/funds?state=draft"
    );
    for (const invalid of [
      "//evil.test/vouchers/funds",
      "https://evil.test/vouchers/funds",
      "/vouchers/funds/new",
      "/overview",
    ])
      expect(fundReturnPath(invalid)).toBe("/vouchers/funds");
  });
  it("calculates only fully backed units at the per-voucher ceiling", () => {
    expect(allocationQuantity(200000, 400)).toBe(500);
    expect(fundMoney(20000000)).toBe("KES 200,000");
    expect(fundMoney(12345)).toBe("KES 123.45");
    expect(allocationQuantity(1000, 300)).toBe(3);
    expect(allocationQuantity(0.3, 0.1)).toBe(3);
    expect(allocationQuantity(100, 0)).toBe(0);
    expect(allocationQuantity(NaN, 400)).toBe(0);
  });
  it("displays saved funding dates in Nairobi at UTC rollover", () => {
    expect(fundDate("2026-10-31T21:00:00Z")).toMatch(/01 Nov 2026/);
  });
});
