/**
 * GET /api/games/farkle/active?address=0x...
 *
 * Thin proxy to the Express backend. Farkle active-session recovery and stale
 * match reconciliation live in packages/backend.
 */
import { NextResponse } from "next/server";
import {
  farkleBackendHeaders,
  missingBackendSecret,
  proxyFarkleBackend,
} from "../_backend";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  const headers = farkleBackendHeaders();
  if (!headers) return missingBackendSecret();

  return proxyFarkleBackend(
    `/games/farkle/active?address=${encodeURIComponent(address)}`,
    { method: "GET", headers },
  );
}
