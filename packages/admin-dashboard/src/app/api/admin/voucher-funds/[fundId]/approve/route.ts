import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { getAdminSettings } from "@/lib/adminSettings";
import { supabase } from "@/lib/supabase";
import { transitionProgram, OPEN_ACCESS_ACTOR_ID, minorToKes, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/approve — Finance approves the maximum KES commitment.
// See packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §5 (maker-checker) and §7.7.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.approve");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 4) {
    return NextResponse.json({ error: "A reason of at least 4 characters is required to approve." }, { status: 400 });
  }

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;

  const { data: program } = await supabase
    .from("voucher_funding_programs")
    .select("created_by, authorized_budget_minor")
    .eq("id", fundId)
    .single();

  if (program) {
    const settings = await getAdminSettings();
    const exceedsThreshold =
      minorToKes(program.authorized_budget_minor) > settings.finance.voucherFundMakerCheckerThresholdKes;
    if (exceedsThreshold && program.created_by === actorId && session.role !== "super_admin") {
      return NextResponse.json(
        { error: "This commitment exceeds the maker-checker threshold — a different approver is required." },
        { status: 403 },
      );
    }
  }

  const { data, error } = await transitionProgram(fundId, "approve", actorId, reason, null);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.approved",
    targetType: "voucher_funding_program",
    targetId: fundId,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true, data });
}
