// POST /api/auth/invite
// Owner-only. Creates a time-limited invite token for a new or existing
// merchant user. The token is returned in the response so the owner can
// share it out-of-band (email, Slack, etc.) — no email service required.
//
// Body:
//   email   string   — the invitee's email address
//   role    string   — "owner" | "manager" | "staff"  (default: "staff")

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

const TOKEN_TTL_HOURS = 48;

export async function POST(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only owners can send invites" }, { status: 403 });
  }

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, role = "staff" } = body;
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!["owner", "manager", "staff"].includes(role)) {
    return NextResponse.json({ error: "role must be owner | manager | staff" }, { status: 400 });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Invalidate any prior unused invite tokens for this email + partner
  await supabase
    .from("auth_invite_tokens")
    .update({ used: true })
    .eq("email", email.toLowerCase().trim())
    .eq("partner_id", session.partnerId)
    .eq("type", "invite")
    .eq("used", false);

  const { error } = await supabase.from("auth_invite_tokens").insert({
    token,
    email: email.toLowerCase().trim(),
    partner_id: session.partnerId,
    type: "invite",
    role,
    expires_at: expiresAt,
    created_by: session.merchantUserId,
  });

  if (error) {
    console.error("[invite] insert failed", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "team.invite_created",
    metadata: { email: email.toLowerCase().trim(), role, expires_at: expiresAt },
  });

  return NextResponse.json({
    ok: true,
    token,
    expires_at: expiresAt,
    // Convenience: include the URL the invitee should visit
    invite_url: `${process.env.MERCHANT_DASHBOARD_URL ?? ""}/accept-invite?token=${token}`,
  });
}
