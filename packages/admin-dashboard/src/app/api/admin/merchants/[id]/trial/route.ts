import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { isUuid, OPEN_ACCESS_ADMIN_ID } from "@/lib/subscriptionPayments";
import {
  DEFAULT_TRIAL_DAYS,
  MAX_TRIAL_DAYS,
  parseTrialDays,
  SUBSCRIPTION_TRIAL_RPC,
  trialGrantErrorMessage,
} from "@/lib/subscriptionTrials";
import { supabase } from "@/lib/supabase";

// POST /api/admin/merchants/[id]/trial — grant a short onboarding trial.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid merchant id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const days = parseTrialDays(body?.days ?? DEFAULT_TRIAL_DAYS);
  if (days === null) {
    return NextResponse.json(
      { error: `days must be a whole number between 1 and ${MAX_TRIAL_DAYS}` },
      { status: 400 },
    );
  }

  const adminUserId = adminIdForWrite(session);
  const { data, error } = await supabase.rpc(SUBSCRIPTION_TRIAL_RPC, {
    p_partner_id: params.id,
    p_admin_id: adminUserId ?? OPEN_ACCESS_ADMIN_ID,
    p_days: days,
  });

  if (error) {
    console.error("[admin/merchants] grant trial RPC error:", error.message);
    return NextResponse.json({ error: "Could not grant the trial." }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ok) {
    const code = result?.error_code as string | undefined;
    const status = code === "PARTNER_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ error: trialGrantErrorMessage(code), code }, { status });
  }

  void writeAdminAuditLog({
    adminUserId,
    action: "merchant.trial_granted",
    targetType: "merchant",
    targetId: params.id,
    metadata: {
      days,
      subscription_id: result.subscription_id,
      trial_starts_at: result.trial_starts_at,
      trial_ends_at: result.trial_ends_at,
    },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    days,
    subscriptionId: result.subscription_id,
    status: result.status,
    trialStartsAt: result.trial_starts_at,
    trialEndsAt: result.trial_ends_at,
  });
}
