import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isHiddenPartner } from "@/lib/akiba/hidden-partners";

/**
 * Checkout-only wallet lookup. Resolved on demand when a crypto payment is
 * initiated, never embedded in the public merchant profile payload or
 * persisted client-side (see merchant-directory-in-store-discovery-spec.md
 * §8/§14 — public DTOs must never carry a payout/wallet address).
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const admin = createAdminClient();

  const { data: partner } = await admin
    .from("partners")
    .select("id, partner_settings(store_active, wallet_address)")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!partner || isHiddenPartner(partner.id)) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  const settings = Array.isArray(partner.partner_settings)
    ? partner.partner_settings[0]
    : partner.partner_settings;

  if (!settings?.store_active || !settings.wallet_address) {
    return NextResponse.json({ error: "Merchant wallet not configured" }, { status: 404 });
  }

  return NextResponse.json({ wallet_address: settings.wallet_address });
}
