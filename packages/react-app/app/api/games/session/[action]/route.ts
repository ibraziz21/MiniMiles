/**
 * POST /api/games/session/:action  (action ∈ init | flip | tick | tap | finish)
 *
 * Thin proxy for the server-authoritative skill-game flows.
 * Memory Flip uses init/flip/finish; Rule Tap uses init/tick/tap/finish.
 * Note: /session/init for memory_flip returns the full deck in hybrid mode —
 * the client renders locally while the server scores authoritatively.
 * If the backend is unavailable, returns a structured degraded error so both
 * games fail consistently rather than silently falling back to local logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError, makeDegradedError } from "../../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";
const ALLOWED = new Set(["init", "flip", "tick", "tap", "finish"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: "unknown-action" }, { status: 404 });
  }
  const body = await req.text();
  try {
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/session/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (status >= 500) {
      return NextResponse.json(
        makeDegradedError({ reason: "upstream-5xx", upstreamStatus: status }),
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const isTimeout = isAbortError(err);
    console.error(`[proxy/games/session/${action}]`, err instanceof Error ? err.message : err);
    return NextResponse.json(
      makeDegradedError({ reason: isTimeout ? "timeout" : "unreachable" }),
      { status: isTimeout ? 504 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
