export async function claimTenTransfers(userAddress: string) {
    const res = await fetch("/api/quests/daily_10_tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress,
        questId: "ea001296-2405-451b-a590-941af22a8df1",
       }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[claimDailyCusd] error response:", errorText);
      throw new Error("Failed daily 10 transfer quest claim");
    }
    return res.json();
  }