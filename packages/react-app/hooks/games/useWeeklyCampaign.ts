"use client";

// Active sponsored-prizes campaign for the current ISO week.
// Single source for the leaderboard banner, games-hub copy and homepage
// banner — the frontend never hard-codes a merchant.

import { useEffect, useState } from "react";

export type CampaignTier = {
  rank: number;
  label: string;
  discountPercent: number;
  spendCapKes: number;
  marketplaceMiles: number;
  burnMiles: number;
};

export type WeeklyCampaign = {
  id: string;
  gameTypes: string[];
  merchant: {
    id: string;
    slug: string;
    name: string;
    country: string | null;
    imageUrl: string | null;
  } | null;
  tiers: CampaignTier[];
};

export function useWeeklyCampaign() {
  const [campaign, setCampaign] = useState<WeeklyCampaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/games/weekly-campaign")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { if (!cancelled) setCampaign(data.campaign ?? null); })
      .catch((err) => console.error("[useWeeklyCampaign]", err))
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { campaign, isLoading };
}
