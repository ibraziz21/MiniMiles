// PATCH /api/admin/referrals/program/[id]
// Body: { action: "publish" | "pause" }
//
// publish: draft -> active, via admin_publish_referral_program_version
// (054_referral_admin_actions.sql), which relies on the DB's partial unique
// index for "at most one active version" rather than a check-then-set race
// here. pause: active -> paused, an emergency stop that does not cancel
// already earned/released rewards (§11.1).

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "Program version not found",
  NOT_DRAFT: "Only a draft version can be published",
  ANOTHER_VERSION_ACTIVE: "Another version is already active — pause it first",
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "publish") {
    const { data, error } = await supabase.rpc("admin_publish_referral_program_version", {
      p_version_id: params.id,
    });
    if (error) return NextResponse.json({ error: "Publish failed" }, { status: 500 });
    const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; error_code: string | null } | undefined;
    if (!row?.ok) {
      return NextResponse.json({ error: ERROR_MESSAGES[row?.error_code ?? ""] ?? "Publish failed" }, { status: 409 });
    }
    await writeAdminAuditLog({
      adminUserId: adminIdForWrite(session),
      action: "referral.program.published",
      targetType: "referral_program_version",
      targetId: params.id,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "pause") {
    const { data, error } = await supabase.rpc("admin_pause_referral_program_version", {
      p_version_id: params.id,
    });
    if (error) return NextResponse.json({ error: "Pause failed" }, { status: 500 });
    if (data !== true) {
      return NextResponse.json({ error: "Version is not currently active" }, { status: 409 });
    }
    await writeAdminAuditLog({
      adminUserId: adminIdForWrite(session),
      action: "referral.program.paused",
      targetType: "referral_program_version",
      targetId: params.id,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action must be publish | pause" }, { status: 400 });
}
