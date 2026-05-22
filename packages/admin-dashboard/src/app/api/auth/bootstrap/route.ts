// POST /api/auth/bootstrap
// Creates the first super_admin when the admin_users table is empty.
// Requires ADMIN_BOOTSTRAP_SECRET env var to match the request body.
// Should be disabled (remove the env var) after first use.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { getAdminSettings } from "@/lib/adminSettings";

export async function POST(req: Request) {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Bootstrap is disabled" }, { status: 403 });
  }

  let body: { email?: string; password?: string; name?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.secret !== secret) {
    return NextResponse.json({ error: "Invalid bootstrap secret" }, { status: 403 });
  }

  const { email, password, name } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  // Only allowed if table is empty
  const { count } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "Bootstrap is only allowed when admin_users is empty" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const settings = await getAdminSettings();

  const { data, error } = await supabase
    .from("admin_users")
    .insert({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      name: name ?? null,
      role: "super_admin",
      must_change_password: settings.security.requireTempPasswordReset,
    })
    .select("id, email, role, must_change_password")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create admin user" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, admin: data }, { status: 201 });
}
