// PATCH /api/admin/referrals/flags/[key]
// Body: { enabled: boolean }
//
// Toggles one of the four independent referral kill switches
// (referral_system_flags, 053_referral_system.sql, referral-system-spec.md
// §11.4). Hub's RPCs read this table directly (referral_flag_enabled) —
// turning a switch off here takes effect on Hub's very next call, no
// deploy/restart needed. Disabling release_rewards preserves eligible jobs
// for later processing; it must not mark them successful or discard them —
// enforced by the fact this route only ever flips the boolean, nothing else.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

const VALID_KEYS = new Set(["accept_clicks", "bind_referrals", "qualify_activations", "release_rewards"]);

export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!VALID_KEYS.has(params.key)) {
    return NextResponse.json({ error: "Unknown flag" }, { status: 404 });
  }

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const { error } = await supabase
    .from("referral_system_flags")
    .update({ enabled: body.enabled, updated_at: new Date().toISOString(), updated_by: session.email })
    .eq("key", params.key);

  if (error) return NextResponse.json({ error: "Failed to update flag" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `referral.flag.${body.enabled ? "enabled" : "disabled"}`,
    targetType: "referral_system_flag",
    targetId: params.key,
  });

  return NextResponse.json({ ok: true });
}
