// GET/POST /api/internal/process-sponsored-game-jobs
//
// Drains sponsored_game_webhook_jobs (sql/sponsored_games.sql) — the outbox
// a DB trigger fills whenever a skill_game_sessions row's `accepted` flips
// true during an active campaign window. claim_sponsored_game_jobs atomically
// flips a batch to 'processing' (FOR UPDATE SKIP LOCKED); each job is signed
// and sent via sendSponsoredGamePlayedWebhook; complete_sponsored_game_job
// records the outcome with linear backoff on failure — same durability shape
// as hub-page's process-reward-jobs / process-internal-event-jobs, so a
// Platform outage retries instead of silently dropping a week's quest
// completion.
//
// Header: Authorization: Bearer <CRON_SECRET|ADMIN_QUEUE_SECRET>  (same
// convention as the other internal cron hooks in this app, e.g.
// app/api/crackpot/payout/process/route.ts).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSponsoredGamePlayedWebhook } from "@/lib/akiba/sponsoredGameWebhook";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 25;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

type ClaimedJob = {
  id: string;
  idempotency_key: string;
  wallet_address: string;
  game_type: string;
  iso_week: string;
  campaign_id: string;
  quest_id: string;
  quest_verification_rule_id: string;
};

function authorized(req: Request): boolean {
  const secrets = [process.env.ADMIN_QUEUE_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[];
  if (secrets.length === 0) return false;
  const auth = req.headers.get("authorization") ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}`);
}

async function processSponsoredGameJobs() {
  const { data: jobs, error: claimErr } = await supabase.rpc("claim_sponsored_game_jobs", { p_limit: BATCH_SIZE });
  if (claimErr) {
    console.error("[process-sponsored-game-jobs] claim_sponsored_game_jobs failed:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as ClaimedJob[];

  let released = 0;
  let retried = 0;

  for (const job of claimed) {
    const result = await sendSponsoredGamePlayedWebhook(job);

    const { error: completeErr } = await supabase.rpc("complete_sponsored_game_job", {
      p_job_id: job.id,
      p_ok: result.ok,
      p_error: result.ok ? null : (result.error ?? "unknown error"),
    });
    if (completeErr) {
      console.error("[process-sponsored-game-jobs] complete_sponsored_game_job failed for job", job.id, completeErr.message);
      continue;
    }

    if (result.ok) released++;
    else retried++;
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, released, retried });
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processSponsoredGameJobs();
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
