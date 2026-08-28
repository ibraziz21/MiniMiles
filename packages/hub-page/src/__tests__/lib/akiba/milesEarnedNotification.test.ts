import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const mockGetNextRewardSummary = vi.fn();
vi.mock("@/lib/akiba/nextReward", () => ({
  getNextRewardSummary: (...args: unknown[]) => mockGetNextRewardSummary(...args),
}));

const mockIsEnabled = vi.fn();
vi.mock("@/lib/akiba/milesEarnedNotificationsRollout", () => ({
  isMilesEarnedNotificationEnabledFor: (...args: unknown[]) => mockIsEnabled(...args),
}));

const { produceMilesEarnedNotification } = await import("@/lib/akiba/milesEarnedNotification");

const BASE_EVENT = {
  eventId: "hub-order:order-1",
  hubUserId: "user-1",
  merchantId: "merchant-1",
  merchantName: "Merchant X",
  milesAwarded: 120,
  source: "merchant_purchase" as const,
  occurredAt: "2026-08-28T00:00:00.000Z",
};

describe("produceMilesEarnedNotification (§6.1-§6.4)", () => {
  beforeEach(() => {
    mockUpsert.mockReset().mockResolvedValue({ error: null });
    mockFrom.mockClear();
    mockGetNextRewardSummary.mockReset();
    mockIsEnabled.mockReset().mockReturnValue(true);
  });

  it("does not notify when the rollout flag disables it for this member/merchant", async () => {
    mockIsEnabled.mockReturnValue(false);
    const result = await produceMilesEarnedNotification(BASE_EVENT);
    expect(result).toEqual({ ok: false, skipped: "notifications_disabled" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does not notify for a zero or non-integer amount", async () => {
    expect(await produceMilesEarnedNotification({ ...BASE_EVENT, milesAwarded: 0 })).toEqual({
      ok: false,
      skipped: "non_positive_amount",
    });
    expect(await produceMilesEarnedNotification({ ...BASE_EVENT, milesAwarded: 1.5 })).toEqual({
      ok: false,
      skipped: "non_positive_amount",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses an amount above the per-event award cap", async () => {
    const result = await produceMilesEarnedNotification({ ...BASE_EVENT, milesAwarded: 1_000_000 });
    expect(result).toEqual({ ok: false, skipped: "exceeds_cap" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("falls back to the generic template when Next Reward enrichment fails", async () => {
    mockGetNextRewardSummary.mockRejectedValue(new Error("boom"));
    const result = await produceMilesEarnedNotification(BASE_EVENT);
    expect(result).toEqual({ ok: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        deep_link: "/me/activity",
        dedupe_key: "notif:miles-earned:hub-order:order-1",
        metadata: expect.objectContaining({ amountMiles: 120, merchantName: "Merchant X", nextReward: null }),
      }),
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  });

  it("stores a progress snapshot and /me#next-reward deep link when not yet affordable", async () => {
    mockGetNextRewardSummary.mockResolvedValue({
      state: "recommended",
      balance: 200,
      recommendationLabel: "available_now",
      target: { templateId: "tmpl-1", merchantName: "Merchant Z", benefitLabel: "10% off", milesCost: 280 },
      progress: { gapMiles: 80, percent: 71, affordable: false },
    });
    const result = await produceMilesEarnedNotification(BASE_EVENT);
    expect(result).toEqual({ ok: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        deep_link: "/me#next-reward",
        metadata: expect.objectContaining({
          nextReward: { templateId: "tmpl-1", benefitLabel: "10% off", merchantName: "Merchant Z", gapMiles: 80, affordable: false },
        }),
      }),
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  });

  it("uses the /vouchers/{templateId} deep link once the credit makes a reward affordable", async () => {
    mockGetNextRewardSummary.mockResolvedValue({
      state: "recommended",
      balance: 300,
      recommendationLabel: "available_now",
      target: { templateId: "tmpl-1", merchantName: "Merchant Z", benefitLabel: "10% off", milesCost: 280 },
      progress: { gapMiles: 0, percent: 100, affordable: true },
    });
    const result = await produceMilesEarnedNotification(BASE_EVENT);
    expect(result).toEqual({ ok: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ deep_link: "/vouchers/tmpl-1" }),
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  });

  it("reports insert_failed without throwing when the outbox write errors", async () => {
    mockGetNextRewardSummary.mockResolvedValue({ state: "balance_unavailable" });
    mockUpsert.mockResolvedValue({ error: { message: "db down" } });
    const result = await produceMilesEarnedNotification(BASE_EVENT);
    expect(result).toEqual({ ok: false, skipped: "insert_failed" });
  });
});
