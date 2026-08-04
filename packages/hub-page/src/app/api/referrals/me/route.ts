/**
 * GET /api/referrals/me
 *
 * Authenticated referral dashboard (referral-system-spec.md §8). A BFF read
 * — the browser never queries the referral tables directly (they're locked
 * to service_role only), so this route selects a privacy-safe projection:
 * no friend email/phone/wallet, no risk score, no proof reference.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getReferralDashboard } from "@/lib/akiba/referralDashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dashboard = await getReferralDashboard(user.id);

  return NextResponse.json(dashboard, { headers: { "Cache-Control": "private, no-store" } });
}
