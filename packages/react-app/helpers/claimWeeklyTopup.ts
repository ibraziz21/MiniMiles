// src/helpers/claimTopupStreak.ts
export const TOPUP_STREAK_QUEST_ID =
  "96009afb-0762-4399-adb3-ced421d73072"; // 👈 update to real UUID from Supabase

type ApiResponse =
  | { success: true; txHash?: string; scopeKey?: string }
  | { success: false; code?: string; message?: string };

export async function claimTopupStreak(
  userAddress: string
): Promise<ApiResponse> {
  const res = await fetch("/api/streaks/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress,
      questId: TOPUP_STREAK_QUEST_ID,
    }),
  });

  return res.json();
}
