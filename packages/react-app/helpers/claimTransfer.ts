export async function claimDailyTransfer(userAddress: string) {
    const res = await fetch("/api/quests/daily_transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress,
        questId: "a9c68150-7db8-4555-b87f-5e9117b43a08",
       }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[claimDailyCusd] error response:", errorText);
      throw new Error("Failed daily cUSD quest claim");
    }
    return res.json();
  }