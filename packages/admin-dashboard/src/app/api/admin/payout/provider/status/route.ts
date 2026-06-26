import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [providers, queue, instructions, incidents] = await Promise.all([
    supabase
      .from("payout_provider_config")
      .select("provider_name, is_enabled, is_paused, pause_reason, per_payout_limit, daily_limit, dual_approval_threshold, supported_currencies")
      .order("provider_name"),
    supabase
      .from("v_pending_payout_queue")
      .select("batch_id, partner_id, currency, item_count, total_payable_amount, approved_at")
      .order("approved_at"),
    supabase
      .from("v_payout_instruction_summary")
      .select("instruction_id, batch_id, instruction_state, batch_state, provider_name, amount, currency, provider_reference, destination_display_name, polling_deadline, failure_code, failure_reason, created_at")
      .in("instruction_state", ["pending", "submitted", "uncertain", "failed"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("v_open_voucher_reconciliation_incidents")
      .select("id, type, data, created_at")
      .like("type", "payout%")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const error = providers.error ?? queue.error ?? instructions.error ?? incidents.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      providers: providers.data ?? [],
      queue: queue.data ?? [],
      instructions: instructions.data ?? [],
      incidents: incidents.data ?? [],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
