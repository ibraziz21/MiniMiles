/**
 * POST /api/vouchers/grant (admin-dashboard)
 *
 * Akiba grant endpoint. Requires admin session with vouchers.write permission.
 * Actor identity is derived from the iron-session — never from the request body.
 * Writes to admin_audit_logs via writeAdminAuditLog.
 * Uses a stable, deterministic idempotency key based on programId + recipient.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

function generateSecureCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => chars[b % chars.length]).join("");
}

function stableGrantKey(programId: string, recipient: string): string {
  const raw = `akiba-grant:${programId}:${recipient.toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `agrant:${h.toString(16).padStart(8, "0")}:${programId.slice(0, 8)}`;
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession("vouchers.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminUserId = adminIdForWrite(session);
  const actorId = adminUserId ?? "open-access";

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const programId          = typeof body.program_id            === "string" ? body.program_id.trim()     : null;
  const recipientHubUserId = typeof body.recipient_hub_user_id === "string" ? body.recipient_hub_user_id : null;
  const recipientAddress   = typeof body.recipient_address     === "string" ? body.recipient_address.trim().toLowerCase() : null;

  if (!programId) return NextResponse.json({ error: "Missing program_id" }, { status: 400 });
  if (!recipientHubUserId && !recipientAddress) {
    return NextResponse.json({ error: "Provide recipient_hub_user_id or recipient_address" }, { status: 400 });
  }

  // Verify program exists and is eligible for Akiba grants
  const { data: program } = await supabase
    .from("voucher_programs")
    .select("id, funding_type, state")
    .eq("id", programId)
    .maybeSingle();

  if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
  if (!["akiba", "free", "sponsor"].includes(program.funding_type ?? "")) {
    return NextResponse.json({ error: "Program is not eligible for Akiba grants" }, { status: 400 });
  }

  const recipient  = recipientHubUserId ?? recipientAddress ?? "";
  const sourceRef  = stableGrantKey(programId, recipient);
  const code       = generateSecureCode();

  // Call the RPC directly (service-role client bypasses RLS)
  const { data, error } = await supabase.rpc("issue_voucher_from_program", {
    p_program_id:        programId,
    p_channel:           "akiba_grant",
    p_source_ref:        sourceRef,
    p_recipient_address: recipientAddress ?? null,
    p_hub_user_id:       recipientHubUserId ?? null,
    p_code:              code,
    p_evidence:          { grant_type: "akiba_grant", actor: actorId },
    p_actor_id:          actorId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("PROGRAM_NOT_FOUND"))   return NextResponse.json({ error: "Program not found" }, { status: 404 });
    if (msg.includes("PROGRAM_NOT_ACTIVE"))  return NextResponse.json({ error: "Program is not active" }, { status: 409 });
    if (msg.includes("TOTAL_CAP_EXCEEDED"))  return NextResponse.json({ error: "Program cap exhausted" }, { status: 409 });
    if (msg.includes("NO_LINKED_WALLET"))    return NextResponse.json({ error: "Recipient has no linked wallet" }, { status: 400 });
    if (msg.includes("SOURCE_REF_CONFLICT")) return NextResponse.json({ error: "Grant already claimed by a different account" }, { status: 409 });
    if (msg.includes("TEMPLATE_EXPIRED"))    return NextResponse.json({ error: "Voucher template has expired" }, { status: 409 });
    console.error("[admin/grant]", error);
    return NextResponse.json({ error: "Grant failed" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.ok) return NextResponse.json({ error: "Grant failed" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId,
    action:       "vouchers.akiba_grant",
    targetType:   "voucher",
    targetId:     row.voucher_id,
    metadata:     { program_id: programId, recipient, source_ref: sourceRef },
  });

  return NextResponse.json({ voucher_id: row.voucher_id, code: row.code }, { status: 201 });
}
