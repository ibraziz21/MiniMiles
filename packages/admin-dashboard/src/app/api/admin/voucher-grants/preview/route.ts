import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { previewVoucherGrant } from "@/lib/voucherGrantEligibility";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { member_username?: unknown; allocation_id?: unknown } | null;
  const memberUsername = typeof body?.member_username === "string" ? body.member_username.trim() : "";
  const allocationId = typeof body?.allocation_id === "string" ? body.allocation_id : "";
  if (!/^[a-z0-9_]{3,20}$/i.test(memberUsername) || !UUID.test(allocationId)) {
    return NextResponse.json({ error: "Select a valid member and allocation." }, { status: 400 });
  }

  const preview = await previewVoucherGrant(allocationId, memberUsername);
  return NextResponse.json({ preview }, { headers: { "Cache-Control": "private, no-store" } });
}
