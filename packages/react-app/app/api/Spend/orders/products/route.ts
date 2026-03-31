// GET /api/Spend/orders/products?merchant_id=<id>
// Returns the active product catalogue for a merchant.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const merchant_id = searchParams.get("merchant_id");

  if (!merchant_id || merchant_id.trim() === "") {
    return NextResponse.json({ error: "merchant_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("merchant_products")
    .select("id, name, description, price_cusd, category, image_url")
    .eq("merchant_id", merchant_id)
    .eq("active", true)
    .order("name");

  if (error) {
    console.error("[GET /orders/products]", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }

  return NextResponse.json({ products: data ?? [] });
}
