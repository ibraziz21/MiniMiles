/**
 * GET /api/games/start-intent-status?txHash=0x...&walletAddress=0x...&gameType=rule_tap&seedCommitment=0x...
 *
 * Recovers the real on-chain session id when /games/start-intent submitted a tx
 * but timed out before the receipt arrived.
 */

import { NextRequest, NextResponse } from "next/server";
import { GAMES_STATUS_PROXY_TIMEOUT_MS, fetchUpstreamJson, isAbortError } from "../_proxy";

const BACKEND = process.env.GAMES_BACKEND_URL ?? "https://backend-production-aa7f.up.railway.app";

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const { data, status } = await fetchUpstreamJson(
      `${BACKEND}/games/start-intent-status?${qs}`,
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
    console.error("[proxy/games/start-intent-status]", err?.message ?? err);
    return NextResponse.json({ error: "backend-unavailable" }, { status: 502 });
  }
}
