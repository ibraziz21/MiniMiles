import { NextResponse } from "next/server";
import { requireGameIdentity } from "@/lib/games/identity";
import { gamesBackend, GamesBackendError, type GameType } from "@/lib/games/backendClient";
import { GAME_DAILY_PLAY_CAP } from "@/lib/games/gameRewardRules";

function isGameType(value: unknown): value is GameType {
  return value === "rule_tap" || value === "memory_flip";
}

export async function GET(req: Request) {
  const gameType = new URL(req.url).searchParams.get("gameType");
  if (!isGameType(gameType)) {
    return NextResponse.json({ error: "valid gameType required" }, { status: 400 });
  }

  const auth = await requireGameIdentity(req, { scope: "games_status", limit: 60, windowSeconds: 60 });
  if (!auth.ok) return auth.response;

  try {
    const status = await gamesBackend.status(auth.context.identity, gameType);
    return NextResponse.json({
      gameType,
      dailyCap: GAME_DAILY_PLAY_CAP,
      playsToday: status.playsToday,
      playsRemaining: status.playsRemaining,
      nextResetAt: status.nextResetAt,
      bestScoreToday: status.bestScoreToday,
      serviceAvailable: true,
      // Mastery economy v1 (§3.4) — undefined/null under the legacy economy.
      economyVersion: status.economyVersion ?? "legacy",
      bestTierToday: status.bestTierToday ?? null,
      gameMilesToday: status.gameMilesToday ?? null,
      gameMilesAvailableToday: status.gameMilesAvailableToday ?? null,
      gameMilesThisMonth: status.gameMilesThisMonth ?? null,
      monthlyGameMilesCap: status.monthlyGameMilesCap ?? null,
      monthlyGameMilesRemaining: status.monthlyGameMilesRemaining ?? null,
    });
  } catch (err) {
    if (err instanceof GamesBackendError) {
      return NextResponse.json({ error: err.code, serviceAvailable: false }, { status: err.status });
    }
    console.error("[api/games/status] backend call failed:", err);
    return NextResponse.json({ error: "game-service-unavailable", serviceAvailable: false }, { status: 503 });
  }
}
