// PATCH /api/admin/account/profile
// Allows a logged-in admin to update their own profile.

import { NextResponse } from "next/server";
import {
  adminIdForWrite,
  getSession,
  requireAdminSession,
  verifyPassword,
} from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

export async function PATCH(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.openAccess) {
    return NextResponse.json(
      { error: "Profile changes are disabled in open-access mode" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const { data: adminUser, error: readError } = await supabase
    .from("admin_users")
    .select("id, email, password_hash, is_active")
    .eq("id", session.adminUserId)
    .single();

  if (readError || !adminUser || !adminUser.is_active) {
    return NextResponse.json({ error: "Admin account is unavailable" }, { status: 401 });
  }

  const emailChanged = email !== adminUser.email;
  if (emailChanged) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required to change email" },
        { status: 400 },
      );
    }

    const validCurrentPassword = await verifyPassword(currentPassword, adminUser.password_hash);
    if (!validCurrentPassword) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
  }

  const { data, error: updateError } = await supabase
    .from("admin_users")
    .update({ name, email, updated_at: new Date().toISOString() })
    .eq("id", session.adminUserId)
    .select("id, email, name, role, is_active, must_change_password")
    .single();

  if (updateError) {
    if (updateError.code === "23505") {
      return NextResponse.json({ error: "An admin with that email already exists" }, { status: 409 });
    }
    console.error("[admin/account/profile] update error:", updateError);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  const cookieSession = await getSession();
  cookieSession.email = data.email;
  cookieSession.name = data.name ?? null;
  cookieSession.role = data.role;
  cookieSession.mustChangePassword = Boolean(data.must_change_password);
  cookieSession.issuedAt = Date.now();
  await cookieSession.save();

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "admin_user.profile_updated",
    targetType: "admin_user",
    targetId: session.adminUserId,
    metadata: { emailChanged },
  });

  return NextResponse.json({ admin: data });
}
