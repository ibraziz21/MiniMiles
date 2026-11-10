import { describe, it, expect } from "vitest";
import {
  inVoucherPeriod,
  voucherKind,
  voucherState,
  voucherPeriod,
  voucherReturnPath,
  claimDuration,
} from "@/lib/voucherPresentation";
describe("voucher presentation", () => {
  it("keeps reimbursable funding distinct from the acquisition price", () => {
    expect(
      voucherKind({ funding_mode: "akiba_reimbursement", miles_cost: 250 })
    ).toBe("reimbursable");
    expect(
      voucherKind({ funding_mode: "merchant_discount", miles_cost: 250 })
    ).toBe("miles");
    expect(
      voucherKind({ funding_mode: "merchant_discount", miles_cost: 0 })
    ).toBe("free");
  });
  it("respects publication, activation and actual claim windows", () => {
    const v = {
      active: true,
      lifecycle_state: "published",
      start_at: "2026-11-01T00:00:00Z",
      end_at: "2026-12-01T00:00:00Z",
    };
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(voucherState(v, now)).toBe("Active");
    expect(voucherState({ ...v, lifecycle_state: "draft" }, now)).toBe("draft");
    expect(voucherState({ ...v, active: false }, now)).toBe("Inactive");
    expect(voucherState({ ...v, start_at: "2026-11-10T00:00:00Z" }, now)).toBe(
      "Scheduled"
    );
    expect(voucherState({ ...v, end_at: "2026-11-09T11:00:00Z" }, now)).toBe(
      "Ended"
    );
  });
  it("starts monthly reporting at midnight EAT, including UTC month rollover", () => {
    expect(voucherPeriod("month", new Date("2026-10-31T22:00:00Z")).from).toBe(
      "2026-10-31T21:00:00.000Z"
    );
    expect(voucherPeriod("all").from).toBeNull();
    expect(
      inVoucherPeriod("2026-10-31T21:00:00+00:00", "2026-10-31T21:00:00.000Z")
    ).toBe(true);
    expect(
      inVoucherPeriod("2026-10-31T20:59:59Z", "2026-10-31T21:00:00.000Z")
    ).toBe(false);
    expect(inVoucherPeriod(null, null)).toBe(true);
    expect(inVoucherPeriod(null, "2026-10-31T21:00:00.000Z")).toBe(false);
    expect(voucherPeriod("30d", new Date("2026-11-09T12:00:00Z")).from).toBe(
      "2026-10-10T12:00:00.000Z"
    );
  });
  it("preserves filtered voucher returns while refusing other destinations", () => {
    const path =
      "/vouchers/issued?template=11111111-1111-4111-8111-111111111111&status=issued";
    expect(voucherReturnPath(path)).toBe(path);
    for (const invalid of [
      "//evil.test/vouchers",
      "https://evil.test/vouchers",
      "/vouchers/funds",
      "/overview",
      "/\\\\evil.test/vouchers",
    ])
      expect(voucherReturnPath(invalid)).toBe("/vouchers");
  });
  it("does not invent a redemption lifespan when none is recorded", () => {
    expect(claimDuration(null)).toBeNull();
    expect(claimDuration(7 * 86400)).toBe("7 days");
    expect(claimDuration(7200)).toBe("2 hours");
  });
});
