/**
 * GET/POST /api/games/register-start
 *
 * Records a user-started on-chain game session with the backend verifier.
 * The backend validates the session against the chain before writing.
 * If the backend is unavailable, returns a structured degraded error.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError, makeDegradedError } from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  try {
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/register-start?${qs}`, {});
    if (status >= 500) {
      return NextResponse.json(
        makeDegradedError({ reason: "upstream-5xx", upstreamStatus: status }),
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const isTimeout = isAbortError(err);
    console.error("[proxy/games/register-start GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      makeDegradedError({ reason: isTimeout ? "timeout" : "unreachable" }),
      { status: isTimeout ? 504 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/register-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (status >= 500) {
      return NextResponse.json(
        makeDegradedError({ reason: "upstream-5xx", upstreamStatus: status }),
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status });
  } catch (err: unknown) {
    const isTimeout = isAbortError(err);
    console.error("[proxy/games/register-start POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      makeDegradedError({ reason: isTimeout ? "timeout" : "unreachable" }),
      { status: isTimeout ? 504 : 502 },
    );
  }
}
