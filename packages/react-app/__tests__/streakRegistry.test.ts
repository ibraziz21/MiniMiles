import { describe, expect, it } from "vitest";
import { BALANCE_STREAK_QUEST_IDS, getBalanceStreakConfigByQuestId } from "@/lib/streakRegistry";

describe("getBalanceStreakConfigByQuestId", () => {
  it("resolves each tier's fixed minUsd/points from its questId alone", () => {
    expect(getBalanceStreakConfigByQuestId(BALANCE_STREAK_QUEST_IDS["10"])).toEqual({
      questId: BALANCE_STREAK_QUEST_IDS["10"],
      tier: "10",
      minUsd: 10,
      points: 40,
    });
    expect(getBalanceStreakConfigByQuestId(BALANCE_STREAK_QUEST_IDS["30"])).toEqual({
      questId: BALANCE_STREAK_QUEST_IDS["30"],
      tier: "30",
      minUsd: 30,
      points: 50,
    });
    expect(getBalanceStreakConfigByQuestId(BALANCE_STREAK_QUEST_IDS["100"])).toEqual({
      questId: BALANCE_STREAK_QUEST_IDS["100"],
      tier: "100",
      minUsd: 100,
      points: 70,
    });
  });

  it("returns null for an unregistered questId — a mismatched tier/questId pair can never be forged", () => {
    expect(getBalanceStreakConfigByQuestId("not-a-real-quest-id")).toBeNull();
    // Specifically: the $10 tier's questId can never resolve $100-tier points
    // no matter what a client claims — there is no client-supplied `tier`
    // input to this function at all.
    const config = getBalanceStreakConfigByQuestId(BALANCE_STREAK_QUEST_IDS["10"]);
    expect(config?.points).toBe(40);
    expect(config?.points).not.toBe(70);
  });
});
