/**
 * PATCH /api/programs/[id] — update state or safe fields of a voucher program.
 * Uses transition_program_state RPC for state changes (validates activation invariants).
 * Merchant owner/manager only. Partner isolation enforced server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // Verify program belongs to this merchant
  const { data: program } = await supabase
    .from("voucher_programs")
    .select("id, state, template_id, name, total_cap, start_at, end_at")
    .eq("id", id)
    .maybeSingle();

  if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

  const { data: template } = await supabase
    .from("spend_voucher_templates")
    .select("partner_id")
    .eq("id", program.template_id)
    .maybeSingle();

  if (!template || template.partner_id !== session.partnerId) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }

  // State transition: use the validated RPC
  if (typeof body.state === "string") {
    const { data, error } = await supabase.rpc("transition_program_state", {
      p_program_id:        id,
      p_new_state:         body.state,
      p_merchant_user_id:  session.merchantUserId,
      p_partner_id:        session.partnerId,
    });

    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("INVALID_TRANSITION"))              return NextResponse.json({ error: `Invalid transition: ${program.state} → ${body.state}` }, { status: 400 });
      if (msg.includes("ACTIVATION_REQUIRES_TOTAL_CAP"))   return NextResponse.json({ error: "Set a positive total cap before activating" }, { status: 409 });
      if (msg.includes("ACTIVATION_REQUIRES_SETTLEMENT_TERMS")) return NextResponse.json({ error: "Configure active settlement terms before activating" }, { status: 409 });
      if (msg.includes("ACTIVATION_REQUIRES_ACTIVE_CHANNEL")) return NextResponse.json({ error: "Add at least one active channel with positive cap before activating" }, { status: 409 });
      if (msg.includes("CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP")) return NextResponse.json({ error: "Channel cap sum exceeds total cap — reduce channel caps or increase total cap" }, { status: 409 });
      if (msg.includes("INVALID_SCHEDULE"))                return NextResponse.json({ error: "Start date must be before end date" }, { status: 400 });
      if (msg.includes("PROGRAM_ALREADY_ENDED"))           return NextResponse.json({ error: "Program has already ended and cannot be modified" }, { status: 409 });
      console.error("[api/programs PATCH state]:", error);
      return NextResponse.json({ error: "State transition failed" }, { status: 500 });
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row?.ok) return NextResponse.json({ error: "State transition failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Draft-only field updates (name, dates, cap, channel patches).
  // Delegated entirely to update_voucher_program RPC which validates state,
  // applies changes atomically, and writes a single audit row.
  const hasFieldUpdate =
    typeof body.name      === "string" ||
    typeof body.start_at  === "string" ||
    typeof body.end_at    === "string" ||
    typeof body.total_cap === "number" ||
    body.channel_patches  != null      ||
    body.clear_end_at     === true     ||
    body.clear_start_at   === true     ||
    body.funding_party_type != null    ||
    body.reimbursement_rate != null;

  if (!hasFieldUpdate) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const settlementFundingType =
    typeof body.funding_party_type === "string" ? body.funding_party_type : null;
  const settlementRate =
    typeof body.reimbursement_rate === "number" ? body.reimbursement_rate : null;
  if (settlementFundingType && !["merchant", "sponsor", "none"].includes(settlementFundingType)) {
    return NextResponse.json({ error: "Invalid funding party" }, { status: 400 });
  }
  if (settlementRate != null && (settlementRate < 0 || settlementRate > 1)) {
    return NextResponse.json({ error: "Reimbursement rate must be between 0 and 1" }, { status: 400 });
  }
  const requestedFundingReference =
    typeof body.funding_party_reference === "string" ? body.funding_party_reference.trim() || null : null;
  if (settlementFundingType === "sponsor" && !requestedFundingReference) {
    return NextResponse.json({ error: "Sponsor reference is required" }, { status: 400 });
  }

  const { data: updData, error: updateErr } = await supabase.rpc("update_voucher_program_with_settlement", {
    p_program_id:       id,
    p_merchant_user_id: session.merchantUserId,
    p_partner_id:       session.partnerId,
    p_name:             typeof body.name      === "string" ? body.name.trim() || null : null,
    p_start_at:         typeof body.start_at  === "string" ? body.start_at  || null  : null,
    p_end_at:           typeof body.end_at    === "string" ? body.end_at    || null  : null,
    p_total_cap:        typeof body.total_cap === "number" ? body.total_cap          : null,
    p_template_id:      null,
    p_channel_patches:  body.channel_patches ?? null,
    p_clear_end_at:     body.clear_end_at  === true,
    p_clear_start_at:   body.clear_start_at === true,
    p_funding_party_type: settlementFundingType,
    p_funding_party_reference:
      settlementFundingType === "merchant" ? session.partnerId : requestedFundingReference,
    p_settlement_currency: typeof body.settlement_currency === "string"
      ? body.settlement_currency.trim() || null
      : null,
    p_reimbursement_rate: settlementRate,
  });

  if (updateErr) {
    const msg = updateErr.message ?? "";
    if (msg.includes("EDIT_ONLY_IN_DRAFT"))                    return NextResponse.json({ error: "Field edits only allowed while program is in draft state" }, { status: 400 });
    if (msg.includes("CAP_BELOW_CONSUMED"))                    return NextResponse.json({ error: "Cannot reduce cap below already-consumed count" }, { status: 409 });
    if (msg.includes("CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP"))     return NextResponse.json({ error: "Channel cap sum exceeds total cap" }, { status: 409 });
    if (msg.includes("chk_vp_total_cap_positive"))             return NextResponse.json({ error: "Total cap must be a positive number" }, { status: 400 });
    if (msg.includes("chk_vp_schedule"))                       return NextResponse.json({ error: "Start date must be before end date" }, { status: 400 });
    if (msg.includes("CANNOT_REMOVE_CHANNEL_WITH_CONSUMPTION"))return NextResponse.json({ error: "Cannot remove a channel that has been used" }, { status: 409 });
    if (msg.includes("TEMPLATE_CHANGE_AFTER_ISSUANCE"))        return NextResponse.json({ error: "Cannot change template after vouchers have been issued" }, { status: 409 });
    console.error("[api/programs PATCH update]:", updateErr);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  const updRow = Array.isArray(updData) ? updData[0] : null;
  if (!updRow?.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
