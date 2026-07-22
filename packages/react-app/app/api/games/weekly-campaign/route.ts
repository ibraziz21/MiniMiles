// GET /api/games/weekly-campaign
// Public: the active sponsored-prizes campaign for the current ISO week.
// Drives the leaderboard banner, games-hub copy, and homepage banner —
// the frontend never hard-codes a merchant.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { isoWeek, weekRange } from "@/lib/games/week";

export const revalidate = 300; // cache 5 min

export async function GET() {
  const week = isoWeek();
  const weekMonday = weekRange(week).from.slice(0, 10);

  const { data: campaign, error } = await supabase
    .from("game_weekly_campaigns")
    .select(`
      id, merchant_id, game_types, tiers,
      partners ( id, slug, name, country, image_url )
    `)
    .eq("active", true)
    .lte("week_from", weekMonday)
    .gt("week_to", weekMonday)
    .maybeSingle();

  if (error) {
    console.error("[weekly-campaign]", error.message);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ campaign: null, week });
  }

  const m = campaign.partners as unknown as {
    id: string; slug: string; name: string; country: string | null; image_url: string | null;
  } | null;

  return NextResponse.json({
    week,
    campaign: {
      id: campaign.id,
      gameTypes: campaign.game_types,
      merchant: m && {
        id: m.id,
        slug: m.slug,
        name: m.name,
        country: m.country,
        imageUrl: m.image_url,
      },
      tiers: (campaign.tiers as Array<Record<string, unknown>>).map((t) => ({
        rank:             Number(t.rank),
        label:            String(t.label ?? ""),
        discountPercent:  Number(t.discount_percent ?? 0),
        spendCapKes:      Number(t.spend_cap_kes ?? 0),
        marketplaceMiles: Number(t.marketplace_miles ?? 0),
        burnMiles:        Math.round(Number(t.marketplace_miles ?? 0) * Number(t.burn_pct ?? 0.8)),
      })),
    },
  });
}
