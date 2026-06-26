/**
 * POST /api/vouchers/grant — REMOVED
 *
 * Akiba grants have been moved to admin-dashboard:
 *   POST /api/vouchers/grant  (requires admin session with vouchers.write permission)
 *
 * Merchant grants are handled by merchant-dashboard:
 *   POST /api/vouchers/grant  (requires merchant iron-session)
 *
 * This endpoint is intentionally gone (410) so existing callers are notified.
 */
import { NextResponse } from "next/server";

export function POST() {
  return NextResponse.json(
    { error: "Endpoint removed. Akiba grants: admin-dashboard /api/vouchers/grant. Merchant grants: merchant-dashboard /api/vouchers/grant." },
    { status: 410 }
  );
}
