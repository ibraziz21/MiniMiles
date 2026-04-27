import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession, verifyPassword, checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";

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

  const rateLimit = await checkLoginRateLimit(email);
  if (!rateLimit.allowed) {
    const retryAfterSec = Math.ceil((rateLimit.retryAfter.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const { data: adminUser, error } = await supabase
    .from("admin_users")
    .select("id, email, name, password_hash, role, is_active")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (error || !adminUser) {
    await recordLoginFailure(email);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, adminUser.password_hash);
  if (!valid) {
    await recordLoginFailure(email);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!adminUser.is_active) {
    return NextResponse.json({ error: "Account is disabled" }, { status: 403 });
  }

  await recordLoginSuccess(email);

  const session = await getSession();
  session.adminUserId = adminUser.id;
  session.email = adminUser.email;
  session.name = adminUser.name ?? null;
  session.role = adminUser.role;
  session.issuedAt = Date.now();
  await session.save();

  // Update last_login_at — fire and forget
  void supabase
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", adminUser.id);

  void writeAdminAuditLog({
    adminUserId: adminUser.id,
    action: "auth.login",
    metadata: { email: adminUser.email },
  });

  return NextResponse.json({ ok: true, admin: { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: adminUser.role } });
}
