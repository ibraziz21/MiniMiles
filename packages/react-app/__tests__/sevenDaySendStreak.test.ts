import { describe, expect, it } from "vitest";
import {
  buildSevenDaySendStreakStatusFromDays,
  collectClaimedDays,
  DAILY_SEND_QUEST_ID,
} from "@/lib/sevenDaySendStreak";

function days(...keys: string[]) {
  return new Set(keys);
}

describe("seven-day send streak", () => {
  it("is claimable when the seven-day run ended yesterday", () => {
    const status = buildSevenDaySendStreakStatusFromDays({
      today: new Date("2026-06-22T12:00:00.000Z"),
      claimedDays: days(
        "2026-06-21",
        "2026-06-20",
        "2026-06-19",
        "2026-06-18",
        "2026-06-17",
        "2026-06-16",
        "2026-06-15",
      ),
      rewardClaimedDays: days(),
    });

    expect(status.currentStreak).toBe(7);
    expect(status.progress).toBe(7);
    expect(status.daysLeft).toBe(0);
    expect(status.claimable).toBe(true);
    expect(status.completedCurrentScope).toBe(false);
  });

  it("counts queued daily-send mint jobs as completed claim days", () => {
    const allowedDates = days("2026-06-22", "2026-06-21");
    const claimedDays = collectClaimedDays({
      userAddress: "0xabc",
      questId: DAILY_SEND_QUEST_ID,
      allowedDates,
      engagementRows: [{ claimed_at: "2026-06-21T10:15:00.000Z" }],
      mintJobRows: [
        {
          status: "pending",
          payload: {
            kind: "daily_engagement",
            userAddress: "0xAbC",
            questId: DAILY_SEND_QUEST_ID,
            claimedAt: "2026-06-22",
          },
        },
      ],
    });

    expect([...claimedDays].sort()).toEqual(["2026-06-21", "2026-06-22"]);
  });

  it("does not allow another reward inside the current seven-day reward window", () => {
    const status = buildSevenDaySendStreakStatusFromDays({
      today: new Date("2026-06-22T12:00:00.000Z"),
      claimedDays: days(
        "2026-06-22",
        "2026-06-21",
        "2026-06-20",
        "2026-06-19",
        "2026-06-18",
        "2026-06-17",
        "2026-06-16",
      ),
      rewardClaimedDays: days("2026-06-20"),
    });

    expect(status.currentStreak).toBe(7);
    expect(status.rewardClaimed).toBe(true);
    expect(status.claimable).toBe(false);
  });
});
