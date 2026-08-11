// GET /api/games/leaderboard?gameType=rule_tap&period=daily|weekly
//
// skill-games-leaderboards-spec.md §5.1. Requires the Supabase session,
// resolves the caller's canonical id server-side, and never trusts a
// client-supplied viewer/wallet/canonical selector.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { getSkillGameLeaderboard } from "@/lib/games/leaderboard";
import type { GameType } from "@akiba/skill-games/core";

const GAME_TYPES: GameType[] = ["rule_tap", "memory_flip"];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const gameType = searchParams.get("gameType") as GameType | null;
  const period = searchParams.get("period") === "weekly" ? "weekly" : "daily";

  if (!gameType || !GAME_TYPES.includes(gameType)) {
    return NextResponse.json({ error: "invalid gameType" }, { status: 400 });
  }

  const canonicalId = await resolveHubQuestCanonical({ hubUserId: user.id, email: user.email ?? null });

  try {
    const response = await getSkillGameLeaderboard(gameType, period, canonicalId);
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/games/leaderboard] failed:", (err as Error).message);
    return NextResponse.json({ error: "leaderboard-unavailable" }, { status: 503 });
  }
}
