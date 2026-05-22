// POST /api/auth/login
// Authenticates a merchant by email + password.
// On success, sets an iron-session cookie scoped to their partner_id.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/auth";
import { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } from "@/lib/loginRateLimit";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password } = body;

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  // 0. Rate limit check — before any DB lookup to avoid timing oracles
  const rateLimit = await checkLoginRateLimit(email);
  if (!rateLimit.allowed) {
    const retryAfterSec = Math.ceil((rateLimit.retryAfter.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  // 1. Look up merchant user
  const { data: merchant, error } = await supabase
    .from("merchant_users")
    .select("id, email, password_hash, partner_id, name, role, is_active, partners(name)")
    .eq("email", email.toLowerCase().trim())
    .single();

  // Deliberately vague error — don't reveal whether the account exists
  if (error || !merchant) {
    await recordLoginFailure(email);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 2. Verify password
  const valid = await verifyPassword(password, merchant.password_hash);
  if (!valid) {
    await recordLoginFailure(email);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 3. Reject deactivated accounts (checked after password to keep timing consistent)
  if (merchant.is_active === false) {
    // Don't count deactivated-account attempts toward the failure counter —
    // the owner may re-activate the account later and shouldn't find it locked.
    return NextResponse.json({ error: "Account is disabled" }, { status: 403 });
  }

  // Success — reset failure counter
  await recordLoginSuccess(email);

  const partnerName =
    // @ts-expect-error — Supabase nested join typing
    (merchant.partners as { name: string } | null)?.name ?? "";

  // 3. Set session
  const session = await getSession();
  session.merchantUserId = merchant.id;
  session.email = merchant.email;
  session.partnerId = merchant.partner_id;
  session.partnerName = partnerName;
  session.role = merchant.role ?? "staff";
  session.issuedAt = Date.now();
  await session.save();

  return NextResponse.json({
    ok: true,
    merchant: {
      id: merchant.id,
      email: merchant.email,
      name: merchant.name,
      partnerId: merchant.partner_id,
      partnerName,
    },
  });
}
