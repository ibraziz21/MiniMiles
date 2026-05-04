import { NextResponse } from "next/server";
import { writeAdminAuditLog } from "@/lib/audit";
import { getSession, hashPassword, sha256Hex } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const MIN_PASSWORD_LENGTH = 12;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const tokenHash = await sha256Hex(token);

  const { data: admin } = await supabase
    .from("admin_users")
    .select("email, name, role, password_setup_expires_at, password_set_at")
    .eq("password_setup_token_hash", tokenHash)
    .maybeSingle();

  if (!admin || admin.password_set_at || !admin.password_setup_expires_at) {
    return NextResponse.json({ error: "Invalid setup link" }, { status: 404 });
  }

  if (new Date(admin.password_setup_expires_at) <= new Date()) {
    return NextResponse.json({ error: "Setup link has expired" }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    admin: { email: admin.email, name: admin.name, role: admin.role },
  });
}

export async function POST(req: Request) {
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = body.token ?? "";
  const password = body.password ?? "";

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 },
    );
  }

  const tokenHash = await sha256Hex(token);
  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, email, name, role, password_setup_expires_at, password_set_at")
    .eq("password_setup_token_hash", tokenHash)
    .maybeSingle();

  if (!admin || admin.password_set_at || !admin.password_setup_expires_at) {
    return NextResponse.json({ error: "Invalid setup link" }, { status: 404 });
  }

  if (new Date(admin.password_setup_expires_at) <= new Date()) {
    return NextResponse.json({ error: "Setup link has expired" }, { status: 410 });
  }

  const passwordHash = await hashPassword(password);
  const { error } = await supabase
    .from("admin_users")
    .update({
      password_hash: passwordHash,
      is_active: true,
      password_setup_token_hash: null,
      password_setup_expires_at: null,
      password_set_at: new Date().toISOString(),
    })
    .eq("id", admin.id);

  if (error) {
    return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
  }

  const session = await getSession();
  session.adminUserId = admin.id;
  session.email = admin.email;
  session.name = admin.name ?? null;
  session.role = admin.role;
  session.issuedAt = Date.now();
  await session.save();

  await writeAdminAuditLog({
    adminUserId: admin.id,
    action: "auth.password_setup",
    targetType: "admin_user",
    targetId: admin.id,
    metadata: { email: admin.email },
  });

  return NextResponse.json({
    ok: true,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  });
}
