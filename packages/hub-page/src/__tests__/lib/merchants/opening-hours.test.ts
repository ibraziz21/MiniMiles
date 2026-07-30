/**
 * Regression test for the overnight "Open now" bug: yesterday's overnight
 * spillover (e.g. Mon 22:00–02:00) must still be checked even when today
 * also has its own (non-overnight) hours listed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { isOpenNow } from "@/lib/merchants/opening-hours";
import type { OpeningHours } from "@/lib/merchants/types";

const TIMEZONE = "UTC";

function mockNow(isoWithoutZone: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${isoWithoutZone}Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isOpenNow — overnight ranges", () => {
  it("is open at 01:00 from yesterday's overnight range, even though today also has daytime hours", () => {
    // 2024-01-02 is a Tuesday; Monday's overnight range spills into it.
    const hours: OpeningHours = {
      version: 1,
      monday: [{ opens: "22:00", closes: "02:00" }],
      tuesday: [{ opens: "09:00", closes: "17:00" }],
    };
    mockNow("2024-01-02T01:00:00");
    expect(isOpenNow(hours, TIMEZONE)).toBe(true);
  });

  it("is closed at 05:00 once yesterday's overnight range has ended and today's hours haven't started", () => {
    const hours: OpeningHours = {
      version: 1,
      monday: [{ opens: "22:00", closes: "02:00" }],
      tuesday: [{ opens: "09:00", closes: "17:00" }],
    };
    mockNow("2024-01-02T05:00:00");
    expect(isOpenNow(hours, TIMEZONE)).toBe(false);
  });

  it("is open during today's own overnight range before midnight", () => {
    const hours: OpeningHours = {
      version: 1,
      tuesday: [{ opens: "22:00", closes: "02:00" }],
    };
    mockNow("2024-01-02T23:00:00");
    expect(isOpenNow(hours, TIMEZONE)).toBe(true);
  });

  it("is closed when there are no hours for today or yesterday's spillover", () => {
    const hours: OpeningHours = { version: 1, monday: [], tuesday: [] };
    mockNow("2024-01-02T10:00:00");
    expect(isOpenNow(hours, TIMEZONE)).toBe(false);
  });
});
