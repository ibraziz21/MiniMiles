/**
 * POST /api/games/start-intent
 *
 * Thin proxy → Express backend /games/start-intent
 * All signature validation and chain submission logic lives in packages/backend.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError } from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/start-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return NextResponse.json(data, { status });
  } catch (err: any) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: "proxy-timeout" }, { status: 504 });
    }
    console.error("[proxy/games/start-intent]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
