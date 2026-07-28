import { NextResponse } from "next/server";
import { isoWeek, weekRange } from "@/lib/games/week";
import { supabase } from "@/lib/supabaseClient";
import { summarizeMerchantQuestHealth } from "@/lib/server/merchantQuestHealth";
import { getMerchantQuestRolloutSummary } from "@/lib/server/merchantQuestRollout";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.ADMIN_QUEUE_SECRET ?? "";
  return (
    !!secret &&
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requestedHours = Number(
    new URL(request.url).searchParams.get("hours") ?? "24",
  );
  if (
    !Number.isInteger(requestedHours) ||
    requestedHours < 1 ||
    requestedHours > 168
  ) {
    return NextResponse.json(
      { error: "hours must be an integer between 1 and 168" },
      { status: 400 },
    );
  }

  const since = new Date(
    Date.now() - requestedHours * 60 * 60_000,
  ).toISOString();
  const weekMonday = weekRange(isoWeek()).from.slice(0, 10);

  const [jobsResult, proofsResult, eventsResult, campaignResult] =
    await Promise.all([
      supabase
        .from("minipoint_mint_jobs")
        .select("status, payload, updated_at")
        .like("reason", "partner-quest:%")
        .gte("created_at", since)
        .limit(5000),
      supabase
        .from("merchant_quest_action_proofs")
        .select("partner_quest_id")
        .gte("recorded_at", since)
        .limit(5000),
      supabase
        .from("merchant_quest_events")
        .select("event_type, partner_quest_id")
        .gte("created_at", since)
        .limit(10000),
      supabase
        .from("game_weekly_campaigns")
        .select("game_types")
        .eq("active", true)
        .lte("week_from", weekMonday)
        .gt("week_to", weekMonday)
        .maybeSingle(),
    ]);

  const queryError =
    jobsResult.error ??
    proofsResult.error ??
    eventsResult.error ??
    campaignResult.error;
  if (queryError) {
    console.error("[admin/merchant-quests/health]", queryError.message);
    return NextResponse.json(
      { error: "Merchant quest health data is unavailable" },
      { status: 503 },
    );
  }

  const gameTypes = Array.isArray(campaignResult.data?.game_types)
    ? campaignResult.data.game_types.filter(
        (value): value is string => typeof value === "string",
      )
    : null;
  const health = summarizeMerchantQuestHealth({
    jobs: jobsResult.data ?? [],
    proofs: proofsResult.data ?? [],
    events: eventsResult.data ?? [],
    activeCampaignGameTypes: gameTypes?.length ? gameTypes : null,
    rollout: getMerchantQuestRolloutSummary(),
  });

  return NextResponse.json(
    {
      window: { hours: requestedHours, since },
      ...health,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
