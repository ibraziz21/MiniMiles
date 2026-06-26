/**
 * GET /api/vouchers/programs
 * Returns active voucher programs with inventory counts.
 * Requires authenticated user (or service_role for internal calls).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const channel = url.searchParams.get("channel");
  const state   = url.searchParams.get("state") ?? "active";

  const admin = createAdminClient();

  let query = admin
    .from("v_program_inventory")
    .select("*")
    .eq("state", state);

  if (channel) query = query.eq("channel", channel);

  const { data, error } = await query.order("program_name");

  if (error) {
    console.error("[api/vouchers/programs] query error:", error);
    return NextResponse.json({ error: "Failed to load programs" }, { status: 500 });
  }

  return NextResponse.json({ programs: data ?? [] });
}
