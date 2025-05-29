export async function claimFiveTransfers(userAddress: string) {
    const res = await fetch("/api/quests/daily_5_tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress,
        questId: "f6d027d2-bf52-4768-a87f-2be00a5b03a0",
       }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[claimDailyCusd] error response:", errorText);
      throw new Error("Failed daily 5 transfer quest claim");
    }
    return res.json();
  }