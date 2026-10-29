import { describe, expect, it } from "vitest";
import { toNairobiDateTimeInput, fromNairobiDateTimeInput } from "@/lib/voucherFundDates";
describe("funding windows use Nairobi time", () => {
  it("round-trips saved UTC dates without moving a draft window three hours", () => {
    expect(toNairobiDateTimeInput("2026-10-28T21:00:00Z")).toBe("2026-10-29T00:00");
    expect(fromNairobiDateTimeInput("2026-10-29T00:00")).toBe("2026-10-28T21:00:00.000Z");
    expect(fromNairobiDateTimeInput(toNairobiDateTimeInput("2026-11-01T20:59:00Z"))).toBe("2026-11-01T20:59:00.000Z");
  });
  it.each(["2026-02-30T00:00", "2026-10-31T24:00", "not-a-date"])("rejects invalid input %s", value => expect(() => fromNairobiDateTimeInput(value)).toThrow());
});
