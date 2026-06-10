/**
 * POST /api/games/register-start
 *
 * Records a user-started on-chain game session with the backend verifier.
 * The backend validates the session against the chain before writing.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError } from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/register-start?${qs}`, {});
    return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: "proxy-timeout" }, { status: 504 });
    }
    console.error("[proxy/games/register-start]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/register-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return NextResponse.json(data, { status });
  } catch (err: any) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: "proxy-timeout" }, { status: 504 });
    }
    console.error("[proxy/games/register-start]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
