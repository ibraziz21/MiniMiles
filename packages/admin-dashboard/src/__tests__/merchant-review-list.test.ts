import { describe, expect, it } from "vitest";
import {
  reviewKind,
  reviewListFilters,
  type MerchantReviewRow,
} from "@/lib/merchantReviewList";
import { queueReturnPath, reviewHref } from "@/lib/queueNavigation";

const row = (
  id: string,
  changes: Partial<MerchantReviewRow> = {}
): MerchantReviewRow => ({
  id,
  name: "Coffee House",
  location: "Westlands, Nairobi",
  status: "pending_review",
  submittedAt: "2026-11-09T08:00:00Z",
  updatedAt: null,
  publishedAt: null,
  ...changes,
});
describe("merchant publishing review filters", () => {
  it("classifies updates only from real publication history", () => {
    expect(reviewKind(row("new"))).toBe("new");
    expect(
      reviewKind(row("old", { publishedAt: "2026-10-01T08:00:00Z" }))
    ).toBe("updates");
  });
  it("searches name/location, excludes non-pending records and orders oldest first", () => {
    const data = [
      row("latest"),
      row("first", { submittedAt: "2026-11-08T08:00:00Z" }),
      row("published", { status: "published" }),
      row("elsewhere", { location: "Mombasa" }),
    ];
    expect(
      reviewListFilters(data, "nairobi", "all").map((item) => item.id)
    ).toEqual(["first", "latest"]);
    expect(reviewListFilters(data, "coffee", "updates")).toEqual([]);
  });
  it("preserves dedicated-list filters through review and preview links", () => {
    const back = "/directory-reviews?kind=updates&q=Westlands";
    expect(queueReturnPath(back)).toBe(back);
    expect(
      new URL(reviewHref("id", back), "https://local.test").searchParams.get(
        "returnTo"
      )
    ).toBe(back);
    expect(queueReturnPath("/directory-reviews/another-id")).toBe("/ops-queue");
  });
});
