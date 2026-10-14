import { describe, expect, it } from "vitest";
import { getMerchantOfferAvailability } from "@/lib/merchants/offerAvailability";
import type { PublicMerchantOffer } from "@/lib/merchants/types";

function offer(overrides: Partial<PublicMerchantOffer> = {}): PublicMerchantOffer {
  return {
    id: "offer-1",
    title: "Wednesday special",
    description: "Test offer",
    terms: null,
    schedule: "weekly",
    daysOfWeek: [3],
    startTime: "17:00",
    endTime: "21:00",
    startsOn: null,
    endsOn: null,
    timezone: "Africa/Nairobi",
    remindersEnabled: true,
    reminderSet: false,
    imageUrl: null,
    requiresAkibaMiles: false,
    ...overrides,
  };
}

describe("getMerchantOfferAvailability", () => {
  it("uses the offer timezone for a weekly window", () => {
    const result = getMerchantOfferAvailability(offer(), new Date("2026-10-14T15:30:00.000Z"));
    expect(result.state).toBe("available");
    expect(result.label).toBe("Available now");
  });

  it("handles an overnight window using the selected start day", () => {
    const result = getMerchantOfferAvailability(
      offer({ daysOfWeek: [3], startTime: "22:00", endTime: "02:00" }),
      new Date("2026-10-14T22:30:00.000Z"),
    );
    expect(result.state).toBe("available");
  });

  it("marks future and expired date ranges truthfully", () => {
    expect(getMerchantOfferAvailability(
      offer({ startsOn: "2026-11-01" }),
      new Date("2026-10-14T15:30:00.000Z"),
    ).state).toBe("upcoming");
    expect(getMerchantOfferAvailability(
      offer({ endsOn: "2026-10-01" }),
      new Date("2026-10-14T15:30:00.000Z"),
    ).state).toBe("ended");
  });
});
