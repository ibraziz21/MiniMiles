// GET/POST /api/crackpot/payout/process
//
// Protected cron/admin hook that drains queued CrackPot payout jobs.
// Header: Authorization: Bearer <CRON_SECRET|ADMIN_QUEUE_SECRET|CRACKPOT_SETTLEMENT_SECRET>

import { NextResponse } from "next/server";
import {
  leaseNextPayoutJob,
  processPayoutJob,
} from "@/lib/server/crackpotPayoutWorker";
import { rotateActiveCycle } from "@/lib/server/crackpotCycleSync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type PlayVersion = "miles" | "usdt";

function jobVersion(job: { contract_version: number }): PlayVersion {
  return job.contract_version === 1 ? "usdt" : "miles";
}

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

  const processed: Array<{ id: string; status: "succeeded" | "failed" | "manual_review" }> = [];
  const rotations: Array<{
    version: PlayVersion;
    ok: boolean;
    cycleId?: string;
    contractCycleId?: number | null;
    status?: string;
    error?: string;
  }> = [];

  for (let i = 0; i < limit; i++) {
    const job = await leaseNextPayoutJob(leaseOwner);
    if (!job) break;

    const result = await processPayoutJob(job);
    processed.push({ id: job.id, status: result.status });

    if (result.status !== "succeeded") continue;

    const version = jobVersion(job);
    try {
      const cycle = await rotateActiveCycle(version, job.chain_id);
      rotations.push({
        version,
        ok: true,
        cycleId: cycle.id,
        contractCycleId: cycle.contract_cycle_id,
        status: cycle.status,
      });
    } catch (err: any) {
      console.error(`[crackpot/payout/process] ${version} rotation after payout failed`, err);
      rotations.push({
        version,
        ok: false,
        error: err?.message ?? "cycle_rotation_failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    processedCount: processed.length,
    rotations,
  });
}

export const GET = handle;
export const POST = handle;
