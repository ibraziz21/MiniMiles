// POST /api/auth/login
// Authenticates a merchant by email + password.
// On success, sets an iron-session cookie scoped to their partner_id.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/auth";

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

  // 1. Look up merchant user
  const { data: merchant, error } = await supabase
    .from("merchant_users")
    .select("id, email, password_hash, partner_id, name, role, partners(name)")
    .eq("email", email.toLowerCase().trim())
    .single();

  // Deliberately vague error — don't reveal whether the account exists
  if (error || !merchant) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 2. Verify password
  const valid = await verifyPassword(password, merchant.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

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
