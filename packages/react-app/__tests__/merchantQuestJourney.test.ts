import { describe, expect, it } from "vitest";
import {
  buildMerchantQuestActionHref,
  friendlyMerchantQuestError,
  isMerchantQuestActionRequired,
  safeMerchantQuestReturnTo,
} from "@/lib/merchantQuestJourney";

describe("merchant quest journey", () => {
  it("adds a safe return path without dropping existing query parameters", () => {
    expect(
      buildMerchantQuestActionHref(
        "/akiba-pass?src=earn_quest",
        "quest-123",
      ),
    ).toBe(
      "/akiba-pass?src=earn_quest&merchantQuest=quest-123&returnTo=%2Fearn%3Fquest%3Dquest-123",
    );
  });

  it("maps verification failures to actionable user copy", () => {
    expect(friendlyMerchantQuestError(undefined, "country-not-set")).toContain(
      "Add your country",
    );
    expect(
      isMerchantQuestActionRequired(undefined, "country-not-set"),
    ).toBe(true);
  });

  it("allows only Earn return paths", () => {
    expect(safeMerchantQuestReturnTo("/earn?quest=quest-123")).toBe(
      "/earn?quest=quest-123",
    );
    expect(safeMerchantQuestReturnTo("https://example.com")).toBeNull();
    expect(safeMerchantQuestReturnTo("/spend")).toBeNull();
  });
});
