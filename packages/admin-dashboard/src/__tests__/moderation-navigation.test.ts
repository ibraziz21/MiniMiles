import { describe, expect, it } from "vitest";
import {
  moderationPage,
  moderationReturnPath,
  validModerationId,
} from "@/lib/moderationNavigation";

describe("moderation navigation", () => {
  it("preserves only allowed local review destinations", () => {
    expect(
      moderationReturnPath("/ops-queue?type=discovery_photos&q=coffee")
    ).toBe("/ops-queue?type=discovery_photos&q=coffee");
    expect(moderationReturnPath("/discovery-photos?tab=reviewed&page=2")).toBe(
      "/discovery-photos?tab=reviewed&page=2"
    );
    for (const path of [
      "//evil.test/ops-queue",
      "javascript:alert(1)",
      "/settings",
    ])
      expect(moderationReturnPath(path)).toBe("/discovery-photos");
  });
  it("bounds pagination and validates identifiers", () => {
    for (const page of ["0", "-1", "10001", "1.5", "bad"])
      expect(moderationPage(page)).toBe(1);
    expect(moderationPage("2")).toBe(2);
    expect(validModerationId("a66f24b0-7e03-4a6f-9e1e-25a35d0758c2")).toBe(
      true
    );
    expect(validModerationId("not-a-photo")).toBe(false);
  });
});
