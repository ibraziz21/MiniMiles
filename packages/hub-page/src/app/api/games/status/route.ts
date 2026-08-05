import { NextResponse } from "next/server";
import { requireGameIdentity } from "@/lib/games/identity";
import { gamesBackend, GamesBackendError, type GameType } from "@/lib/games/backendClient";

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
      dailyCap: 5,
      playsToday: status.playsToday,
      playsRemaining: status.playsRemaining,
      nextResetAt: status.nextResetAt,
      bestScoreToday: status.bestScoreToday,
      serviceAvailable: true,
    });
  } catch (err) {
    if (err instanceof GamesBackendError) {
      return NextResponse.json({ error: err.code, serviceAvailable: false }, { status: err.status });
    }
    console.error("[api/games/status] backend call failed:", err);
    return NextResponse.json({ error: "game-service-unavailable", serviceAvailable: false }, { status: 503 });
  }
}
