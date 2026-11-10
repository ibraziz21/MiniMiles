import { describe, expect, it } from "vitest";
import { merchantReturnPath } from "@/lib/merchantNavigation";
import { queueReturnPath, reviewHref } from "@/lib/queueNavigation";
describe("merchant navigation", () => {
  it("preserves directory filters and rejects external or unrelated returns", () => {
    expect(merchantReturnPath("/merchants?q=Oval&view=trial")).toBe(
      "/merchants?q=Oval&view=trial"
    );
    for (const value of [
      "//evil.test/merchants",
      "https://evil.test/merchants",
      "/merchants/other",
      "/ops-queue",
      "/\\evil.test/merchants",
    ])
      expect(merchantReturnPath(value)).toBe("/merchants");
  });
  it("returns from profile review to the exact merchant section", () => {
    const back =
      "/merchants/22222222-2222-4222-8222-222222222222?view=profile&returnTo=%2Fmerchants%3Fq%3DOval";
    expect(queueReturnPath(back)).toBe(back);
    expect(
      new URL(reviewHref("id", back), "https://local.test").searchParams.get(
        "returnTo"
      )
    ).toBe(back);
    expect(queueReturnPath("/merchants/not-an-id")).toBe("/ops-queue");
  });
});
