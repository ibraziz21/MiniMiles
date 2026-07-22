// GET /api/claw/vouchers/user/[address]
// Returns claw vouchers for a user by hydrating known session IDs from the
// local session index. No browser or API-wide event history scan is needed.
import { NextResponse } from "next/server";
import { getClawVouchersForPlayer } from "@/lib/server/clawVouchers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const address = rawAddress?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  try {
    const result = await getClawVouchersForPlayer(address);
    if (result.setupRequired) {
      return NextResponse.json({ vouchers: [], setupRequired: true, error: result.error });
    }
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ vouchers: result.vouchers });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
