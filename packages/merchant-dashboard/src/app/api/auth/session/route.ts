// GET /api/auth/session
// Returns the current merchant session (safe for client-side polling).

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    merchant: {
      id: session.merchantUserId,
      email: session.email,
      partnerId: session.partnerId,
      partnerName: session.partnerName,
      role: session.role ?? "staff",
    },
  });
}
