/**
 * POST /api/programs — create a new voucher program atomically.
 * Uses create_voucher_program RPC — either all succeed or all roll back.
 * Merchant owner/manager only. Partner isolation enforced server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const name        = typeof body.name        === "string"  ? body.name.trim()        : null;
  const templateId  = typeof body.template_id === "string"  ? body.template_id        : null;
  const totalCap    = typeof body.total_cap   === "number"  ? body.total_cap          : null;
  const startAt     = typeof body.start_at    === "string"  ? body.start_at || null   : null;
  const endAt       = typeof body.end_at      === "string"  ? body.end_at   || null   : null;
  const channels    = Array.isArray(body.channels)          ? body.channels           : [];
  const fundingPartyType = typeof body.funding_party_type === "string" ? body.funding_party_type : null;
  const fundingPartyReference = typeof body.funding_party_reference === "string"
    ? body.funding_party_reference.trim() || null
    : null;
  const settlementCurrency = typeof body.settlement_currency === "string"
    ? body.settlement_currency.trim()
    : "cUSD";
  const reimbursementRate = typeof body.reimbursement_rate === "number"
    ? body.reimbursement_rate
    : null;

  if (!name || !templateId || !fundingPartyType || reimbursementRate == null) {
    return NextResponse.json({ error: "Missing program or settlement terms" }, { status: 400 });
  }
  if (!["merchant", "sponsor", "none"].includes(fundingPartyType)) {
    return NextResponse.json({ error: "Invalid funding party" }, { status: 400 });
  }
  if (reimbursementRate < 0 || reimbursementRate > 1) {
    return NextResponse.json({ error: "Reimbursement rate must be between 0 and 1" }, { status: 400 });
  }
  if (fundingPartyType === "none" && reimbursementRate !== 0) {
    return NextResponse.json({ error: "No-reimbursement programs must use a zero rate" }, { status: 400 });
  }
  if (fundingPartyType === "sponsor" && !fundingPartyReference) {
    return NextResponse.json({ error: "Sponsor reference is required" }, { status: 400 });
  }

  // Verify template belongs to this merchant (merchant isolation)
  const { data: template } = await supabase
    .from("spend_voucher_templates")
    .select("id, partner_id")
    .eq("id", templateId)
    .eq("partner_id", session.partnerId)
    .maybeSingle();

  if (!template) {
    return NextResponse.json({ error: "Template not found or not yours" }, { status: 404 });
  }

  // Merchants cannot select akiba funding
  const fundingType = typeof body.funding_type === "string" ? body.funding_type : "free";
  if (fundingType === "akiba") {
    return NextResponse.json({ error: "Merchants cannot select Akiba funding" }, { status: 400 });
  }

  const validChannels = new Set(["miles_purchase", "claw", "raffle", "giveaway", "merchant_grant"]);
  const channelPayload = (channels as Array<{ channel: string; cap?: number | null; active?: boolean }>)
    .filter((ch) => validChannels.has(ch.channel))
    .map((ch) => ({ channel: ch.channel, cap: ch.cap ?? null, active: ch.active ?? true }));

  // Atomic creation via RPC — program + allocations + audit in one transaction
  const { data, error } = await supabase.rpc("create_voucher_program_with_settlement", {
    p_name:         name,
    p_template_id:  templateId,
    p_funding_type: fundingType,
    p_sponsor:      null,
    p_total_cap:    totalCap,
    p_start_at:     startAt,
    p_end_at:       endAt,
    p_channels:          channelPayload,
    p_merchant_user_id:  session.merchantUserId,
    p_partner_id:        session.partnerId,
    p_funding_party_type: fundingPartyType,
    p_funding_party_reference:
      fundingPartyType === "merchant" ? session.partnerId : fundingPartyReference,
    p_settlement_currency: settlementCurrency,
    p_reimbursement_rate: reimbursementRate,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("TEMPLATE_NOT_FOUND"))                  return NextResponse.json({ error: "Template not found" }, { status: 404 });
    if (msg.includes("INVALID_TOTAL_CAP"))                   return NextResponse.json({ error: "Total cap must be a positive integer" }, { status: 400 });
    if (msg.includes("INVALID_SCHEDULE"))                    return NextResponse.json({ error: "Start date must be before end date" }, { status: 400 });
    if (msg.includes("ACTIVE_CHANNEL_MUST_HAVE_POSITIVE_CAP")) return NextResponse.json({ error: "Active channels must have a positive cap" }, { status: 400 });
    if (msg.includes("CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP"))  return NextResponse.json({ error: "Channel cap sum exceeds total cap" }, { status: 400 });
    if (msg.includes("INVALID_CHANNEL"))                     return NextResponse.json({ error: `Invalid channel: ${msg}` }, { status: 400 });
    console.error("[api/programs POST]:", error);
    return NextResponse.json({ error: "Failed to create program" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.ok) return NextResponse.json({ error: "Failed to create program" }, { status: 500 });

  return NextResponse.json({ program_id: row.program_id }, { status: 201 });
}
