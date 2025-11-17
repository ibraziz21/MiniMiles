async function claimSevenDayStreak(addr: string) {
    const res = await fetch("/api/quests/seven_day_streak", {
      method: "POST",
      body: JSON.stringify({
        userAddress: addr,
        questId: "6ddc811a-1a4d-4e57-871d-836f07486531", // 👈 create this quest in Supabase with this id
      }),
    }).then((r) => r.json());
    return res;
  }
  