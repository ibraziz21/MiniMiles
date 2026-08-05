import { describe, expect, it } from "vitest";
import { validatePushCampaignInput } from "@/lib/pushCampaigns";

describe("validatePushCampaignInput", () => {
  const valid = {
    campaignType: "feature",
    title: "Fresh feature",
    body: "Open Akiba to see what is new.",
    deepLink: "/rewards",
    idempotencyKey: "request-1",
  };

  it("normalizes valid copy", () => {
    expect(validatePushCampaignInput({ ...valid, title: "  Fresh feature  " })).toEqual({
      ok: true,
      value: valid,
    });
  });

  it.each([
    [{ ...valid, campaignType: "transactional" }, "Choose a valid campaign type"],
    [{ ...valid, title: "" }, "Title must be between 1 and 60 characters"],
    [{ ...valid, body: "x".repeat(161) }, "Message must be between 1 and 160 characters"],
    [{ ...valid, deepLink: "https://example.com" }, "Destination must be a relative Akiba path such as /merchants"],
    [{ ...valid, deepLink: "//example.com" }, "Destination must be a relative Akiba path such as /merchants"],
    [{ ...valid, idempotencyKey: "" }, "Invalid idempotency key"],
  ])("rejects invalid input", (input, error) => {
    expect(validatePushCampaignInput(input)).toEqual({ ok: false, error });
  });
});
