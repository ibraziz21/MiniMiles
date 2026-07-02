/**
 * POST /api/games/farkle/matches/find
 *
 * Thin proxy to the Express backend. The browser never controls wallet identity:
 * the BFF reads the session wallet and sends that to packages/backend.
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  farkleBackendHeaders,
  missingBackendSecret,
  proxyFarkleBackend,
} from "../../_backend";

const VALID_MODES = new Set(["FARKLE_QUICK_1500_AKIBA", "FARKLE_REWARD_3000_USDT"]);

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const modeKey = body?.modeKey;
  const targetAddress = typeof body?.targetAddress === "string"
    ? body.targetAddress.toLowerCase()
    : null;

  if (!modeKey) return NextResponse.json({ error: "missing modeKey" }, { status: 400 });
  if (!VALID_MODES.has(modeKey)) return NextResponse.json({ error: "invalid modeKey" }, { status: 400 });

  const headers = farkleBackendHeaders(true);
  if (!headers) return missingBackendSecret();

  return proxyFarkleBackend("/games/farkle/matches/find", {
    method: "POST",
    headers,
    body: JSON.stringify({
      address: session.walletAddress.toLowerCase(),
      modeKey,
      ...(targetAddress ? { targetAddress } : {}),
    }),
  });
}
