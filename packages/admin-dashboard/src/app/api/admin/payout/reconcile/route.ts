import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getPayoutProvider } from "@/lib/payout/index";

const BATCH_SIZE = 50;

interface UncertainRow {
  instruction_id: string;
  provider_name: string;
  amount: number;
  currency: string;
  provider_reference: string | null;
  state: string;
}

/**
 * Automated reconciliation endpoint for cron jobs.
 * Auth: Authorization: Bearer <RECONCILIATION_CRON_SECRET>
 *
 * Manual payouts are explicitly skipped — only humans can confirm them
 * via the manual-confirm endpoint. Reconcile only queries providers that
 * support automated status checks.
 *
 * Example curl:
 *   curl -X POST https://your-admin.domain/api/admin/payout/reconcile \
 *     -H "Authorization: Bearer $RECONCILIATION_CRON_SECRET"
 *
 * Vercel cron (vercel.json):
 *   { "crons": [{ "path": "/api/admin/payout/reconcile", "schedule": "0 * * * *" }] }
 * Combined with CRON_SECRET verification on the Vercel platform.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.RECONCILIATION_CRON_SECRET ?? "";
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: "Reconciliation cron is not configured on this instance" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("v_uncertain_payouts")
    .select("instruction_id, provider_name, amount, currency, provider_reference, state")
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as UncertainRow[];
  let checked = 0;
  let confirmed = 0;
  let failed = 0;
  let uncertain = 0;
  let skipped_manual = 0;

  for (const row of rows) {
    // Manual payouts require human confirmation — skip entirely.
    if (row.provider_name === "manual") {
      skipped_manual += 1;
      continue;
    }
    if (!row.provider_reference) {
      uncertain += 1;
      continue;
    }

    checked += 1;

    let provider;
    try {
      provider = getPayoutProvider(row.provider_name);
    } catch {
      uncertain += 1;
      continue;
    }
    if (!provider.isConfigured) {
      uncertain += 1;
      continue;
    }

    try {
      const status = await provider.queryPayoutStatus(row.provider_reference);

      if (status.status === "confirmed") {
        const { error: cErr } = await supabase.rpc("record_payout_confirmation", {
          p_instruction_id: row.instruction_id,
          p_actor: "cron:reconcile",
          p_provider_reference: row.provider_reference,
          p_confirmed_amount: status.confirmedAmount ?? row.amount,
          p_confirmed_currency: status.confirmedCurrency ?? row.currency,
        });
        if (cErr) {
          uncertain += 1;
        } else {
          confirmed += 1;
        }
      } else if (status.status === "failed") {
        await supabase.rpc("record_payout_failure", {
          p_instruction_id: row.instruction_id,
          p_actor: "cron:reconcile",
          p_failure_code: status.failureCode ?? "RECONCILE_FAILED",
          p_failure_reason: status.failureReason ?? "Provider reported failed during reconcile",
        });
        failed += 1;
      } else {
        if (row.state === "submitted") {
          await supabase.rpc("mark_payout_uncertain", {
            p_instruction_id: row.instruction_id,
            p_actor: "cron:reconcile",
            p_reason: "reconcile_still_pending",
          });
        }
        uncertain += 1;
      }
    } catch {
      uncertain += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    batch_size: BATCH_SIZE,
    total_rows: rows.length,
    checked,
    confirmed,
    failed,
    uncertain,
    skipped_manual,
  });
}
