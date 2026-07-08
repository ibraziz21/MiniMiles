// GET /api/crackpot/feed?version=miles|usdt
//
// Public social feed — no auth required.
// Returns recent entries, live player count, best locked, and last winner.

import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { supabase } from "@/lib/supabaseClient";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function GET(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  const url = new URL(req.url);
  const rawVersion = url.searchParams.get("version") ?? "miles";
  const version: CrackPotVersion = rawVersion === "usdt" ? "usdt" : "miles";

  // Fetch the current active/settling cycle for this version
  const { data: cycle } = await supabase
    .from("crackpot_cycles")
    .select("id, pot_balance, winner_address, winner_guesses")
    .eq("version", version)
    .in("status", ["active", "settling"])
    .maybeSingle();

  if (!cycle) {
    return NextResponse.json({
      entries: [],
      activePlayers: 0,
      totalAttempts: 0,
      bestLocked: null,
      watchingCount: 0,
      lastWinner: null,
    });
  }

  // Recent entries (last 20, for social feed)
  const { data: attempts } = await supabase
    .from("crackpot_attempts")
    .select("player_address, started_at, attempt_number")
    .eq("cycle_id", cycle.id)
    .order("started_at", { ascending: false })
    .limit(20);

  const entries = (attempts ?? []).map((a: any) => ({
    address:      shortenAddress(a.player_address),
    startedAt:    a.started_at,
    attemptNumber: a.attempt_number,
  }));

  // Total attempts for this cycle
  const { count: totalAttempts } = await supabase
    .from("crackpot_attempts")
    .select("id", { count: "exact", head: true })
    .eq("cycle_id", cycle.id);

  // Active players = distinct player_addresses with an active attempt in the last 2 minutes
  const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { count: activePlayers } = await supabase
    .from("crackpot_attempts")
    .select("player_address", { count: "exact", head: true })
    .eq("cycle_id", cycle.id)
    .eq("status", "active")
    .gte("started_at", twoMinsAgo);

  // Best locked count across all guesses this cycle
  const { data: bestRow } = await supabase
    .from("crackpot_guesses")
    .select("locked_count")
    .eq("cycle_id", cycle.id)
    .order("locked_count", { ascending: false })
    .limit(1)
    .maybeSingle();

  const bestLocked: number | null = bestRow?.locked_count ?? null;

  // Last winner (from cycle metadata)
  const lastWinner = cycle.winner_address
    ? {
        address:    shortenAddress(cycle.winner_address),
        guesses:    cycle.winner_guesses ?? 0,
        potBalance: cycle.pot_balance ?? 0,
      }
    : null;

  return NextResponse.json({
    entries,
    activePlayers: activePlayers ?? 0,
    totalAttempts: totalAttempts ?? 0,
    bestLocked,
    watchingCount: 0,
    lastWinner,
  });
}
