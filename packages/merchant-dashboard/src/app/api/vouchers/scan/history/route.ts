/**
 * GET /api/vouchers/scan/history
 * Last 20 in-store (merchant_scan) redemptions for the session's partner.
 * partner_id is taken from the session ONLY.
 */
import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" },
  });
}

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return jsonNoStore({ error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("voucher_redemptions")
    .select("id, issued_voucher_id, discount_applied, external_reference, redeemed_at, redemption_channel")
    .eq("merchant_id", session.partnerId)
    .eq("redemption_channel", "merchant_scan")
    .order("redeemed_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[scan/history]", error.message);
    return jsonNoStore({ error: "Failed to load history" }, 500);
  }

  return jsonNoStore({ redemptions: data ?? [] });
}
