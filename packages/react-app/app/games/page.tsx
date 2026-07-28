"use client";

import AppHeader from "@/components/app-header";
import { GamesHub } from "@/components/games/games-hub";
import { LeaderboardWinSheet } from "@/components/games/LeaderboardWinSheet";

export default function GamesPage() {
  return (
    <>
      <AppHeader />
      <GamesHub />
      {/* Win reveal for unseen weekly prizes (spec §4) */}
      <LeaderboardWinSheet />
    </>
  );
}
