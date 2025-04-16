export async function claimDailyReceive(userAddress: string) {
    const res = await fetch("/api/quests/daily_receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress,
        questId: "c6b14ae1-66e9-4777-9c9f-65e57b091b16"
       }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[claimDailyReceivedCusd] error response:", errorText);
      throw new Error("Failed daily cUSD quest claim");
    }
    return res.json();
  }