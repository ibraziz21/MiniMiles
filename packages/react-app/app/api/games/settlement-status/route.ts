/**
 * GET /api/games/settlement-status?sessionId=...&wallet=...
 *
 * Thin proxy -> Express backend /games/settlement-status
 */

import { NextRequest, NextResponse } from "next/server";
import { GAMES_STATUS_PROXY_TIMEOUT_MS, fetchUpstreamJson, isAbortError } from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const { data, status } = await fetchUpstreamJson(
      `${BACKEND}/games/settlement-status?${url.searchParams.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
      GAMES_STATUS_PROXY_TIMEOUT_MS,
    );
    return NextResponse.json(data, { status });
  } catch (err: any) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: "proxy-timeout" }, { status: 504 });
    }
    console.error("[proxy/games/settlement-status]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
