// src/helpers/claimBalanceStreak.ts

type ApiResponse = {
    success: boolean;
    code?: string;
    message?: string;
    minUsd?: number;
    currentUsd?: number;
    missingUsd?: number;
    currentStreak?: number;
    longestStreak?: number;
  };
  
  export async function claimBalanceStreak10(addr: string): Promise<ApiResponse> {
    const res = await fetch("/api/streaks/balances", {
      method: "POST",
      body: JSON.stringify({
        userAddress: addr,
        questId: "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f", // $10 streak quest
        tier: "10",
      }),
    });
  
    return res.json();
  }
  
  export async function claimBalanceStreak30(addr: string): Promise<ApiResponse> {
    const res = await fetch("/api/streaks/balances", {
      method: "POST",
      body: JSON.stringify({
        userAddress: addr,
        questId: "a1ac5914-20d4-4436-bf02-29563938fe9d", // $30 streak quest
        tier: "30",
      }),
    });
  
    return res.json();
  }
  