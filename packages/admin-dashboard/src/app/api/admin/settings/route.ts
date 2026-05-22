// GET/PATCH /api/admin/settings
// System-wide admin-dashboard settings. Super-admins can update.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import {
  getAdminSettings,
  normalizeAdminSettings,
  saveAdminSettings,
} from "@/lib/adminSettings";
import { writeAdminAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getAdminSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can update settings" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  let settings;
  try {
    settings = normalizeAdminSettings(body?.settings ?? body);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Invalid settings" }, { status: 400 });
  }

  try {
    const saved = await saveAdminSettings(settings, adminIdForWrite(session));
    void writeAdminAuditLog({
      adminUserId: adminIdForWrite(session),
      action: "admin_settings.updated",
      targetType: "admin_settings",
      metadata: {
        security: saved.security,
        finance: {
          ...saved.finance,
          businessAddress: saved.finance.businessAddress ? "[set]" : "",
        },
        notifications: saved.notifications,
      },
    });

    return NextResponse.json({ settings: saved });
  } catch (err: any) {
    console.error("[admin/settings] update error:", err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
