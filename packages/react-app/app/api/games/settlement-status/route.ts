/**
 * GET /api/games/settlement-status?sessionId=...&wallet=...
 *
 * Thin proxy -> Express backend /games/settlement-status
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const upstream = await fetch(`${BACKEND}/games/settlement-status?${url.searchParams.toString()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err: any) {
    console.error("[proxy/games/settlement-status]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
