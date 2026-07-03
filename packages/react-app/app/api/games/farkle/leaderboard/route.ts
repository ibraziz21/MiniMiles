/**
 * GET /api/games/farkle/leaderboard?modeKey=FARKLE_REWARD_3000_USDT&limit=10&address=0x...
 *
 * Proxy to the Express backend leaderboard endpoint.
 * Only Reward Duel (FARKLE_REWARD_3000_USDT) is supported in v1.
 */
import { NextResponse } from "next/server";
import { farkleBackendHeaders, missingBackendSecret, proxyFarkleBackend } from "../_backend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const modeKey = searchParams.get("modeKey") ?? "";
  const limit = searchParams.get("limit") ?? "10";
  const address = searchParams.get("address")?.toLowerCase() ?? null;

  if (!modeKey) {
    return NextResponse.json({ error: "missing modeKey" }, { status: 400 });
  }

  const headers = farkleBackendHeaders();
  if (!headers) return missingBackendSecret();

  const params = new URLSearchParams({ modeKey, limit });
  if (address) params.set("address", address);

  return proxyFarkleBackend(`/games/farkle/leaderboard?${params.toString()}`, {
    method: "GET",
    headers,
  });
}
