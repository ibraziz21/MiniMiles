import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!akibaFundedVouchersAdminFlag()) return NextResponse.json({ error: "Voucher issuance is disabled." }, { status: 503 });

  const body = await request.json().catch(() => null) as { member_id?: unknown; allocation_id?: unknown } | null;
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  const allocationId = typeof body?.allocation_id === "string" ? body.allocation_id : "";
  if (!UUID.test(memberId) || !UUID.test(allocationId)) return NextResponse.json({ error: "Select a valid member and allocation." }, { status: 400 });

  const [memberRes, allocationRes, availabilityRes] = await Promise.all([
    supabase.from("akiba_users").select("id, username").eq("id", memberId).maybeSingle(),
    supabase.from("voucher_funding_allocations").select("id, state, distribution_modes, claim_starts_at, claim_ends_at, max_reimbursement_minor").eq("id", allocationId).maybeSingle(),
    supabase.from("v_voucher_funding_allocation_availability").select("quantity_remaining, available_budget_minor").eq("allocation_id", allocationId).maybeSingle(),
  ]);
  if (!memberRes.data?.username) return NextResponse.json({ error: "Member could not be resolved to a canonical username." }, { status: 404 });
  if (!allocationRes.data) return NextResponse.json({ error: "Allocation not found." }, { status: 404 });

  const now = Date.now();
  const allocationLive = ["active", "scheduled"].includes(allocationRes.data.state)
    && new Date(allocationRes.data.claim_starts_at).getTime() <= now
    && new Date(allocationRes.data.claim_ends_at).getTime() > now;
  const directIssueAllowed = (allocationRes.data.distribution_modes ?? []).includes("internal_grant");
  const inventoryAvailable = Number(availabilityRes.data?.quantity_remaining ?? 0) > 0
    && Number(availabilityRes.data?.available_budget_minor ?? 0) >= Number(allocationRes.data.max_reimbursement_minor ?? 0);

  const operationallyReady = allocationLive && directIssueAllowed && inventoryAvailable;
  return NextResponse.json({
    preview: {
      eligible: false,
      code: operationallyReady ? "CLAIM_MODE_NOT_ENABLED" : "ALLOCATION_NOT_GRANTABLE",
      message: operationallyReady
        ? "This allocation is ready, but the Platform currently has direct internal grants disabled. No voucher has been issued."
        : "This allocation cannot currently issue a voucher. Resolve the failed requirements and check again.",
      requirements: [
        { label: "Canonical member selected", satisfied: true },
        { label: "Allocation is live", satisfied: allocationLive },
        { label: "Direct issue is configured", satisfied: directIssueAllowed },
        { label: "Quantity and budget remain", satisfied: inventoryAvailable },
        { label: "Platform internal-grant control is enabled", satisfied: false },
      ],
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
