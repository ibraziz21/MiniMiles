/**
 * GET/DELETE /api/games/farkle/matches/queue
 *
 * Thin proxy to the Express backend. Queue expiry, TTL refresh, stale matched
 * row cleanup, and active-match recovery live in packages/backend.
 */
import { NextResponse } from "next/server";
import {
  farkleBackendHeaders,
  missingBackendSecret,
  proxyFarkleBackend,
} from "../../_backend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const modeKey = searchParams.get("modeKey");
  const address = searchParams.get("address")?.toLowerCase();

  if (!modeKey) return NextResponse.json({ error: "missing modeKey" }, { status: 400 });

  const headers = farkleBackendHeaders();
  if (!headers) return missingBackendSecret();

  const query = new URLSearchParams({ modeKey });
  if (address) query.set("address", address);

  return proxyFarkleBackend(
    `/games/farkle/matches/queue?${query.toString()}`,
    { method: "GET", headers },
  );
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const modeKey = body?.modeKey ?? url.searchParams.get("modeKey");
  const address = (body?.address ?? url.searchParams.get("address"))?.toLowerCase();

  if (!modeKey || !address) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const headers = farkleBackendHeaders(true);
  if (!headers) return missingBackendSecret();

  return proxyFarkleBackend("/games/farkle/matches/queue", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ modeKey, address }),
  });
}
