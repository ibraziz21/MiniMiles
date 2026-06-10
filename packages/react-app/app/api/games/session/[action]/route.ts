/**
 * POST /api/games/session/:action  (action ∈ init | flip | tick | tap | finish)
 *
 * Proxy for the server-authoritative skill-game flows. Memory Flip uses
 * init/flip/finish; Rule Tap uses init/tick/tap/finish. No game secret (deck or
 * full timeline) ever transits through here — only the just-revealed value.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError } from "../../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";
const ALLOWED = new Set(["init", "flip", "tick", "tap", "finish"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: "unknown-action" }, { status: 404 });
  }
  try {
    const body = await req.text();
    const { data, status } = await fetchUpstreamJson(`${BACKEND}/games/session/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: "proxy-timeout" }, { status: 504 });
    }
    console.error(`[proxy/games/session/${action}]`, err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
