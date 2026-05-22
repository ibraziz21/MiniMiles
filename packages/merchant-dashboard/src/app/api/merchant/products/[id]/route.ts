// GET    /api/merchant/products/[id]  — fetch single product
// PATCH  /api/merchant/products/[id]  — update product (owner/manager)
// DELETE /api/merchant/products/[id]  — archive/soft-delete (owner only)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { PRODUCT_CATEGORY_SET } from "@/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data, error } = await supabase
    .from("merchant_products")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", session.partnerId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  return NextResponse.json({ product: data });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Fetch existing to confirm ownership + capture before-state for audit
  const { data: existing } = await supabase
    .from("merchant_products")
    .select("id,name,price_cusd,active,merchant_id")
    .eq("id", id)
    .eq("merchant_id", session.partnerId)
    .single();

  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const allowed = ["name", "description", "price_cusd", "category", "image_url", "active"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if ("category" in updates) {
    const normalizedCategory =
      typeof updates.category === "string" ? updates.category.trim().toLowerCase() : "";
    if (!PRODUCT_CATEGORY_SET.has(normalizedCategory)) {
      return NextResponse.json({ error: "Invalid product category" }, { status: 400 });
    }
    updates.category = normalizedCategory;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("merchant_products")
    .update(updates)
    .eq("id", id)
    .eq("merchant_id", session.partnerId)
    .select("id,name,price_cusd,active,category,image_url,description")
    .single();

  if (error) return NextResponse.json({ error: "Failed to update product" }, { status: 500 });

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "product.updated",
    metadata: { product_id: id, before: existing, changes: updates },
  });

  return NextResponse.json({ product: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only owners can archive products" }, { status: 403 });
  }

  const { id } = await params;

  const { data: existing } = await supabase
    .from("merchant_products")
    .select("id,name,active")
    .eq("id", id)
    .eq("merchant_id", session.partnerId)
    .single();

  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  // Soft-delete: set active = false
  const { error } = await supabase
    .from("merchant_products")
    .update({ active: false })
    .eq("id", id)
    .eq("merchant_id", session.partnerId);

  if (error) return NextResponse.json({ error: "Failed to archive product" }, { status: 500 });

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "product.archived",
    metadata: { product_id: id, name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
