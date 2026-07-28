/**
 * Unit tests for the shared ISO-8601 week helper (lib/isoWeek.ts) — extracted
 * from three previously duplicated copies (leaderboard route, mock-verifier,
 * weekly-payout-snapshot route). The sponsored_game_played webhook's
 * `sgp:{wallet}:{game_type}:{iso_week}` idempotency key depends on this
 * matching Postgres's `to_char(date, 'IYYY-"W"IW')` week boundary exactly.
 */
import { describe, it, expect } from "vitest";
import { isoWeek } from "@/lib/isoWeek";

describe("isoWeek", () => {
  it("formats as YYYY-Www", () => {
    expect(isoWeek(new Date("2025-04-16T12:00:00Z"))).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("returns the same week for every day Mon–Sun", () => {
    // 2025-04-14 is a Monday in ISO week 2025-W16. Noon UTC keeps the local
    // calendar date stable across any reasonable CI/dev timezone — the
    // function itself reads local date components (getFullYear/Month/Date)
    // before switching to UTC arithmetic, so a near-midnight UTC timestamp
    // can resolve to a different local day depending on the machine's zone.
    const monday = isoWeek(new Date("2025-04-14T12:00:00Z"));
    const sunday = isoWeek(new Date("2025-04-20T12:00:00Z"));
    expect(monday).toBe("2025-W16");
    expect(sunday).toBe("2025-W16");
  });

  it("rolls over to the next week on Monday", () => {
    const sunday = isoWeek(new Date("2025-04-20T12:00:00Z"));
    const nextMonday = isoWeek(new Date("2025-04-21T12:00:00Z"));
    expect(sunday).not.toBe(nextMonday);
    expect(nextMonday).toBe("2025-W17");
  });

  it("handles the ISO year-boundary edge case (Dec 31 in week 1 of next year)", () => {
    // 2029-12-31 is a Monday, and per ISO 8601 falls in week 1 of 2030.
    expect(isoWeek(new Date("2029-12-31T12:00:00Z"))).toBe("2030-W01");
  });
});
