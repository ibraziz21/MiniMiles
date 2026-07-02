/**
 * POST /api/games/farkle/game-nights/register
 * Body: { address: string }
 *
 * Registers an eligible player for the current Akiba Game Night week.
 *
 * Eligibility is always recalculated server-side; the client is never trusted.
 *
 * Slot assignment: first-come-first-served up to registration_cap (default 40).
 * Players beyond the cap are waitlisted.
 *
 * Idempotent: calling again for an already-registered or waitlisted address
 * returns the existing status without creating a duplicate row.
 *
 * Cancelled rows: a previously-cancelled registration is updated in-place
 * (rather than inserting a new row) so the UNIQUE (week_id, wallet_address)
 * constraint is respected and old records are not left dangling.
 *
 * Race condition note: the cap check and insert are two separate statements
 * (no advisory lock). A small overage of registered_count is possible under
 * concurrent load. Acceptable for Phase 3; add a database-level trigger or
 * serializable transaction if strict cap enforcement is required later.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";

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

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const address = session.walletAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid session address" }, { status: 400 });
  }

  const { weekId, start, end } = currentWeekWindow();

  // ── Server-side eligibility recalculation ────────────────────────────────────

  const { data: modeRow } = await supabase
    .from("game_modes")
    .select("id")
    .eq("mode_key", REWARD_MODE_KEY)
    .maybeSingle();

  if (!modeRow?.id) {
    return NextResponse.json({ error: "Reward Duel mode not configured" }, { status: 500 });
  }

  const { data: weekMatches, error: matchErr } = await supabase
    .from("game_matches")
    .select("id")
    .eq("mode_id", modeRow.id)
    .in("status", ["completed", "settled"])
    .gte("completed_at", start.toISOString())
    .lt("completed_at", end.toISOString());

  if (matchErr) {
    console.error("[game-nights/register] match query failed:", matchErr.message);
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
      console.error("[game-nights/register] player query failed:", playerErr.message);
      return NextResponse.json({ error: "eligibility check failed" }, { status: 500 });
    }
    gamesPlayed = count ?? 0;
  }

  if (gamesPlayed < REQUIRED_GAMES) {
    return NextResponse.json(
      {
        error: `Not yet eligible: ${gamesPlayed}/${REQUIRED_GAMES} Reward Duel games completed this week`,
        gamesPlayed,
        requiredGames: REQUIRED_GAMES,
      },
      { status: 403 },
    );
  }

  // ── Ensure week row exists (ON CONFLICT DO NOTHING preserves admin edits) ────

  await supabase
    .from("farkle_game_night_weeks")
    .upsert(
      {
        id:                      weekId,
        qualification_starts_at: start.toISOString(),
        qualification_ends_at:   end.toISOString(),
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

  // ── Idempotency: return early if already registered or waitlisted ─────────────

  const { data: existing } = await supabase
    .from("farkle_game_night_registrations")
    .select("status")
    .eq("week_id", weekId)
    .eq("wallet_address", address)
    .maybeSingle();

  if (existing?.status === "registered" || existing?.status === "waitlisted") {
    const { count: slotCount } = await supabase
      .from("farkle_game_night_registrations")
      .select("id", { count: "exact", head: true })
      .eq("week_id", weekId)
      .eq("status", "registered");

    return NextResponse.json(
      {
        ok:            true,
        weekId,
        status:        existing.status,
        gamesPlayed,
        requiredGames: REQUIRED_GAMES,
        slotNumber:    existing.status === "registered" ? (slotCount ?? null) : null,
      },
      NO_STORE,
    );
  }

  // ── Determine slot availability ───────────────────────────────────────────────

  const [{ count: registeredCount }, { data: weekRow }] = await Promise.all([
    supabase
      .from("farkle_game_night_registrations")
      .select("id", { count: "exact", head: true })
      .eq("week_id", weekId)
      .eq("status", "registered"),
    supabase
      .from("farkle_game_night_weeks")
      .select("registration_cap")
      .eq("id", weekId)
      .maybeSingle(),
  ]);

  const cap       = weekRow?.registration_cap ?? 40;
  const newStatus = (registeredCount ?? 0) < cap ? "registered" : "waitlisted";
  const nowIso    = new Date().toISOString();

  // ── Insert or re-activate a cancelled row ────────────────────────────────────

  if (existing?.status === "cancelled") {
    const { error: updateErr } = await supabase
      .from("farkle_game_night_registrations")
      .update({
        status:                       newStatus,
        games_played_at_registration: gamesPlayed,
        registered_at:                nowIso,
        updated_at:                   nowIso,
      })
      .eq("week_id",        weekId)
      .eq("wallet_address", address);

    if (updateErr) {
      console.error("[game-nights/register] re-activate failed:", updateErr.message);
      return NextResponse.json({ error: "registration failed" }, { status: 500 });
    }
  } else {
    const { error: insertErr } = await supabase
      .from("farkle_game_night_registrations")
      .insert({
        week_id:                      weekId,
        wallet_address:               address,
        status:                       newStatus,
        games_played_at_registration: gamesPlayed,
        registered_at:                nowIso,
        updated_at:                   nowIso,
      });

    if (insertErr) {
      console.error("[game-nights/register] insert failed:", insertErr.message);
      return NextResponse.json({ error: "registration failed" }, { status: 500 });
    }
  }

  // Slot number = current registered count (approximate position; see race note above)
  let slotNumber: number | null = null;
  if (newStatus === "registered") {
    const { count: finalCount } = await supabase
      .from("farkle_game_night_registrations")
      .select("id", { count: "exact", head: true })
      .eq("week_id", weekId)
      .eq("status", "registered");
    slotNumber = finalCount ?? null;
  }

  return NextResponse.json(
    {
      ok:            true,
      weekId,
      status:        newStatus,
      gamesPlayed,
      requiredGames: REQUIRED_GAMES,
      slotNumber,
    },
    NO_STORE,
  );
}
