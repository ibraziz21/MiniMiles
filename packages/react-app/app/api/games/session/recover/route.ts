/**
 * GET /api/games/session/recover?sessionId=...&wallet=...
 *
 * Thin proxy → Express backend GET /games/session/recover
 * Returns a structured lifecycle snapshot so the frontend can surface
 * a clear nextAction instead of an infinite pending state.
 * Static route — takes precedence over /session/[action] for this path.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  GAMES_STATUS_PROXY_TIMEOUT_MS,
  fetchUpstreamJson,
  isAbortError,
  makeDegradedError,
} from "../../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  try {
    const { data, status } = await fetchUpstreamJson(
      `${BACKEND}/games/session/recover?${qs}`,
      {},
      GAMES_STATUS_PROXY_TIMEOUT_MS,
    );
    if (status >= 500) {
      return NextResponse.json(
        makeDegradedError({ reason: "upstream-5xx", upstreamStatus: status }),
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const isTimeout = isAbortError(err);
    console.error("[proxy/games/session/recover]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      makeDegradedError({ reason: isTimeout ? "timeout" : "unreachable" }),
      { status: isTimeout ? 504 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
