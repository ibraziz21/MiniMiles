import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [balances, unbatched, batches, incidents] = await Promise.all([
    supabase.from("v_partner_voucher_payable_balances").select("*").order("partner_id"),
    supabase.from("v_unbatched_voucher_payables")
      .select("id,program_id,merchant_id,payable_amount,currency,created_at")
      .order("created_at"),
    supabase.from("v_partner_settlement_batches")
      .select("id,partner_id,currency,state,item_count,total_payable_amount,payment_reference,failure_reason,created_at,paid_at")
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("v_open_voucher_reconciliation_incidents")
      .select("id,type,voucher_id,order_id,data,created_at")
      .order("created_at"),
  ]);

  const error = balances.error ?? unbatched.error ?? batches.error ?? incidents.error;
  if (error) return NextResponse.json({ error: "Failed to load settlements" }, { status: 500 });
  return NextResponse.json({
    balances: balances.data ?? [],
    unbatched: unbatched.data ?? [],
    batches: batches.data ?? [],
    incidents: incidents.data ?? [],
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const actorId = adminIdForWrite(session) ?? "open-access";
  let rpc: string;
  let args: Record<string, unknown>;
  let targetId: string | undefined;

  if (body.action === "create_batch") {
    if (typeof body.partner_id !== "string" || !Array.isArray(body.entry_ids) || body.entry_ids.length === 0) {
      return NextResponse.json({ error: "Partner and payable entries are required" }, { status: 400 });
    }
    rpc = "create_partner_settlement_batch";
    args = {
      p_partner_id: body.partner_id,
      p_currency: typeof body.currency === "string" ? body.currency : "cUSD",
      p_entry_ids: body.entry_ids,
      p_idempotency_key: typeof body.idempotency_key === "string"
        ? body.idempotency_key
        : `admin:${actorId}:${crypto.randomUUID()}`,
      p_actor_id: actorId,
    };
    targetId = body.partner_id;
  } else if (body.action === "transition") {
    if (typeof body.batch_id !== "string" || typeof body.state !== "string") {
      return NextResponse.json({ error: "Batch and state are required" }, { status: 400 });
    }
    rpc = "transition_partner_settlement_batch";
    args = {
      p_batch_id: body.batch_id,
      p_new_state: body.state,
      p_actor_id: actorId,
      p_payment_reference: typeof body.payment_reference === "string" ? body.payment_reference : null,
      p_payment_evidence: body.payment_evidence ?? null,
    };
    targetId = body.batch_id;
  } else if (body.action === "failure") {
    if (typeof body.batch_id !== "string" || typeof body.reason !== "string") {
      return NextResponse.json({ error: "Batch and failure reason are required" }, { status: 400 });
    }
    rpc = "record_settlement_failure";
    args = { p_batch_id: body.batch_id, p_reason: body.reason, p_actor_id: actorId };
    targetId = body.batch_id;
  } else if (body.action === "resolve_incident") {
    if (typeof body.incident_id !== "string" || typeof body.notes !== "string") {
      return NextResponse.json({ error: "Incident and resolution notes are required" }, { status: 400 });
    }
    rpc = "resolve_reconciliation_incident";
    args = {
      p_incident_id: body.incident_id,
      p_resolution: { notes: body.notes },
      p_actor_id: actorId,
    };
    targetId = body.incident_id;
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    console.error("[admin/settlements]", error);
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `settlement.${body.action}`,
    targetType: body.action === "resolve_incident" ? "reconciliation_incident" : "settlement_batch",
    targetId,
    metadata: { action: body.action, state: body.state ?? null },
  });
  return NextResponse.json({ ok: true, data });
}
