// GET /api/games/weekly-campaign
// Public: the active sponsored-prizes campaign for the current ISO week.
// Drives the leaderboard banner, games-hub copy, and homepage banner —
// the frontend never hard-codes a merchant.
//
// A campaign row with program_id set is bridged to a real merchant
// self-service allocation (voucher_program_channel_allocations, channel
// 'weekly_leaderboard_challenge' — see
// sql/leaderboard_voucher_prizes_channel_bridge.sql): merchant + tier
// display info are resolved live from voucher_programs →
// spend_voucher_templates → partners instead of the hand-authored
// merchant_id/tiers columns. All three ranks show the same voucher, since
// one program backs the whole week.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { isoWeek, weekRange } from "@/lib/games/week";

export const revalidate = 300; // cache 5 min

type Tier = {
  rank: number;
  label: string;
  discountPercent: number;
  spendCapKes: number | null;
  marketplaceMiles: number;
  burnMiles: number;
};

type Merchant = { id: string; slug: string; name: string; country: string | null; imageUrl: string | null };

const BURN_PCT = 0.8;

export async function GET() {
  const week = isoWeek();
  const weekMonday = weekRange(week).from.slice(0, 10);

  const { data: campaign, error } = await supabase
    .from("game_weekly_campaigns")
    .select(`
      id, merchant_id, game_types, tiers, program_id,
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

  let merchant: Merchant | null;
  let tiers: Tier[];

  if (campaign.program_id) {
    const { data: program } = await supabase
      .from("voucher_programs")
      .select("template_id, spend_voucher_templates ( title, discount_percent, miles_cost, partners ( id, slug, name, country, image_url ) )")
      .eq("id", campaign.program_id)
      .maybeSingle();

    const template = program?.spend_voucher_templates as unknown as {
      title: string; discount_percent: number | null; miles_cost: number;
      partners: { id: string; slug: string; name: string; country: string | null; image_url: string | null } | null;
    } | null;

    const p = template?.partners ?? null;
    merchant = p && { id: p.id, slug: p.slug, name: p.name, country: p.country, imageUrl: p.image_url };

    const label = template?.discount_percent ? `${template.discount_percent}% off` : (template?.title ?? "Voucher");
    const marketplaceMiles = template?.miles_cost ?? 0;
    tiers = [1, 2, 3].map((rank) => ({
      rank,
      label,
      discountPercent: template?.discount_percent ?? 0,
      spendCapKes: null,
      marketplaceMiles,
      burnMiles: Math.round(marketplaceMiles * BURN_PCT),
    }));
  } else {
    const m = campaign.partners as unknown as {
      id: string; slug: string; name: string; country: string | null; image_url: string | null;
    } | null;
    merchant = m && { id: m.id, slug: m.slug, name: m.name, country: m.country, imageUrl: m.image_url };
    tiers = (campaign.tiers as Array<Record<string, unknown>>).map((t) => ({
      rank:             Number(t.rank),
      label:            String(t.label ?? ""),
      discountPercent:  Number(t.discount_percent ?? 0),
      spendCapKes:      Number(t.spend_cap_kes ?? 0),
      marketplaceMiles: Number(t.marketplace_miles ?? 0),
      burnMiles:        Math.round(Number(t.marketplace_miles ?? 0) * Number(t.burn_pct ?? BURN_PCT)),
    }));
  }

  return NextResponse.json({
    week,
    campaign: {
      id: campaign.id,
      gameTypes: campaign.game_types,
      merchant,
      tiers,
    },
  });
}
