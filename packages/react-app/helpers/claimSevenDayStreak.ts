async function claimSevenDayStreak(addr: string) {
  const res = await fetch("/api/quests/seven_day_streak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress: addr.toLowerCase(),
      questId: "6ddc811a-1a4d-4e57-871d-836f07486531",
    }),
  }).then((r) => r.json());
  return res;
}
