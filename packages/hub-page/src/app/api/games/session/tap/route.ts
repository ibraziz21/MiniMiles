import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireGameIdentity } from "@/lib/games/identity";
import { gamesBackend, GamesBackendError } from "@/lib/games/backendClient";

export async function POST(req: Request) {
  const auth = await requireGameIdentity(
    req,
    { scope: "games_action", limit: 600, windowSeconds: 60 },
    { mutation: true }
  );
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  if (!body?.sessionId || !Number.isInteger(body?.tileIndex)) {
    return NextResponse.json({ error: "sessionId and integer tileIndex required" }, { status: 400 });
  }
  const offsetMs = typeof body.offsetMs === "number" ? body.offsetMs : 0;
  const actionId = typeof body.actionId === "string" && body.actionId ? body.actionId : randomUUID();

  try {
    const result = await gamesBackend.tap(auth.context.identity, body.sessionId, body.tileIndex, offsetMs, actionId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GamesBackendError) {
      return NextResponse.json({ error: err.code }, { status: err.status === 401 ? 503 : err.status });
    }
    console.error("[api/games/session/tap] backend call failed:", err);
    return NextResponse.json({ error: "game-service-unavailable" }, { status: 503 });
  }
}
