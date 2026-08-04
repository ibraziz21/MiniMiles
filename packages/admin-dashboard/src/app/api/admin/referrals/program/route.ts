// POST /api/admin/referrals/program — draft a new immutable program version
// (referral-system-spec.md §11.1). Published financial settings can't be
// edited in place — this always creates a NEW row; publishing it is a
// separate action (PATCH .../program/[id]).

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

type DraftBody = {
  signup_reward_miles?: number;
  activation_reward_miles?: number;
  attribution_window_days?: number;
  activation_window_days?: number;
  signup_hold_hours?: number;
  activation_hold_hours?: number;
  min_purchase_kes?: number;
  daily_signup_cap?: number;
  rolling_30_day_referral_cap?: number;
  total_budget_miles?: number;
};

const REQUIRED_POSITIVE: (keyof DraftBody)[] = [
  "signup_reward_miles", "activation_reward_miles",
  "attribution_window_days", "activation_window_days",
  "daily_signup_cap", "rolling_30_day_referral_cap",
];
const REQUIRED_NON_NEGATIVE: (keyof DraftBody)[] = [
  "signup_hold_hours", "activation_hold_hours", "min_purchase_kes", "total_budget_miles",
];

export async function POST(req: Request) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: DraftBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  for (const key of REQUIRED_POSITIVE) {
    if (!Number.isFinite(body[key]) || (body[key] as number) <= 0) {
      return NextResponse.json({ error: `${key} must be a positive number` }, { status: 400 });
    }
  }
  for (const key of REQUIRED_NON_NEGATIVE) {
    if (!Number.isFinite(body[key]) || (body[key] as number) < 0) {
      return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 });
    }
  }

  const { data: latest } = await supabase
    .from("referral_program_versions")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("referral_program_versions")
    .insert({
      version: nextVersion,
      status: "draft",
      created_by: adminIdForWrite(session),
      ...body,
    })
    .select("id, version")
    .single();

  if (error) return NextResponse.json({ error: "Failed to create draft" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "referral.program.drafted",
    targetType: "referral_program_version",
    targetId: data.id,
    metadata: { version: data.version, ...body },
  });

  return NextResponse.json({ ok: true, id: data.id, version: data.version });
}
