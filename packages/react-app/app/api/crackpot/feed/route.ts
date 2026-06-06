// GET /api/crackpot/feed?version=miles|usdt
// Returns live social data for the active cycle:
//   - recent entries (last 10, anonymised)
//   - attempt count this cycle
//   - active players right now (attempts started in last 2 min)
//   - near-miss aggregate (best locked count across all players, no identity)
//   - last winner (if cycle just cracked)

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const version = url.searchParams.get("version") ?? "miles";

    const { data: cycle } = await supabase
      .from("crackpot_cycles")
      .select("id, status, pot_balance, winner_address, winner_guesses, version")
      .eq("version", version)
      .in("status", ["active", "cracked"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!cycle) return NextResponse.json({ entries: [], activePlayers: 0, totalAttempts: 0, bestLocked: null, lastWinner: null });

    const cycleId = cycle.id;
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    // Recent attempts — last 10, for the feed
    const { data: recentAttempts } = await supabase
      .from("crackpot_attempts")
      .select("player_address, started_at, attempt_number")
      .eq("cycle_id", cycleId)
      .order("started_at", { ascending: false })
      .limit(10);

    // Active right now (started attempt in last 2 min, still active)
    const { count: activePlayers } = await supabase
      .from("crackpot_attempts")
      .select("id", { count: "exact", head: true })
      .eq("cycle_id", cycleId)
      .eq("status", "active")
      .gte("started_at", twoMinAgo);

    // Total attempts this cycle
    const { count: totalAttempts } = await supabase
      .from("crackpot_attempts")
      .select("id", { count: "exact", head: true })
      .eq("cycle_id", cycleId);

    // Near-miss: best locked_count across all guesses this cycle
    const { data: bestGuessRow } = await supabase
      .from("crackpot_guesses")
      .select("locked_count")
      .eq("cycle_id", cycleId)
      .order("locked_count", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Watching: unique addresses that hit cycle/current in last 10 min
    // Approximated by unique player_addresses with attempts in last 10 min
    const { data: recentActive } = await supabase
      .from("crackpot_attempts")
      .select("player_address")
      .eq("cycle_id", cycleId)
      .gte("started_at", tenMinAgo);

    const watchingCount = new Set((recentActive ?? []).map((r: any) => r.player_address)).size;

    const entries = (recentAttempts ?? []).map((a: any) => ({
      address: shortAddr(a.player_address),
      startedAt: a.started_at,
      attemptNumber: a.attempt_number,
    }));

    const lastWinner = cycle.status === "cracked" && cycle.winner_address
      ? { address: shortAddr(cycle.winner_address), guesses: cycle.winner_guesses, potBalance: cycle.pot_balance }
      : null;

    return NextResponse.json({
      entries,
      activePlayers: activePlayers ?? 0,
      totalAttempts: totalAttempts ?? 0,
      bestLocked: bestGuessRow?.locked_count ?? null,
      watchingCount,
      lastWinner,
    });
  } catch (err: any) {
    console.error("[crackpot/feed]", err);
    return NextResponse.json({ entries: [], activePlayers: 0, totalAttempts: 0, bestLocked: null, watchingCount: 0, lastWinner: null });
  }
}
