import { describe, expect, it } from "vitest";
import { nextFundedOfferOpening } from "@/lib/vouchers/fundedOfferOpening";

const offer = {
  claimStartsAt: "2026-10-26T01:59:00Z",
  claimEndsAt: "2026-11-30T00:00:00+03:00",
  redemptionSchedule: { days: [0, 6], timezone: "Africa/Nairobi" },
};
const thursday = Date.parse("2026-11-05T12:00:00+03:00");

describe("nextFundedOfferOpening", () => {
  it("finds the Nairobi weekend opening during an active claim window", () => {
    expect(nextFundedOfferOpening(offer, thursday)).toBe("2026-11-06T21:00:00.000Z");
  });

  it("skips closed claims and openings at the exclusive claim cutoff", () => {
    expect(nextFundedOfferOpening({ ...offer, claimEndsAt: "2026-11-01T02:00:00Z" }, thursday)).toBeNull();
    expect(nextFundedOfferOpening({ ...offer, claimEndsAt: "2026-11-06T21:00:00Z" }, thursday)).toBeNull();
  });

  it("waits for a future event and respects its last eligible date", () => {
    const redemptionSchedule = { days: [6], timezone: "Africa/Nairobi", startDate: "2026-11-20", endDate: "2026-11-21" };
    expect(nextFundedOfferOpening({ ...offer, redemptionSchedule }, thursday)).toBe("2026-11-20T21:00:00.000Z");
    expect(nextFundedOfferOpening({ ...offer, redemptionSchedule: { ...redemptionSchedule, endDate: "2026-11-20" } }, thursday)).toBeNull();
  });

  it("uses the claim opening when a seasonal offer has no weekday restriction", () => {
    expect(nextFundedOfferOpening({ ...offer, redemptionSchedule: null, claimStartsAt: "2026-11-12T12:00:00Z" }, thursday))
      .toBe("2026-11-12T12:00:00.000Z");
  });

  it("has no upcoming opening when the offer is usable now", () => {
    expect(nextFundedOfferOpening(offer, Date.parse("2026-11-07T12:00:00+03:00"))).toBeNull();
  });
});
