/**
 * GET /api/games/settlement-status?sessionId=...&wallet=...
 *
 * Thin proxy → Express backend /games/settlement-status
 * If the backend is unavailable, returns a structured degraded error.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  GAMES_STATUS_PROXY_TIMEOUT_MS,
  fetchUpstreamJson,
  isAbortError,
  makeDegradedError,
} from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  const qs = new URL(req.url).searchParams.toString();
  try {
    const { data, status } = await fetchUpstreamJson(
      `${BACKEND}/games/settlement-status?${qs}`,
      {},
      GAMES_STATUS_PROXY_TIMEOUT_MS,
    );
    if (status >= 500) {
      return NextResponse.json(
        makeDegradedError({ reason: "upstream-5xx", upstreamStatus: status }),
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status });
  } catch (err: unknown) {
    const isTimeout = isAbortError(err);
    console.error("[proxy/games/settlement-status]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      makeDegradedError({ reason: isTimeout ? "timeout" : "unreachable" }),
      { status: isTimeout ? 504 : 502 },
    );
  }
}
