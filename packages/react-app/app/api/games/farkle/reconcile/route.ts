// GET/POST /api/games/farkle/reconcile
//
// Cron-compatible proxy to packages/backend. Settlement/reconcile execution
// belongs to Railway so Vercel does not own resolver nonce space or long
// receipt waits.
import { NextResponse } from "next/server";
import { proxyFarkleBackend } from "../_backend";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.ADMIN_QUEUE_SECRET, process.env.FARKLE_SETTLEMENT_SECRET]
    .filter(Boolean) as string[];
  if (secrets.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return secrets.some((secret) => header === `Bearer ${secret}`);
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.toString();
  const authorization = req.headers.get("authorization") ?? "";
  return proxyFarkleBackend(
    `/games/farkle/reconcile${query ? `?${query}` : ""}`,
    { method: req.method, headers: { authorization } },
    55_000,
  );
}

export const GET = handle;
export const POST = handle;
