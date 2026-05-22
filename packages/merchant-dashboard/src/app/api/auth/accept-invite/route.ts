// POST /api/auth/accept-invite
// Accepts an invite token and sets the user's password.
// Creates the merchant_user record if it doesn't exist yet.
//
// Body:
//   token     string  — the invite token from /api/auth/invite
//   name      string  — display name
//   password  string  — chosen password (min 8 chars)

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, getSession } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { token?: string; name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, name, password } = body;
  if (!token || !password) {
    return NextResponse.json({ error: "token and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Look up and validate the token
  const { data: invite, error: inviteErr } = await supabase
    .from("auth_invite_tokens")
    .select("id, email, partner_id, role, type, used, expires_at")
    .eq("token", token)
    .eq("type", "invite")
    .maybeSingle();

  if (inviteErr || !invite) {
    return NextResponse.json({ error: "Invalid or expired invite token" }, { status: 400 });
  }
  if (invite.used || new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite token has already been used or has expired" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  // Role is taken from the token, not the request body — the inviting owner
  // decided the role at invite creation time and it cannot be escalated by the invitee.
  const assignedRole = invite.role ?? "staff";

  // Upsert the merchant user — handles both new invitees and reinvited existing users
  const { data: user, error: upsertErr } = await supabase
    .from("merchant_users")
    .upsert(
      {
        email: invite.email,
        partner_id: invite.partner_id,
        password_hash: passwordHash,
        name: name?.trim() ?? null,
        is_active: true,
        role: assignedRole,
      },
      { onConflict: "email" },
    )
    .select("id, email, name, role, partner_id")
    .single();

  if (upsertErr || !user) {
    console.error("[accept-invite] upsert failed", upsertErr);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }

  // Mark token as used
  await supabase
    .from("auth_invite_tokens")
    .update({ used: true })
    .eq("id", invite.id);

  // Auto-login after accepting invite
  const session = await getSession();
  session.merchantUserId = user.id;
  session.email = user.email;
  session.partnerId = user.partner_id;
  session.role = user.role ?? "staff";
  session.issuedAt = Date.now();
  await session.save();

  return NextResponse.json({ ok: true, email: user.email });
}
