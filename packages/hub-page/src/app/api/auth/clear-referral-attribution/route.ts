/**
 * POST /api/auth/clear-referral-attribution
 *
 * Clears the referral attribution cookie on logout/account switch (§8
 * "Clear the attribution cookie after ... logout/account switch"). The
 * cookie is HttpOnly, so client JS can't delete it directly — this is the
 * server round trip SignOutButton makes before calling supabase.auth.
 * signOut(). No auth required: clearing a cookie has no side effect worth
 * gating, and the client may already be mid-logout when it calls this.
 */
import { NextResponse } from "next/server";
import { REFERRAL_COOKIE_NAME } from "@/lib/akiba/referral-token";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(REFERRAL_COOKIE_NAME);
  return res;
}
