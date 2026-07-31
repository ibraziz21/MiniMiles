// GET /api/internal/quests-health — merchant-shopping-quests-spec.md §8
// Slice 4 "Add outbox and reward failure observability".
//
// Buckets internal_event_jobs by status for the 5 Hub launch quest event
// types, flags jobs stuck in 'processing' (worker died mid-run) or exhausting
// retries, and reports the current rollout gate config. Same auth convention
// as the outbox worker (x-webhook-secret / INTERNAL_WEBHOOK_SECRET) — this is
// an internal/ops endpoint, not user-facing.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHubQuestRolloutSummary } from "@/lib/akiba/hubQuestRollout";

const HUB_QUEST_EVENT_TYPES = [
  "pass_activated",
  "deal_viewed",
  "sponsored_game_played",
  "profile_country_set",
  "voucher_redeemed",
] as const;

const STUCK_PROCESSING_MINUTES = 10;

function isAuthorized(request: Request): boolean {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET ?? "";
  return !!secret && request.headers.get("x-webhook-secret") === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedHours = Number(new URL(request.url).searchParams.get("hours") ?? "24");
  const hours = Number.isInteger(requestedHours) && requestedHours >= 1 && requestedHours <= 168
    ? requestedHours
    : 24;
  const since = new Date(Date.now() - hours * 60 * 60_000).toISOString();

  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .from("internal_event_jobs")
    .select("event_type, status, attempts, last_error, created_at, updated_at")
    .in("event_type", HUB_QUEST_EVENT_TYPES)
    .gte("created_at", since)
    .limit(5000);

  if (error) {
    console.error("[internal/quests-health] query failed:", error.message);
    return NextResponse.json({ error: "Quest health data is unavailable" }, { status: 503 });
  }

  const rows = jobs ?? [];
  const stuckCutoff = Date.now() - STUCK_PROCESSING_MINUTES * 60_000;

  const byQuest: Record<string, { pending: number; processing: number; released: number; failed: number }> = {};
  for (const key of HUB_QUEST_EVENT_TYPES) {
    byQuest[key] = { pending: 0, processing: 0, released: 0, failed: 0 };
  }

  const stuckProcessing: Array<{ event_type: string; updated_at: string }> = [];
  const recentFailures: Array<{ event_type: string; attempts: number; last_error: string | null; updated_at: string }> = [];

  for (const row of rows as Array<{
    event_type: string; status: string; attempts: number; last_error: string | null;
    created_at: string; updated_at: string;
  }>) {
    const bucket = byQuest[row.event_type];
    if (!bucket) continue;

    if (row.status === "pending") bucket.pending++;
    else if (row.status === "processing") bucket.processing++;
    else if (row.status === "released") bucket.released++;
    else if (row.status === "failed") bucket.failed++;

    if (row.status === "processing" && new Date(row.updated_at).getTime() < stuckCutoff) {
      stuckProcessing.push({ event_type: row.event_type, updated_at: row.updated_at });
    }
    if (row.status === "failed" || (row.status === "pending" && row.attempts > 0)) {
      recentFailures.push({
        event_type: row.event_type,
        attempts: row.attempts,
        last_error: row.last_error,
        updated_at: row.updated_at,
      });
    }
  }

  const warnings: string[] = [];
  if (stuckProcessing.length > 0) {
    warnings.push(`${stuckProcessing.length} job(s) stuck in 'processing' for over ${STUCK_PROCESSING_MINUTES} minutes`);
  }
  if (recentFailures.length > 0) {
    warnings.push(`${recentFailures.length} job(s) with retry attempts or failures in the last ${hours}h`);
  }

  return NextResponse.json(
    {
      window: { hours, since },
      byQuest,
      stuckProcessing,
      recentFailures: recentFailures.slice(0, 50),
      warnings,
      rollout: getHubQuestRolloutSummary(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
