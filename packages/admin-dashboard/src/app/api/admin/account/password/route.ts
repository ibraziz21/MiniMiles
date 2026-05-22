// PATCH /api/admin/account/password
// Allows a logged-in admin to replace their temporary password.

import { NextResponse } from "next/server";
import {
  adminIdForWrite,
  getSession,
  hashPassword,
  requireAdminSession,
  verifyPassword,
} from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { getAdminSettings } from "@/lib/adminSettings";
import { supabase } from "@/lib/supabase";

export async function PATCH(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.openAccess) {
    return NextResponse.json(
      { error: "Password changes are disabled in open-access mode" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are required" }, { status: 400 });
  }

  const settings = await getAdminSettings();
  const minPasswordLength = settings.security.passwordMinLength;
  if (newPassword.length < minPasswordLength) {
    return NextResponse.json(
      { error: `New password must be at least ${minPasswordLength} characters` },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current password" },
      { status: 400 },
    );
  }

  const { data: adminUser, error: readError } = await supabase
    .from("admin_users")
    .select("id, password_hash, is_active")
    .eq("id", session.adminUserId)
    .single();

  if (readError || !adminUser || !adminUser.is_active) {
    return NextResponse.json({ error: "Admin account is unavailable" }, { status: 401 });
  }

  const validCurrentPassword = await verifyPassword(currentPassword, adminUser.password_hash);
  if (!validCurrentPassword) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const passwordHash = await hashPassword(newPassword);
  const { error: updateError } = await supabase
    .from("admin_users")
    .update({
      password_hash: passwordHash,
      must_change_password: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.adminUserId);

  if (updateError) {
    console.error("[admin/account/password] update error:", updateError);
    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }

  const cookieSession = await getSession();
  cookieSession.issuedAt = Date.now();
  cookieSession.mustChangePassword = false;
  await cookieSession.save();

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "admin_user.password_changed",
    targetType: "admin_user",
    targetId: session.adminUserId,
  });

  return NextResponse.json({ ok: true });
}
