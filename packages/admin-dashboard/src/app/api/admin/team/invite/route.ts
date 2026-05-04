import { NextResponse } from "next/server";
import { writeAdminAuditLog } from "@/lib/audit";
import { createSetupToken, requireAdminSession, sha256Hex } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { ADMIN_ROLES, type AdminRole } from "@/types";

const SETUP_LINK_TTL_HOURS = 72;

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && ADMIN_ROLES.includes(value as AdminRole);
}

export async function POST(req: Request) {
  const session = await requireAdminSession("team.write");
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.toLowerCase().trim();
  const name = body.name?.trim() || null;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  if (!isAdminRole(body.role)) {
    return NextResponse.json({ error: "A valid role is required" }, { status: 400 });
  }

  const token = createSetupToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("admin_users")
    .insert({
      email,
      name,
      role: body.role,
      is_active: false,
      created_by: session.openAccess ? null : session.adminUserId,
      password_hash: null,
      password_setup_token_hash: tokenHash,
      password_setup_expires_at: expiresAt,
      password_set_at: null,
    })
    .select("id, email, name, role, is_active, password_setup_expires_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An admin with this email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to invite admin" }, { status: 500 });
  }

  await writeAdminAuditLog({
    adminUserId: session.openAccess ? null : session.adminUserId,
    action: "team.invite",
    targetType: "admin_user",
    targetId: data.id,
    metadata: { email: data.email, role: data.role },
  });

  const setupUrl = new URL("/setup-password", req.url);
  setupUrl.searchParams.set("token", token);

  return NextResponse.json(
    { ok: true, admin: data, setupUrl: setupUrl.toString(), expiresAt },
    { status: 201 },
  );
}
