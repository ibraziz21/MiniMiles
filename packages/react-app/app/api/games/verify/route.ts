/**
 * POST /api/games/verify
 *
 * Thin proxy → Express backend /games/verify
 * All validation, signing, and settlement logic lives in packages/backend.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError } from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return NextResponse.json(data, { status });
  } catch (err: any) {
    if (isAbortError(err)) {
      return NextResponse.json({ accepted: false, error: "proxy-timeout" }, { status: 504 });
    }
    console.error("[proxy/games/verify]", err?.message ?? err);
    return NextResponse.json({ accepted: false, error: "backend-unavailable" }, { status: 502 });
  }
}
