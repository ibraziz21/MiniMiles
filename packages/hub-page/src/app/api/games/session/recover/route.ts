import { NextResponse } from "next/server";
import { requireGameIdentity } from "@/lib/games/identity";
import { gamesBackend, GamesBackendError } from "@/lib/games/backendClient";

export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  // Recovery only ever uses sessionId through the authenticated BFF — never a
  // wallet from the query string (§14).
  const auth = await requireGameIdentity(req, { scope: "games_recover", limit: 60, windowSeconds: 60 });
  if (!auth.ok) return auth.response;

  try {
    const result = await gamesBackend.recover(auth.context.identity, sessionId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GamesBackendError) {
      return NextResponse.json({ error: err.code }, { status: err.status === 401 ? 503 : err.status });
    }
    console.error("[api/games/session/recover] backend call failed:", err);
    return NextResponse.json({ error: "game-service-unavailable" }, { status: 503 });
  }
}
