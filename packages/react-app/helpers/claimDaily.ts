export async function claimDailyQuest(userAddress: string) {
    const res = await fetch("/api/quests/daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress,
        questId: "a9c68150-7db8-4555-b87f-5e9117b43a08", // replace with actual daily quest UUID
      }),
    })
  
    return res.json()
  }
  