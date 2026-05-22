// POST /api/admin/team
// Creates additional admin dashboard users. Super-admin only.

import { NextResponse } from "next/server";
import { adminIdForWrite, hashPassword, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { ADMIN_ROLES, type AdminRole } from "@/types";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can create admin users" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role as AdminRole;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (!password || password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters" }, { status: 400 });
  }
  if (!ADMIN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Valid admin role is required" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const { data, error } = await supabase
    .from("admin_users")
    .insert({
      email,
      name,
      role,
      password_hash: passwordHash,
      created_by: adminIdForWrite(session),
    })
    .select("id, email, name, role, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An admin with that email already exists" }, { status: 409 });
    }
    console.error("[admin/team] create error:", error);
    return NextResponse.json({ error: "Failed to create admin user" }, { status: 500 });
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "admin_user.created",
    targetType: "admin_user",
    targetId: data.id,
    metadata: { email, role },
  });

  return NextResponse.json({ admin: data }, { status: 201 });
}
