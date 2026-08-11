/**
 * POST /api/admin/settle-skill-game-leaderboard?secret=<ADMIN_QUEUE_SECRET>
 *
 * skill-games-leaderboards-spec.md §6, §4.6, §7 step 6. Runs the dormant
 * canonical settlement path for the most recently closed Africa/Nairobi
 * week, against every game_weekly_campaigns row that covers it — regardless
 * of prize_state, since a dry run is meant to be observable before a
 * campaign is ever armed.
 *
 * LEADERBOARD_PRIZE_ISSUANCE_ENABLED is read here, server-side, and gates
 * everything: while it's unset/false (the only state in this release) this
 * route can only reach snapshot_skill_game_leaderboard_week (status
 * 'dry_run') — the reservation/issuance RPCs are simply never called, so a
 * disabled or draft campaign cannot issue anything even if this endpoint is
 * invoked manually (invariant #9). There is no dry_run query-param override
 * like the legacy settle-weekly-prizes route has — the flag is the only gate.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isoWeek } from "@/lib/games/week";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ISSUANCE_ENABLED = process.env.LEADERBOARD_PRIZE_ISSUANCE_ENABLED === "true";
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Nairobi is a fixed UTC+3, no DST

// Same secrets/shape as api/internal/process-sponsored-game-jobs — Vercel
// Cron sends `Authorization: Bearer $CRON_SECRET` on the GET trigger; manual
// invocation uses ADMIN_QUEUE_SECRET as either a bearer token or ?secret=.
function isAuthorized(req: Request): boolean {
  const secrets = [process.env.ADMIN_QUEUE_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[];
  if (secrets.length === 0) return false;
  const bearer = req.headers.get("authorization") ?? "";
  if (secrets.some((secret) => bearer === `Bearer ${secret}`)) return true;
  const querySecret = new URL(req.url).searchParams.get("secret");
  return querySecret != null && secrets.includes(querySecret);
}

/** The most recently closed Africa/Nairobi week: [last Monday 00:00 EAT, this Monday 00:00 EAT). */
function lastClosedEatWeek(now = new Date()): { week: string; periodStart: string; periodEnd: string } {
  const nairobiNow = new Date(now.getTime() + EAT_OFFSET_MS);
  const diffToThisMonday = (nairobiNow.getUTCDay() + 6) % 7;
  // Calendar-correct (not instant-correct) Dates — same trick isoWeek() itself
  // uses — so week-label math sees the right Y/M/D even though these Date
  // objects don't represent the true UTC instant.
  const thisMondayCalendar = new Date(Date.UTC(
    nairobiNow.getUTCFullYear(), nairobiNow.getUTCMonth(), nairobiNow.getUTCDate() - diffToThisMonday
  ));
  const lastMondayCalendar = new Date(thisMondayCalendar.getTime() - 7 * 86_400_000);

  return {
    week: isoWeek(lastMondayCalendar),
    periodStart: new Date(lastMondayCalendar.getTime() - EAT_OFFSET_MS).toISOString(),
    periodEnd: new Date(thisMondayCalendar.getTime() - EAT_OFFSET_MS).toISOString(),
  };
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { week, periodStart, periodEnd } = lastClosedEatWeek();
  const weekMonday = periodStart.slice(0, 10);

  const { data: campaigns, error: campaignError } = await supabase
    .from("game_weekly_campaigns")
    .select("id, game_types, prize_state")
    .lte("week_from", weekMonday)
    .gt("week_to", weekMonday);

  if (campaignError) {
    return NextResponse.json({ error: `campaign lookup failed: ${campaignError.message}` }, { status: 500 });
  }

  const results: Array<{
    campaignId: string;
    gameType: string;
    settlementId: string;
    status: string;
    entryCount: number;
  }> = [];

  for (const campaign of campaigns ?? []) {
    for (const gameType of (campaign.game_types as string[]) ?? []) {
      const { data: settlement, error } = await supabase.rpc("snapshot_skill_game_leaderboard_week", {
        p_campaign_id: campaign.id,
        p_game_type: gameType,
        p_week: week,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) {
        console.error(`[settle-skill-game-leaderboard] snapshot failed campaign=${campaign.id} game=${gameType}`, error.message);
        continue;
      }
      const row = Array.isArray(settlement) ? settlement[0] : settlement;
      results.push({
        campaignId: campaign.id,
        gameType,
        settlementId: row?.id,
        status: row?.status,
        entryCount: Array.isArray(row?.standings_snapshot) ? row.standings_snapshot.length : 0,
      });

      // Reservation/issuance are intentionally unreachable from this route
      // while the flag is off — this `if` is the entire gate, not a runtime
      // check inside a shared code path a bug could route around.
      if (ISSUANCE_ENABLED) {
        console.warn(
          `[settle-skill-game-leaderboard] LEADERBOARD_PRIZE_ISSUANCE_ENABLED=true but this release never arms a ` +
          `campaign or calls the reservation/issuance RPCs — settlement ${row?.id} stays dry_run.`
        );
      }
    }
  }

  return NextResponse.json({ week, periodStart, periodEnd, issuanceEnabled: ISSUANCE_ENABLED, results });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
