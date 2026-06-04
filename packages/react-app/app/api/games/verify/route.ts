/**
 * POST /api/games/verify
 *
 * Thin proxy → Express backend /games/verify
 * All validation, signing, and settlement logic lives in packages/backend.
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${BACKEND}/games/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err: any) {
    console.error("[proxy/games/verify]", err?.message ?? err);
    return NextResponse.json({ accepted: false, error: "backend-unavailable" }, { status: 502 });
  }
}
