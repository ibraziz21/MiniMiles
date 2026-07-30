import { describe, expect, it } from "vitest";
import { parseModerationRequest } from "@/lib/merchant-directory-review";

describe("parseModerationRequest", () => {
  it("normalizes valid reviewer input", () => {
    expect(parseModerationRequest({
      action: "request_changes",
      affectedSections: ["locations", "locations", "contact"],
      merchantSafeMessage: "  Confirm your primary branch.  ",
      internalNote: "  Map pin is outside the stated city.  ",
    })).toEqual({
      ok: true,
      value: {
        action: "request_changes",
        affectedSections: ["locations", "contact"],
        merchantSafeMessage: "Confirm your primary branch.",
        internalNote: "Map pin is outside the stated city.",
      },
    });
  });

  it("rejects unknown sections and unknown actions", () => {
    expect(parseModerationRequest({
      action: "approve",
      affectedSections: ["payments"],
    }).ok).toBe(false);
  });

  it("rejects fields that could override server-owned identity or merchant ID", () => {
    expect(parseModerationRequest({
      action: "publish",
      partnerId: "20000000-0000-4000-8000-000000000002",
    }).ok).toBe(false);
  });
});
