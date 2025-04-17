export async function claimDailyTransfer(userAddress: string) {
    const res = await fetch("/api/quests/daily_transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress,
        questId: "383eaa90-75aa-4592-a783-ad9126e8f04d",
       }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[claimDailyCusd] error response:", errorText);
      throw new Error("Failed daily cUSD quest claim");
    }
    return res.json();
  }