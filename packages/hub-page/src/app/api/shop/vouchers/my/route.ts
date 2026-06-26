import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Resolve all wallet addresses linked to this Hub user
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);

  const addresses = (walletRows ?? []).map((r) => r.address.toLowerCase());

  // Query vouchers owned by this Hub user:
  //   • new rows: hub_user_id = user.id
  //   • legacy rows: user_address IN (linked wallet addresses)
  let query = admin
    .from("issued_vouchers")
    .select(`
      id, code, status, created_at, expires_at, redeemed_at,
      acquisition_source, sponsor,
      rules_snapshot,
      spend_voucher_templates (
        id, voucher_type, discount_percent, discount_cusd,
        applicable_category, linked_product_id, retail_value_cusd, miles_cost,
        partners ( id, slug, name, image_url )
      ),
      voucher_programs ( name )
    `)
    .neq("status", "void")
    .order("created_at", { ascending: false });

  if (addresses.length > 0) {
    query = query.or(
      `hub_user_id.eq.${user.id},user_address.in.(${addresses.join(",")})`
    );
  } else {
    query = query.eq("hub_user_id", user.id);
  }

  const { data: vouchers, error } = await query;

  if (error) {
    console.error("[my-vouchers]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vouchers: vouchers ?? [] });
}
