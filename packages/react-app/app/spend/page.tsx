"use client";

// The "Spend" tab is now the Games hub. Raffles live on the home page;
// the old Shop & Save / balance-card content has been removed.
import AppHeader from "@/components/app-header";
import { GamesHub } from "@/components/games/games-hub";

export default function SpendPage() {
  return (
    <>
      <AppHeader />
      <GamesHub />
    </>
  );
}
