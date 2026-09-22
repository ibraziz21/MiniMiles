import { describe, it, expect } from "vitest";
import { dealLabel } from "@/lib/akiba/deals";

describe("dealLabel", () => {
  it("labels a percent_off voucher", () => {
    expect(dealLabel({ voucher_type: "percent_off", discount_percent: 20, discount_cusd: null, retail_value_cusd: null })).toBe("20% off");
  });

  it("labels a cUSD fixed_off voucher (legacy merchant-funded)", () => {
    expect(dealLabel({ voucher_type: "fixed_off", discount_percent: null, discount_cusd: 5, retail_value_cusd: null })).toBe("$5.00 off");
  });

  it("prefers KES over cUSD for a fixed_off voucher when discount_kes is set — Akiba-funded and other KES pilots (086_kes_voucher_runtime.sql) never set discount_cusd", () => {
    expect(
      dealLabel({ voucher_type: "fixed_off", discount_percent: null, discount_cusd: null, discount_kes: 500, retail_value_cusd: null }),
    ).toBe("KES 500 off");
  });

  it("labels a free voucher with a retail value", () => {
    expect(dealLabel({ voucher_type: "free", discount_percent: null, discount_cusd: null, retail_value_cusd: 12 })).toBe("Free (up to $12.00)");
  });

  it("labels a free voucher without a retail value", () => {
    expect(dealLabel({ voucher_type: "free", discount_percent: null, discount_cusd: null, retail_value_cusd: null })).toBe("Free item");
  });
});
