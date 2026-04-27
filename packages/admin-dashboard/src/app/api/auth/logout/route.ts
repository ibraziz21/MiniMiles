import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  const adminUserId = session.adminUserId;

  if (adminUserId) {
    void writeAdminAuditLog({ adminUserId, action: "auth.logout" });
  }

  session.destroy();
  return NextResponse.json({ ok: true });
}
