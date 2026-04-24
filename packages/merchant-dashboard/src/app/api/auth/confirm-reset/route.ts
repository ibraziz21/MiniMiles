// POST /api/auth/confirm-reset
// Step 2 of password reset — public endpoint.
// Consumes a reset token (issued by an authenticated owner/manager via
// /api/auth/reset-password) and sets a new password.
//
// Body:
//   token     string  — the reset token relayed by the owner
//   password  string  — new password (min 8 chars)

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, getSession } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, password } = body;
  if (!token || !password) {
    return NextResponse.json({ error: "token and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const { data: record, error: recordErr } = await supabase
    .from("auth_invite_tokens")
    .select("id, email, partner_id, used, expires_at")
    .eq("token", token)
    .eq("type", "password_reset")
    .maybeSingle();

  if (recordErr || !record) {
    return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
  }
  if (record.used || new Date(record.expires_at) < new Date()) {
    return NextResponse.json({ error: "Reset token has already been used or has expired" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const { data: user, error: updateErr } = await supabase
    .from("merchant_users")
    .update({ password_hash: passwordHash })
    .eq("email", record.email)
    .eq("partner_id", record.partner_id)
    .select("id, email, role, partner_id")
    .single();

  if (updateErr || !user) {
    console.error("[confirm-reset] update failed", updateErr);
    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }

  // Consume the token atomically — mark used
  await supabase
    .from("auth_invite_tokens")
    .update({ used: true })
    .eq("id", record.id);

  // Auto-login after successful reset
  const session = await getSession();
  session.merchantUserId = user.id;
  session.email = user.email;
  session.partnerId = user.partner_id;
  session.role = user.role ?? "staff";
  session.issuedAt = Date.now();
  await session.save();

  return NextResponse.json({ ok: true });
}
