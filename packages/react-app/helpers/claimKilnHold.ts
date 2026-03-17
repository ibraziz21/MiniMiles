const KILN_DAILY_HOLD_QUEST_ID =
  process.env.NEXT_PUBLIC_KILN_DAILY_HOLD_QUEST_ID ??
  "9ca81915-8707-43c9-9472-9faed0c7cc58";

export async function claimKilnHold(userAddress: string) {
  const res = await fetch("/api/quests/daily_kiln_hold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress,
      questId: KILN_DAILY_HOLD_QUEST_ID,
    }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("[claimKilnHold] error response:", payload);
    return payload ?? { success: false, message: "server-error" };
  }

  return payload;
}
