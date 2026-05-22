// GET /api/merchant/profile
// Returns the authenticated merchant's profile and partner details.

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: partner, error } = await supabase
    .from("partners")
    .select("id, slug, name, country, image_url")
    .eq("id", session.partnerId)
    .single();

  if (error || !partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  return NextResponse.json({
    merchant: {
      id: session.merchantUserId,
      email: session.email,
    },
    partner,
  });
}
