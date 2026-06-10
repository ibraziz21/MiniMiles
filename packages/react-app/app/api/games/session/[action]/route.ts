/**
 * POST /api/games/session/:action  (action ∈ init | flip | finish)
 *
 * Proxy for the server-authoritative Memory Flip flow. The deck lives only on
 * the backend; the client flips one card at a time and the server reveals just
 * that card's value. No game secret ever transits through here unflipped.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError } from "../../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";
const ALLOWED = new Set(["init", "flip", "finish"]);

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
