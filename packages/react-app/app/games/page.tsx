"use client";

import AppHeader from "@/components/app-header";
import { GamesHub } from "@/components/games/games-hub";
import { LeaderboardWinSheet } from "@/components/games/LeaderboardWinSheet";
import { SponsoredPrizesAnnouncement } from "@/components/games/SponsoredPrizesAnnouncement";
import { useWeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";

export default function GamesPage() {
  const { campaign } = useWeeklyCampaign();

  return (
    <>
      <AppHeader />
      <GamesHub />
      {/* Win reveal for unseen weekly prizes (spec §4) */}
      <LeaderboardWinSheet />
      {/* One-time USDT → voucher prizes announcement (spec §1) */}
      <SponsoredPrizesAnnouncement campaign={campaign} />
    </>
  );
}
