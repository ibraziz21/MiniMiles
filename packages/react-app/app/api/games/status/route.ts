/**
 * GET /api/games/status?wallet=0x...&gameType=rule_tap
 *
 * Thin proxy → Express backend /games/status
 * Contract reads live in packages/backend.
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const upstream = await fetch(`${BACKEND}/games/status?${qs}`);
    const data = await upstream.json();
    return NextResponse.json(data, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    console.error("[proxy/games/status]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
