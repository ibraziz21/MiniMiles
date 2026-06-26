import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/** List destinations pending admin approval (approved_at IS NULL). */
export async function GET() {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("merchant_payout_destinations")
    .select(
      "id, partner_id, destination_type, display_name, currency, " +
      "destination_summary, is_active, is_approved, approved_at, approved_by, " +
      "verified_at, verified_by, created_by, created_at, cooling_expires_at",
    )
    .is("approved_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { destinations: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
