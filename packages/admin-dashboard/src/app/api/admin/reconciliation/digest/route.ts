import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Daily queue-count digest for cron jobs (order-lifecycle-completion-spec.md
 * §7: "confirm all four reconciliation queues return zero").
 *
 * Counts the four reconciliation queues (v_orphaned_payments, v_stuck_orders,
 * v_stale_refunds, v_open_disputes — same queries the /reconciliation page
 * renders live) and persists one snapshot row to reconciliation_digests, so
 * "queues went to zero" has recorded evidence over time instead of only a
 * live dashboard number. Delivery (email/Slack forward) is a separate manual
 * wiring step — forward the JSON response however you alert today.
 *
 * Two invocation paths:
 *  - POST, Authorization: Bearer <RECONCILIATION_DIGEST_CRON_SECRET> — for
 *    manual runs or an external scheduler that can set custom headers.
 *  - GET, Authorization: Bearer <CRON_SECRET> — Vercel Cron always issues a
 *    GET request and only supports its own auto-injected CRON_SECRET header
 *    (it can't set an arbitrary Bearer value), so this is the path
 *    vercel.json's schedule actually reaches.
 *
 * Example curl (manual):
 *   curl -X POST https://your-admin.domain/api/admin/reconciliation/digest \
 *     -H "Authorization: Bearer $RECONCILIATION_DIGEST_CRON_SECRET"
 *
 * Vercel cron (vercel.json) — hits GET, authenticated via CRON_SECRET:
 *   { "crons": [{ "path": "/api/admin/reconciliation/digest", "schedule": "0 8 * * *" }] }
 */
async function runDigest() {
  const [orphaned, stuck, refunds, disputes] = await Promise.all([
    supabase.from("v_orphaned_payments").select("id", { count: "exact", head: true }),
    supabase.from("v_stuck_orders").select("id", { count: "exact", head: true }),
    supabase.from("v_stale_refunds").select("id", { count: "exact", head: true }),
    supabase.from("v_open_disputes").select("id", { count: "exact", head: true }),
  ]);

  const firstError = orphaned.error ?? stuck.error ?? refunds.error ?? disputes.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  const orphaned_count = orphaned.count ?? 0;
  const stuck_count = stuck.count ?? 0;
  const refunds_count = refunds.count ?? 0;
  const disputes_count = disputes.count ?? 0;
  const total_count = orphaned_count + stuck_count + refunds_count + disputes_count;

  const { error: insertError } = await supabase.from("reconciliation_digests").insert({
    orphaned_count,
    stuck_count,
    refunds_count,
    disputes_count,
    total_count,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    orphaned_count,
    stuck_count,
    refunds_count,
    disputes_count,
    total_count,
    all_clear: total_count === 0,
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RECONCILIATION_DIGEST_CRON_SECRET ?? "";
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: "Reconciliation digest cron is not configured on this instance" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runDigest();
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runDigest();
}
