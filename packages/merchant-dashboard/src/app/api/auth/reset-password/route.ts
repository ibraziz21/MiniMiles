// POST /api/auth/reset-password
// Two-step password reset — no email service required.
//
// Step 1 — issue a reset token  (body: { email })
//   REQUIRES an authenticated owner or manager session.
//   Only an owner/manager for the same partner can generate a token for one of
//   their team members. This prevents unauthenticated account takeover via
//   the public reset endpoint.
//   Returns the token so the authenticated caller can relay it out-of-band.
//
// Step 2 — consume the token   (body: { token, password })
//   Public — this is the page the locked-out user visits with their token.

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabase } from "@/lib/supabase";
import { requireMerchantSession } from "@/lib/auth";

const TOKEN_TTL_MINUTES = 30;

export async function POST(req: Request) {
  let body: { email?: string; token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  return handleResetRequest(req, body.email);
}

// ── Step 1: issue token (authenticated owner/manager only) ────────────────────

async function handleResetRequest(req: Request, email: string) {
  // Step 1 requires a valid merchant session from an owner or manager.
  // A locked-out user cannot reset their own password without involving their
  // account owner — this is intentional to prevent unauthenticated takeover.
  const session = await requireMerchantSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized — sign in as an owner or manager to issue a reset token" }, { status: 401 });
  }
  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Only owners and managers can issue password reset tokens" }, { status: 403 });
  }

  const key = email.toLowerCase().trim();

  // Verify the target email belongs to the same partner and is a known user
  const { data: targetUser } = await supabase
    .from("merchant_users")
    .select("id, partner_id, is_active")
    .eq("email", key)
    .eq("partner_id", session.partnerId) // enforce partner isolation
    .maybeSingle();

  // Return 200 regardless — don't reveal whether the email exists within this partner
  if (!targetUser) {
    return NextResponse.json({ ok: true });
  }

  // Invalidate any existing unused reset tokens for this user
  await supabase
    .from("auth_invite_tokens")
    .update({ used: true })
    .eq("email", key)
    .eq("type", "password_reset")
    .eq("used", false);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  await supabase.from("auth_invite_tokens").insert({
    token,
    email: key,
    partner_id: targetUser.partner_id,
    type: "password_reset",
    expires_at: expiresAt,
    created_by: session.merchantUserId,
  });

  // Token is returned to the authenticated caller to relay out-of-band.
  return NextResponse.json({
    ok: true,
    token,
    expires_at: expiresAt,
    reset_url: `${process.env.MERCHANT_DASHBOARD_URL ?? ""}/reset-password?token=${token}`,
  });
}

