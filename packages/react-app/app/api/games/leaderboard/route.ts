/**
 * GET /api/games/leaderboard?gameType=rule_tap&period=daily|weekly
 *
 * skill-games-leaderboards-spec.md §4.2, §5.1. Resolves the viewer's
 * canonical identity from the existing authenticated wallet session when one
 * exists — the previous implementation trusted a client-supplied `wallet`
 * param, used UTC day/week bounds instead of Africa/Nairobi, and crashed
 * (`.toLowerCase()` on a NULL `wallet_address`) on any walletless Hub row.
 * All of that now lives in the shared get_skill_game_leaderboard SQL
 * function so this app and Hub Page rank identically.
 *
 * A missing session does NOT 401 — React's game pages (unlike Hub's) don't
 * gate anonymous visitors behind a login redirect, and several widgets
 * (ValuePulseStrip on the home page, the games-hub rank chip) mount before
 * the wallet sign-in round-trip completes. An anonymous viewer gets the
 * public board with isYou=false everywhere and myBest=null — the same thing
 * the old wallet-optional endpoint returned — never a client-asserted
 * identity, just the absence of a resolved one.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";
import { resolveCanonicalWallet } from "@/lib/server/canonicalPartnerQuests";
import type { GameType } from "@/lib/games/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const GAME_TYPES: GameType[] = ["rule_tap", "memory_flip"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const gameType = searchParams.get("gameType") as GameType | null;
  const period = searchParams.get("period") === "weekly" ? "weekly" : "daily";

  if (!gameType || !GAME_TYPES.includes(gameType)) {
    return NextResponse.json({ error: "invalid gameType" }, { status: 400 });
  }

  const session = await requireSession();
  let canonicalId: string | null = null;
  if (session) {
    try {
      canonicalId = await resolveCanonicalWallet(session.walletAddress);
    } catch (err) {
      console.error("[leaderboard] canonical resolution failed", (err as Error).message);
      return NextResponse.json({ error: "leaderboard-unavailable" }, { status: 503 });
    }
  }

  const { data, error } = await supabase.rpc("get_skill_game_leaderboard", {
    p_game_type: gameType,
    p_scope: period,
    p_viewer_canonical_id: canonicalId,
    p_limit: 20,
  });

  if (error) {
    console.error("[leaderboard] supabase error", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;

  return NextResponse.json(
    {
      entries: row?.entries ?? [],
      myBest: row?.my_best ?? null,
      period: {
        scope: period,
        startsAt: row?.period_start ?? new Date().toISOString(),
        endsAt: row?.period_end ?? new Date().toISOString(),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
