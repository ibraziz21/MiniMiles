// GET  /api/merchant/products        — list products for this partner
// POST /api/merchant/products        — create a new product (owner/manager only)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { PRODUCT_CATEGORY_SET } from "@/types";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("merchant_products")
    .select("id,merchant_id,name,description,price_cusd,category,image_url,active,created_at,updated_at")
    .eq("merchant_id", session.partnerId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}

export async function POST(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: {
    name?: string;
    description?: string;
    price_cusd?: number;
    category?: string;
    image_url?: string;
    active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, description, price_cusd, category, image_url, active = true } = body;
  const normalizedCategory = typeof category === "string" ? category.trim().toLowerCase() : "general";

  if (!name || price_cusd == null || price_cusd <= 0) {
    return NextResponse.json({ error: "name and price_cusd are required" }, { status: 400 });
  }
  if (!PRODUCT_CATEGORY_SET.has(normalizedCategory)) {
    return NextResponse.json({ error: "Invalid product category" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("merchant_products")
    .insert({
      merchant_id: session.partnerId,
      name: name.trim(),
      description: description?.trim() ?? null,
      price_cusd,
      category: normalizedCategory,
      image_url: image_url ?? null,
      active,
    })
    .select("id,name,price_cusd,active")
    .single();

  if (error) {
    console.error("[products] insert failed", error);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "product.created",
    metadata: { product_id: data.id, name: data.name, price_cusd: data.price_cusd },
  });

  return NextResponse.json({ product: data }, { status: 201 });
}
