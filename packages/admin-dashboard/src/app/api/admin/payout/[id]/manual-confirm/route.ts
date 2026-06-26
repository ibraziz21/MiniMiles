import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const ELEVATED_ROLES = new Set(["super_admin", "finance_admin"]);

const ALLOWED_PAYMENT_METHODS = new Set([
  "bank_transfer",
  "mobile_money",
  "crypto",
  "cash",
  "cheque",
  "other",
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ELEVATED_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Forbidden: elevated role required" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.provider_reference !== "string" ||
    body.provider_reference.trim() === "" ||
    typeof body.confirmed_amount !== "number" ||
    typeof body.confirmed_currency !== "string" ||
    typeof body.payment_method !== "string" ||
    typeof body.payment_date !== "string" ||
    typeof body.evidence_note !== "string" ||
    body.evidence_note.trim() === ""
  ) {
    return NextResponse.json(
      {
        error:
          "Required fields: provider_reference (string), confirmed_amount (number), " +
          "confirmed_currency (string), payment_method (string), payment_date (YYYY-MM-DD), " +
          "evidence_note (string)",
      },
      { status: 400 },
    );
  }

  if (!ALLOWED_PAYMENT_METHODS.has(body.payment_method as string)) {
    return NextResponse.json(
      {
        error: `payment_method must be one of: ${[...ALLOWED_PAYMENT_METHODS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Validate payment_date is a valid ISO date (YYYY-MM-DD).
  const paymentDate = new Date(body.payment_date as string);
  if (isNaN(paymentDate.getTime())) {
    return NextResponse.json(
      { error: "payment_date must be a valid ISO date (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const actorId = adminIdForWrite(session) ?? "open-access";
  const instructionId = params.id;

  // Dual-approver check: confirming admin must differ from the instruction initiator
  // and secondary approver when dual approval was required.
  const { data: instRow, error: instErr } = await supabase
    .from("settlement_payout_instructions")
    .select("initiated_by, secondary_approver, state")
    .eq("id", instructionId)
    .single();

  if (instErr || !instRow) {
    return NextResponse.json({ error: "INSTRUCTION_NOT_FOUND" }, { status: 404 });
  }

  if (instRow.state === "confirmed") {
    return NextResponse.json({ ok: true, instruction_id: instructionId, already_confirmed: true });
  }

  if (instRow.state !== "submitted" && instRow.state !== "uncertain") {
    return NextResponse.json(
      { error: `Cannot confirm instruction in state: ${instRow.state}` },
      { status: 409 },
    );
  }

  // When dual approval was used, the confirming admin cannot be either of the approvers.
  if (instRow.secondary_approver != null) {
    if (actorId === instRow.initiated_by) {
      return NextResponse.json(
        { error: "Confirming admin must differ from the instruction initiator (dual approval)" },
        { status: 403 },
      );
    }
    if (actorId === instRow.secondary_approver) {
      return NextResponse.json(
        { error: "Confirming admin must differ from the secondary approver (dual approval)" },
        { status: 403 },
      );
    }
  }

  const { data, error } = await supabase.rpc("record_payout_confirmation", {
    p_instruction_id: instructionId,
    p_actor: actorId,
    p_provider_reference: body.provider_reference,
    p_confirmed_amount: body.confirmed_amount,
    p_confirmed_currency: body.confirmed_currency,
    p_payment_method: body.payment_method,
    p_payment_date: body.payment_date,
    p_evidence_note: body.evidence_note,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return NextResponse.json({ error: "CONFIRM_FAILED" }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "payout.manual_confirmed",
    targetType: "payout_instruction",
    targetId: instructionId,
    metadata: {
      provider_reference: body.provider_reference,
      confirmed_amount: body.confirmed_amount,
      confirmed_currency: body.confirmed_currency,
      payment_method: body.payment_method,
      payment_date: body.payment_date,
      receipt_number: row.receipt_number ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    instruction_id: instructionId,
    receipt_number: row.receipt_number ?? null,
  });
}
