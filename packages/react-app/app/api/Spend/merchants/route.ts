// GET /api/Spend/merchants
// Returns all active merchants with a count of their available voucher templates.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  const { data, error } = await supabase
    .from("partners")
    .select(
      `id, slug, name, country, image_url,
       spend_voucher_templates(count)`,
    )
    .eq("spend_voucher_templates.active", true)
    .order("name");

  if (error) {
    console.error("[GET /merchants]", error);
    return NextResponse.json({ error: "Failed to fetch merchants" }, { status: 500 });
  }

  const merchants = (data ?? []).map((m: any) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    country: m.country,
    image_url: m.image_url,
    template_count: m.spend_voucher_templates?.[0]?.count ?? 0,
  }));

  return NextResponse.json({ merchants });
}
