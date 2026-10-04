// Shared Phase 1 guard for every Akiba-funded voucher Admin mutation route
// (akiba-funded-voucher-launch-hardening-spec.md §3). Centralized so the
// kill switch and the production open-access/actor-identity rule are
// enforced identically everywhere instead of being re-implemented (and
// potentially drifting) per route.
import { NextResponse } from "next/server";
import type { AdminSessionData } from "@/types";
import { adminIdForWrite } from "@/lib/auth";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";
import { OPEN_ACCESS_ACTOR_ID } from "@/lib/voucherFunds";

/**
 * Returns a NextResponse to short-circuit the route with when the mutation
 * must be refused, or null when it may proceed. Checked after
 * requireAdminSession's own permission check, before any RPC call.
 */
export function fundedVoucherAdminGuard(session: AdminSessionData): NextResponse | null {
  if (!akibaFundedVouchersAdminFlag()) {
    return NextResponse.json(
      { error: "Akiba-funded voucher admin tools are not enabled." },
      { status: 503 },
    );
  }
  // Production must reject funded economic mutations under open access, and
  // never accept the zero-UUID/"open-access" actor as the real one
  // (launch-hardening-spec.md §3) — adminIdForWrite already returns null for
  // an open-access session, so checking that alone covers both cases.
  if (process.env.NODE_ENV === "production" && !adminIdForWrite(session)) {
    return NextResponse.json(
      { error: "A real admin identity is required for this action." },
      { status: 403 },
    );
  }
  return null;
}

/** The actor id to record on the Platform RPC/audit log — a real admin_users
 *  id whenever one exists, the shared open-access placeholder only outside
 *  production (fundedVoucherAdminGuard already refused the request in
 *  production when no real id is available). */
export function fundedVoucherActorId(session: AdminSessionData): string {
  return adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
}
