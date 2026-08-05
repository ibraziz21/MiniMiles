import { NextResponse } from "next/server";
import { requireGameIdentity } from "@/lib/games/identity";
import { gamesBackend, GamesBackendError, type GameType } from "@/lib/games/backendClient";

function isGameType(value: unknown): value is GameType {
  return value === "rule_tap" || value === "memory_flip";
}

export async function POST(req: Request) {
  const auth = await requireGameIdentity(
    req,
    { scope: "games_start", limit: 20, windowSeconds: 600 },
    { mutation: true }
  );
  if (!auth.ok) return auth.response;

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json({ error: "idempotency-key-required" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  if (!isGameType(body?.gameType)) {
    return NextResponse.json({ error: "valid gameType required" }, { status: 400 });
  }

  try {
    const result = await gamesBackend.start(auth.context.identity, body.gameType, idempotencyKey);
    if (!result.ok) {
      const status = result.errorCode === "daily-cap-reached" || result.errorCode === "idempotency-conflict" ? 409 : 400;
      return NextResponse.json({ error: result.errorCode }, { status });
    }
    return NextResponse.json({
      sessionId: result.sessionId,
      gameType: body.gameType,
      status: result.status,
      playsToday: result.playsToday,
      playsRemaining: result.playsRemaining,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof GamesBackendError) {
      return NextResponse.json({ error: err.code }, { status: err.status === 401 ? 503 : err.status });
    }
    console.error("[api/games/session/start] backend call failed:", err);
    return NextResponse.json({ error: "game-service-unavailable" }, { status: 503 });
  }
}
