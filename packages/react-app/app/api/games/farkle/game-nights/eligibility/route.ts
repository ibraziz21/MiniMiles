/**
 * GET /api/games/farkle/game-nights/eligibility?address=0x...
 *
 * Returns a player's qualification status and registration state for the
 * current Akiba Game Night week.
 *
 * Eligibility rule: complete 20 Reward Duel (FARKLE_REWARD_3000_USDT) matches
 * whose completed_at falls within the current Mon 00:00 UTC – next Mon 00:00 UTC
 * window. We use completed_at because it is set atomically by the settle() path
 * in /api/games/farkle/[matchId]/bank and the reconciler.
 *
 * Registration status is read from farkle_game_night_registrations. If those
 * tables are missing (pre-migration environment), the query error is logged and
 * the response falls back to registrationStatus "none" so the UI stays usable.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const REWARD_MODE_KEY = "FARKLE_REWARD_3000_USDT";
const REQUIRED_GAMES  = 20;
const NO_STORE        = { headers: { "Cache-Control": "no-store" } };

function currentWeekWindow(): { weekId: string; start: Date; end: Date } {
  const now      = new Date();
  const dow      = now.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  const monday   = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysBack,
  ));
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);
  return {
    weekId: monday.toISOString().slice(0, 10),
    start:  monday,
    end:    nextMonday,
  };
}

export async function GET(req: Request) {
  const raw     = new URL(req.url).searchParams.get("address");
  const address = raw?.toLowerCase() ?? "";

  if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "missing or invalid address" }, { status: 400 });
  }

  const { weekId, start, end } = currentWeekWindow();

  // ── Eligibility: resolve mode_id ─────────────────────────────────────────────

  const { data: modeRow } = await supabase
    .from("game_modes")
    .select("id")
    .eq("mode_key", REWARD_MODE_KEY)
    .maybeSingle();

  if (!modeRow?.id) {
    return NextResponse.json(
      {
        eligible:              false,
        gamesPlayed:           0,
        requiredGames:         REQUIRED_GAMES,
        weekId,
        qualificationStartsAt: start.toISOString(),
        qualificationEndsAt:   end.toISOString(),
        registrationStatus:    "none",
        registeredCount:       0,
        cap:                   40,
      },
      NO_STORE,
    );
  }

  // ── Eligibility: completed Reward Duel matches in this week's window ──────────

  const { data: weekMatches, error: matchErr } = await supabase
    .from("game_matches")
    .select("id")
    .eq("mode_id", modeRow.id)
    .in("status", ["completed", "settled"])
    .gte("completed_at", start.toISOString())
    .lt("completed_at", end.toISOString());

  if (matchErr) {
    console.error("[game-nights/eligibility] match query failed:", matchErr.message);
    return NextResponse.json({ error: "eligibility check failed" }, { status: 500 });
  }

  const matchIds  = (weekMatches ?? []).map((m) => m.id);
  let gamesPlayed = 0;

  if (matchIds.length > 0) {
    const { count, error: playerErr } = await supabase
      .from("game_match_players")
      .select("match_id", { count: "exact", head: true })
      .eq("wallet_address", address)
      .in("match_id", matchIds);

    if (playerErr) {
      console.error("[game-nights/eligibility] player query failed:", playerErr.message);
      return NextResponse.json({ error: "eligibility check failed" }, { status: 500 });
    }
    gamesPlayed = count ?? 0;
  }

  // ── Registration status (graceful fallback if tables not yet migrated) ────────

  let registrationStatus: "none" | "registered" | "waitlisted" = "none";
  let registeredCount = 0;
  let cap             = 40;

  const [regResult, countResult, weekResult] = await Promise.all([
    supabase
      .from("farkle_game_night_registrations")
      .select("status")
      .eq("week_id",        weekId)
      .eq("wallet_address", address)
      .maybeSingle(),
    supabase
      .from("farkle_game_night_registrations")
      .select("id", { count: "exact", head: true })
      .eq("week_id", weekId)
      .eq("status",  "registered"),
    supabase
      .from("farkle_game_night_weeks")
      .select("registration_cap")
      .eq("id", weekId)
      .maybeSingle(),
  ]);

  if (regResult.error) {
    console.error("[game-nights/eligibility] registration lookup failed:", regResult.error.message);
    // Fall through with registrationStatus = "none"
  } else if (
    regResult.data?.status === "registered" ||
    regResult.data?.status === "waitlisted"
  ) {
    registrationStatus = regResult.data.status as "registered" | "waitlisted";
  }

  if (!countResult.error) registeredCount = countResult.count ?? 0;
  if (!weekResult.error && weekResult.data?.registration_cap != null) {
    cap = weekResult.data.registration_cap;
  }

  return NextResponse.json(
    {
      eligible:              gamesPlayed >= REQUIRED_GAMES,
      gamesPlayed,
      requiredGames:         REQUIRED_GAMES,
      weekId,
      qualificationStartsAt: start.toISOString(),
      qualificationEndsAt:   end.toISOString(),
      registrationStatus,
      registeredCount,
      cap,
    },
    NO_STORE,
  );
}
