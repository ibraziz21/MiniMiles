export async function claimTwentyTransfers(userAddress: string) {
    const res = await fetch("/api/quests/daily_20_tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress,
        questId: "60320fa4-1681-4795-8818-429f11afe784",
       }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[claimDailyCusd] error response:", errorText);
      throw new Error("Failed daily 20 transfer quest claim");
    }
    return res.json();
  }