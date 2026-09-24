import { describe, expect, it } from "vitest";
import { claimIntentIsValid, summarizeVoucherClaimHistory } from "@/lib/vouchers/claimIntent";

describe("voucher claim friction", () => {
  it("adds friction only for vouchers that expired unused", () => {
    const history = summarizeVoucherClaimHistory([
      { status: "redeemed", expires_at: "2026-01-01T00:00:00Z" },
      { status: "issued", expires_at: "2026-10-01T00:00:00Z" },
      { status: "expired", expires_at: "2026-08-01T00:00:00Z" },
      { status: "void", expires_at: "2026-08-01T00:00:00Z" },
    ], new Date("2026-09-24T00:00:00Z"));

    expect(history).toEqual({
      expiredUnusedCount: 1,
      activeUnusedCount: 1,
      redeemedCount: 1,
      requiresUsePlan: true,
    });
  });

  it("also catches issued vouchers whose expiry has passed", () => {
    const history = summarizeVoucherClaimHistory([
      { status: "issued", expires_at: "2026-09-01T00:00:00Z" },
    ], new Date("2026-09-24T00:00:00Z"));

    expect(history.expiredUnusedCount).toBe(1);
    expect(history.activeUnusedCount).toBe(0);
  });

  it("requires a valid use plan when prior vouchers expired unused", () => {
    const friction = { expiredUnusedCount: 1, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: true };
    expect(claimIntentIsValid(true, null, friction)).toBe(false);
    expect(claimIntentIsValid(true, "planned_visit", friction)).toBe(true);
    expect(claimIntentIsValid(true, "made_up", friction)).toBe(false);
  });
});
