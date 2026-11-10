import { describe, expect, it } from "vitest";
import { queueReturnPath, reviewHref } from "@/lib/queueNavigation";
import { openingHoursRows, safePublicUrl } from "@/lib/reviewPresentation";

describe("review navigation and content", () => {
  it("preserves queue search and filters through a review", () => {
    const back = "/ops-queue?type=profile_reviews&q=coffee&sort=newest";
    expect(queueReturnPath(back)).toBe(back);
    expect(
      new URL(
        reviewHref("merchant-id", back),
        "https://local.test"
      ).searchParams.get("returnTo")
    ).toBe(back);
  });
  it.each([
    "https://evil.test/ops-queue",
    "//evil.test/ops-queue",
    "javascript:alert(1)",
    "/settings",
    ["/ops-queue"],
  ])("rejects an unsafe return destination", (value) => {
    expect(queueReturnPath(value)).toBe("/ops-queue");
  });
  it("only links to web URLs", () => {
    expect(safePublicUrl("javascript:alert(1)")).toBeNull();
    expect(safePublicUrl("data:text/html,hello")).toBeNull();
    expect(safePublicUrl("https://example.com/profile")).toBe(
      "https://example.com/profile"
    );
  });
  it("distinguishes closed days from missing or malformed hours", () => {
    expect(
      openingHoursRows({
        monday: [{ opens: "07:00", closes: "22:00" }],
        tuesday: [],
        wednesday: [{ bad: true }],
      })
    ).toEqual([
      { day: "Monday", hours: "07:00–22:00" },
      { day: "Tuesday", hours: "Closed" },
      { day: "Wednesday", hours: "Not supplied" },
    ]);
    expect(openingHoursRows(null)).toEqual([
      { day: "Hours", hours: "Not supplied" },
    ]);
  });
});
