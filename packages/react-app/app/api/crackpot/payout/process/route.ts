// GET/POST /api/crackpot/payout/process
//
// Protected cron/admin hook that drains queued CrackPot payout jobs.
// Header: Authorization: Bearer <CRON_SECRET|ADMIN_QUEUE_SECRET|CRACKPOT_SETTLEMENT_SECRET>

import { NextResponse } from "next/server";
import { drainCrackPotPayoutQueue } from "@/lib/server/crackpotPayoutProcessor";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secrets = [
    process.env.CRACKPOT_SETTLEMENT_SECRET,
    process.env.ADMIN_QUEUE_SECRET,
    process.env.CRON_SECRET,
  ].filter(Boolean) as string[];

  if (secrets.length === 0) return false;
  const auth = req.headers.get("authorization") ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}`);
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "1");
  const limit = Math.max(1, Math.min(5, Number.isFinite(requestedLimit) ? requestedLimit : 1));
  const leaseOwner = url.searchParams.get("leaseOwner") ?? "crackpot-payout-route";

  const result = await drainCrackPotPayoutQueue({ limit, leaseOwner });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}

export const GET = handle;
export const POST = handle;
