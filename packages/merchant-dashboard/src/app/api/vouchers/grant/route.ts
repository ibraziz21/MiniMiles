/**
 * POST /api/vouchers/grant (merchant-dashboard)
 *
 * Merchant grants only. Identity is derived from iron-session — no actor_id
 * or merchant_user_id may be supplied in the request body.
 *
 * Stable idempotency key: hash of (program_id + recipient).
 * A single merchant_grant channel may be called multiple times for the same
 * recipient without creating duplicates (source_ref uniqueness enforced by DB).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

function stableGrantKey(programId: string, recipient: string): string {
  const normalizedRecipient = recipient.trim().toLowerCase();
  const digest = createHash("sha256")
    .update(`mgrant:${programId}:${normalizedRecipient}`)
    .digest("hex");
  return `mgrant:${digest}`;
}

export async function POST(req: NextRequest) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const programId          = typeof body.program_id            === "string" ? body.program_id.trim()         : null;
  const recipientHubUserId = typeof body.recipient_hub_user_id === "string" ? body.recipient_hub_user_id     : null;
  const recipientAddress   = typeof body.recipient_address     === "string" ? body.recipient_address.trim()  : null;

  if (!programId) return NextResponse.json({ error: "Missing program_id" }, { status: 400 });
  if (!recipientHubUserId && !recipientAddress) {
    return NextResponse.json({ error: "Provide recipient_hub_user_id or recipient_address" }, { status: 400 });
  }

  // Verify program belongs to this merchant's partner (isolation)
  const { data: program } = await supabase
    .from("voucher_programs")
    .select("id, template_id, state")
    .eq("id", programId)
    .maybeSingle();

  if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

  const { data: template } = await supabase
    .from("spend_voucher_templates")
    .select("partner_id")
    .eq("id", program.template_id)
    .maybeSingle();

  if (!template || template.partner_id !== session.partnerId) {
    return NextResponse.json({ error: "Program does not belong to your organization" }, { status: 403 });
  }

  const recipient = recipientHubUserId ?? recipientAddress ?? "";
  const sourceRef = stableGrantKey(programId, recipient);

  // Atomic grant + production-schema audit row in one transaction.
  const { data, error } = await supabase.rpc("merchant_grant_atomic", {
    p_program_id:        programId,
    p_merchant_user_id:  session.merchantUserId,
    p_partner_id:        session.partnerId,
    p_recipient_address: recipientAddress ?? null,
    p_hub_user_id:       recipientHubUserId ?? null,
    p_code:              generateSecureCode(),
    p_source_ref:        sourceRef,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("PROGRAM_NOT_ACTIVE"))  return NextResponse.json({ error: "Program is not active" }, { status: 409 });
    if (msg.includes("PROGRAM_NOT_FOUND"))   return NextResponse.json({ error: "Program not found" }, { status: 404 });
    if (msg.includes("PROGRAM_PARTNER_MISMATCH")) return NextResponse.json({ error: "Program does not belong to your organization" }, { status: 403 });
    if (msg.includes("TOTAL_CAP_EXCEEDED"))  return NextResponse.json({ error: "Program inventory exhausted" }, { status: 409 });
    if (msg.includes("NO_LINKED_WALLET"))    return NextResponse.json({ error: "Recipient has no linked wallet" }, { status: 400 });
    if (msg.includes("SOURCE_REF_CONFLICT")) return NextResponse.json({ error: "Grant already issued to this recipient" }, { status: 409 });
    console.error("[merchant-dashboard/grant]:", error);
    return NextResponse.json({ error: "Grant failed" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.ok) return NextResponse.json({ error: "Grant failed" }, { status: 500 });

  // Audit is written atomically inside merchant_grant_atomic.

  return NextResponse.json({ voucher_id: row.voucher_id, code: row.code }, { status: 201 });
}

function generateSecureCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(10);
  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    const { randomFillSync } = require("crypto") as typeof import("crypto");
    randomFillSync(buf);
  }
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}
