// POST /api/admin/referrals/risk-flags
// Body: { hub_user_id: string, flag_type: "suspicious_activity"|"blacklisted"|"rewards_disabled"|"manual_review", reason_code: string, notes?: string }
//
// hub_user_risk_flags (053_referral_system.sql) — a plain insert is
// sufficient here (no locking/atomicity concern beyond the row itself);
// the referral RPCs (create_or_get_hub_pass_with_referral,
// claim_referral_reward_jobs) read this table directly and take effect on
// their very next call, no separate activation step needed. This is a
// referral-specific table, distinct from this app's own wallet-keyed
// wallet_risk_flags (sql/005_risk_flags.sql) — referrals key by Hub user
// id, not wallet address, since email-only members have no wallet.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

const VALID_FLAG_TYPES = new Set(["suspicious_activity", "blacklisted", "rewards_disabled", "manual_review"]);

export async function POST(req: Request) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { hub_user_id?: string; flag_type?: string; reason_code?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.hub_user_id?.trim()) {
    return NextResponse.json({ error: "hub_user_id is required" }, { status: 400 });
  }
  if (!body.flag_type || !VALID_FLAG_TYPES.has(body.flag_type)) {
    return NextResponse.json({ error: "Invalid flag_type" }, { status: 400 });
  }
  if (!body.reason_code?.trim()) {
    return NextResponse.json({ error: "reason_code is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("hub_user_risk_flags")
    .insert({
      hub_user_id: body.hub_user_id.trim(),
      flag_type: body.flag_type,
      reason_code: body.reason_code.trim(),
      notes: body.notes?.trim() || null,
      flagged_by: adminIdForWrite(session),
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: "Failed to create flag" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "referral.risk_flag.created",
    targetType: "hub_user_risk_flag",
    targetId: data.id,
    metadata: { hubUserId: body.hub_user_id, flagType: body.flag_type, reasonCode: body.reason_code },
  });

  return NextResponse.json({ ok: true, id: data.id });
}
