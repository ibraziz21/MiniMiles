/**
 * GET /api/games/farkle/health
 *
 * Operational health snapshot: queue depth, active/stale match counts, unsettled
 * completions, and backend resolver status. No sensitive data is exposed.
 *
 * Protected by CRON_SECRET so it is safe to call from monitoring infra without
 * leaking stack-internal state to unauthenticated callers.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const FARKLE_BACKEND =
  process.env.FARKLE_SETTLEMENT_BACKEND_URL ??
  process.env.GAMES_BACKEND_URL ??
  "https://backend-production-aa7f.up.railway.app";

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const STALE_MINUTES = 5;
const PENDING_SETTLEMENT_WARNING_MINUTES = 10;

function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_MINUTES * 60 * 1000).toISOString();
  const pendingWarningThreshold = new Date(
    now.getTime() - PENDING_SETTLEMENT_WARNING_MINUTES * 60 * 1000,
  ).toISOString();

  const [
    quickQueue,
    rewardQueue,
    activeMatches,
    staleMatches,
    pendingSettlement,
    overdueSettlement,
    backendHealth,
  ] = await Promise.allSettled([
    // Queue depths per mode (non-expired waiting entries)
    supabase
      .from("matchmaking_queue")
      .select("*", { count: "exact", head: true })
      .eq("mode_key", "FARKLE_QUICK_1500_AKIBA")
      .eq("status", "waiting")
      .gt("expires_at", now.toISOString()),

    supabase
      .from("matchmaking_queue")
      .select("*", { count: "exact", head: true })
      .eq("mode_key", "FARKLE_REWARD_3000_USDT")
      .eq("status", "waiting")
      .gt("expires_at", now.toISOString()),

    // Active match counts
    supabase
      .from("game_matches")
      .select("status", { count: "exact" })
      .in("status", ["created", "funded", "in_progress"]),

    // Stale active matches (inactive > STALE_MINUTES)
    supabase
      .from("game_matches")
      .select("*", { count: "exact", head: true })
      .in("status", ["created", "funded", "in_progress"])
      .lt("last_action_at", staleThreshold),

    // All unsettled completed matches + oldest one for time-since
    supabase
      .from("game_matches")
      .select("id, completed_at", { count: "exact" })
      .eq("status", "completed")
      .is("settled_at", null)
      .order("completed_at", { ascending: true })
      .limit(1),

    // Overdue settlement: completed > PENDING_SETTLEMENT_WARNING_MINUTES ago, still unsettled
    supabase
      .from("game_matches")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed")
      .is("settled_at", null)
      .lt("completed_at", pendingWarningThreshold),

    // Backend resolver status (3 s timeout)
    Promise.race([
      fetch(`${FARKLE_BACKEND.replace(/\/$/, "")}/games/farkle/health`)
        .then((r) => r.json())
        .catch((e: any) => ({ ok: false, error: e?.message ?? "fetch failed" })),
      new Promise<{ ok: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: "timeout" }), 3000),
      ),
    ]),
  ]);

  // Helper to extract count from settled result
  function count(settled: PromiseSettledResult<any>): number | null {
    if (settled.status === "rejected") return null;
    return settled.value.count ?? null;
  }
  function data(settled: PromiseSettledResult<any>): any {
    if (settled.status === "rejected") return null;
    return settled.value.data;
  }

  // Tally active matches by status
  const activeRows: Array<{ status: string }> = data(activeMatches) ?? [];
  const byCounts = activeRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  // Oldest pending settlement
  const pendingRows: Array<{ id: string; completed_at: string }> = data(pendingSettlement) ?? [];
  const oldestPendingAt = pendingRows[0]?.completed_at ?? null;

  const pendingCount = count(pendingSettlement) ?? 0;
  const overdueCount = count(overdueSettlement) ?? 0;

  const backendResult =
    backendHealth.status === "fulfilled" ? backendHealth.value : { ok: false, error: "unreachable" };

  console.log(
    `[farkle/health] checked: quickQueue=${count(quickQueue)} rewardQueue=${count(rewardQueue)}` +
      ` activeMatches=${activeRows.length} staleMatches=${count(staleMatches)}` +
      ` pendingSettlement=${pendingCount} overdueSettlement=${overdueCount}` +
      ` backendOk=${backendResult?.ok ?? false}`,
  );

  return NextResponse.json({
    checkedAt: now.toISOString(),
    queue: {
      FARKLE_QUICK_1500_AKIBA: { waiting: count(quickQueue) ?? 0 },
      FARKLE_REWARD_3000_USDT: { waiting: count(rewardQueue) ?? 0 },
    },
    matches: {
      in_progress: byCounts["in_progress"] ?? 0,
      created:     byCounts["created"]     ?? 0,
      funded:      byCounts["funded"]      ?? 0,
      total:       activeRows.length,
    },
    staleMatches: count(staleMatches) ?? 0,
    settlement: {
      pendingCount,
      overdueCount,
      oldestPendingAt,
    },
    backend: backendResult,
  });
}
