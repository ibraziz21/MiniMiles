// src/helpers/claimBalanceStreak.ts

const BALANCE_STREAK_10_QUEST_ID = "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f";
const BALANCE_STREAK_30_QUEST_ID = "a1ac5914-20d4-4436-bf02-29563938fe9d";

type BalanceStreakResponse = {
  success: boolean;
  code?: string;
  message?: string;
  minUsd?: number;
  currentUsd?: number;
  missingUsd?: number;
  scopeKey?: string;
  currentStreak?: number;
  longestStreak?: number;
};

async function postBalanceStreak(
  addr: string,
  questId: string,
  tier: "10" | "30",
): Promise<BalanceStreakResponse> {
  const res = await fetch("/api/streaks/balances", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userAddress: addr,
      questId,
      tier,
    }),
  });

  // if server throws, bubble up an error-ish object
  if (!res.ok) {
    return {
      success: false,
      code: "error",
      message: `HTTP ${res.status}`,
    };
  }

  return (await res.json()) as BalanceStreakResponse;
}

export async function claimBalanceStreak10(addr: string) {
  return postBalanceStreak(addr, BALANCE_STREAK_10_QUEST_ID, "10");
}

export async function claimBalanceStreak30(addr: string) {
  return postBalanceStreak(addr, BALANCE_STREAK_30_QUEST_ID, "30");
}
