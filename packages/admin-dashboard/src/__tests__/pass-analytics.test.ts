import { describe, expect, it } from "vitest";
import {
  csvCell,
  defaultPassAnalyticsRange,
  passAnalyticsUtcBounds,
  shiftIsoDate,
  validatePassAnalyticsRange,
} from "@/lib/passAnalytics";

describe("Pass analytics date handling", () => {
  it("uses the Nairobi calendar day for the default 30-day range", () => {
    expect(defaultPassAnalyticsRange(new Date("2026-09-08T21:30:00Z"))).toEqual({
      from: "2026-08-11",
      to: "2026-09-09",
      days: 30,
    });
  });

  it("validates inclusive date ranges", () => {
    expect(validatePassAnalyticsRange("2026-09-01", "2026-09-08")).toEqual({
      ok: true,
      value: { from: "2026-09-01", to: "2026-09-08", days: 8 },
    });
  });

  it.each([
    ["not-a-date", "2026-09-08", "Use valid dates"],
    ["2026-09-09", "2026-09-08", "start date"],
    ["2025-01-01", "2026-09-08", "366 days"],
  ])("rejects an invalid range", (from, to, message) => {
    const result = validatePassAnalyticsRange(from, to);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("converts Nairobi dates into an exclusive UTC window", () => {
    const range = validatePassAnalyticsRange("2026-09-01", "2026-09-08");
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    expect(passAnalyticsUtcBounds(range.value)).toEqual({
      startsAt: "2026-08-31T21:00:00.000Z",
      endsAt: "2026-09-08T21:00:00.000Z",
    });
  });

  it("shifts ISO dates across month boundaries", () => {
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("Pass analytics CSV escaping", () => {
  it("quotes embedded quotes and neutralizes spreadsheet formulas", () => {
    expect(csvCell('A "quoted" value')).toBe('"A ""quoted"" value"');
    expect(csvCell("=HYPERLINK(\"bad\")")).toBe('"\'=HYPERLINK(""bad"")"');
  });
});
