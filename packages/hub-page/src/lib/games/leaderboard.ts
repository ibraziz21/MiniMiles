// Canonical skill-game leaderboard read (skill-games-leaderboards-spec.md
// §4.2). Thin wrapper around the server-only get_skill_game_leaderboard SQL
// function — all ranking, EAT period bounds, participant resolution, and
// display-name fallback live in the database function, not here.

import { createAdminClient } from "@/lib/supabase/admin";
import type { GameType } from "@akiba/skill-games/core";
import type { LeaderboardResponse } from "@akiba/skill-games/client";

type LeaderboardRow = {
  entries: LeaderboardResponse["entries"];
  my_best: LeaderboardResponse["myBest"];
  period_start: string;
  period_end: string;
};

export async function getSkillGameLeaderboard(
  gameType: GameType,
  scope: "daily" | "weekly",
  viewerCanonicalId: string | null,
  limit = 20
): Promise<LeaderboardResponse> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_skill_game_leaderboard", {
    p_game_type: gameType,
    p_scope: scope,
    p_viewer_canonical_id: viewerCanonicalId,
    p_limit: limit,
  });
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as LeaderboardRow | undefined;
  return {
    entries: row?.entries ?? [],
    myBest: row?.my_best ?? null,
    period: {
      scope,
      startsAt: row?.period_start ?? new Date().toISOString(),
      endsAt: row?.period_end ?? new Date().toISOString(),
    },
  };
}
