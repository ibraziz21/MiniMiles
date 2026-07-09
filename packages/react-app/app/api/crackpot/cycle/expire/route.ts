// GET/POST /api/crackpot/cycle/expire
//
// Protected cron/admin hook that rotates CrackPot cycles.
// Header: Authorization: Bearer <CRACKPOT_CYCLE_SECRET|CRON_SECRET|ADMIN_QUEUE_SECRET>
//
// Query:
//   version=all   (default) rotate Miles then USDT
//   version=miles rotate Miles only
//   version=usdt  rotate USDT only

import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { rotateActiveCycle } from "@/lib/server/crackpotCycleSync";
import { secondsUntil } from "@/lib/server/crackpotEngine";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

// Rotation worst case is two on-chain txs (expire + open) with receipt waits
// per version; both versions rotate together at 12:00 EAT.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type PlayVersion = Extract<CrackPotVersion, "miles" | "usdt">;

const PLAY_VERSIONS: PlayVersion[] = ["miles", "usdt"];

function authorized(req: Request): boolean {
  const secrets = [
    process.env.CRACKPOT_CYCLE_SECRET,
    process.env.CRACKPOT_SETTLEMENT_SECRET,
    process.env.ADMIN_QUEUE_SECRET,
    process.env.CRON_SECRET,
  ].filter(Boolean) as string[];

  if (secrets.length === 0) return false;
  const auth = req.headers.get("authorization") ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}`);
}

function requestedVersions(req: Request): PlayVersion[] {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("version") ?? "all").toLowerCase();
  if (raw === "miles") return ["miles"];
  if (raw === "usdt") return ["usdt"];
  return PLAY_VERSIONS;
}

async function handle(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    version: PlayVersion;
    ok: boolean;
    cycleId?: string;
    contractCycleId?: number | null;
    status?: string;
    expiresAt?: string;
    secondsRemaining?: number;
    error?: string;
  }> = [];

  for (const version of requestedVersions(req)) {
    try {
      const cycle = await rotateActiveCycle(version);
      results.push({
        version,
        ok: true,
        cycleId: cycle.id,
        contractCycleId: cycle.contract_cycle_id,
        status: cycle.status,
        expiresAt: cycle.expires_at,
        secondsRemaining: secondsUntil(cycle.expires_at),
      });
    } catch (err: any) {
      console.error(`[crackpot/cycle/expire] ${version}`, err);
      results.push({
        version,
        ok: false,
        error: err?.message ?? "cycle_rotation_failed",
      });
    }
  }

  const ok = results.every((result) => result.ok);
  return NextResponse.json(
    {
      ok,
      rotatedAt: new Date().toISOString(),
      results,
    },
    { status: ok ? 200 : 500 },
  );
}

export const GET = handle;
export const POST = handle;
