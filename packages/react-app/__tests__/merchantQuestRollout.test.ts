import { describe, expect, it } from "vitest";
import { QUEST_AKIBA_PASS } from "@/lib/merchantDiscoveryQuests";
import {
  getMerchantQuestRolloutConfig,
  getMerchantQuestRolloutSummary,
  isMerchantQuestEnabledForAddress,
  shouldGateMerchantQuest,
} from "@/lib/server/merchantQuestRollout";

describe("merchant quest rollout controls", () => {
  it("defaults to a fail-closed rollout", () => {
    expect(getMerchantQuestRolloutSummary({})).toEqual({
      enabled: false,
      percentage: 0,
      allowlistCount: 0,
    });
    expect(isMerchantQuestEnabledForAddress("0xabc", {})).toBe(false);
  });

  it("allows pilot wallets while the percentage cohort remains at zero", () => {
    const env = {
      MERCHANT_QUESTS_ENABLED: "true",
      MERCHANT_QUESTS_ROLLOUT_PERCENT: "0",
      MERCHANT_QUESTS_ALLOWLIST: " 0xAbC,0xDEF ",
    };

    expect(isMerchantQuestEnabledForAddress("0xabc", env)).toBe(true);
    expect(isMerchantQuestEnabledForAddress("0x123", env)).toBe(false);
    expect(getMerchantQuestRolloutSummary(env).allowlistCount).toBe(2);
  });

  it("supports a full cohort and clamps invalid percentages safely", () => {
    expect(
      isMerchantQuestEnabledForAddress("0xabc", {
        MERCHANT_QUESTS_ENABLED: "yes",
        MERCHANT_QUESTS_ROLLOUT_PERCENT: "100",
      }),
    ).toBe(true);
    expect(
      getMerchantQuestRolloutConfig({
        MERCHANT_QUESTS_ENABLED: "true",
        MERCHANT_QUESTS_ROLLOUT_PERCENT: "not-a-number",
      }).percentage,
    ).toBe(0);
  });

  it("uses the same stable cohort decision for repeated checks", () => {
    const env = {
      MERCHANT_QUESTS_ENABLED: "true",
      MERCHANT_QUESTS_ROLLOUT_PERCENT: "35",
    };

    const first = isMerchantQuestEnabledForAddress("0xCohortWallet", env);
    expect(isMerchantQuestEnabledForAddress("0xcohortwallet", env)).toBe(first);
  });

  it("does not gate legacy partner quests", () => {
    expect(shouldGateMerchantQuest("legacy-partner-quest", "0xabc", {})).toBe(
      false,
    );
    expect(shouldGateMerchantQuest(QUEST_AKIBA_PASS, "0xabc", {})).toBe(true);
  });
});
