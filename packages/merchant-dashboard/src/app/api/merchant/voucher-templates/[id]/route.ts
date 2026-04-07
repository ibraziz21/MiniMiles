// GET   /api/merchant/voucher-templates/[id]
// PATCH /api/merchant/voucher-templates/[id]  — owner/manager only
// DELETE /api/merchant/voucher-templates/[id] — owner only (sets active=false)

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
    .from("spend_voucher_templates")
    .select("*")
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template: data });
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

  // Server-side validation on changed fields
  if ("voucher_type" in body || "discount_percent" in body || "discount_cusd" in body || "miles_cost" in body || "title" in body) {
    const { data: existing } = await supabase
      .from("spend_voucher_templates")
      .select("voucher_type,discount_percent,discount_cusd,miles_cost,title")
      .eq("id", id)
      .eq("partner_id", session.partnerId)
      .single();

    if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    // Merge existing + incoming for validation
    const merged = { ...existing, ...body };

    if (merged.voucher_type === "percent_off") {
      const pct = Number(merged.discount_percent);
      if (isNaN(pct) || pct <= 0 || pct > 100) {
        return NextResponse.json({ error: "discount_percent must be 1–100 for percent_off" }, { status: 400 });
      }
    }
    if (merged.voucher_type === "fixed_off") {
      const fixed = Number(merged.discount_cusd);
      if (isNaN(fixed) || fixed <= 0) {
        return NextResponse.json({ error: "discount_cusd must be > 0 for fixed_off" }, { status: 400 });
      }
    }
    if (typeof merged.miles_cost !== "undefined") {
      const mc = Number(merged.miles_cost);
      if (isNaN(mc) || mc < 0) {
        return NextResponse.json({ error: "miles_cost must be non-negative" }, { status: 400 });
      }
    }
  }

  const { data: before } = await supabase
    .from("spend_voucher_templates")
    .select("*")
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .single();

  if (!before) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const allowed = [
    "title", "voucher_type", "miles_cost", "discount_percent", "discount_cusd",
    "applicable_category", "cooldown_seconds", "global_cap", "active", "expires_at",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if ("applicable_category" in updates) {
    if (updates.applicable_category == null || updates.applicable_category === "") {
      updates.applicable_category = null;
    } else {
      const normalizedCategory =
        typeof updates.applicable_category === "string"
          ? updates.applicable_category.trim().toLowerCase()
          : "";
      if (!PRODUCT_CATEGORY_SET.has(normalizedCategory)) {
        return NextResponse.json({ error: "Invalid applicable_category" }, { status: 400 });
      }
      updates.applicable_category = normalizedCategory;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("spend_voucher_templates")
    .update(updates)
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .select("id,title,voucher_type,miles_cost,active")
    .single();

  if (error) return NextResponse.json({ error: "Failed to update template" }, { status: 500 });

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "voucher_template.updated",
    metadata: { template_id: id, before, changes: updates },
  });

  return NextResponse.json({ template: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only owners can deactivate templates" }, { status: 403 });
  }

  const { id } = await params;

  const { data: existing } = await supabase
    .from("spend_voucher_templates")
    .select("id,title,active")
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .single();

  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { error } = await supabase
    .from("spend_voucher_templates")
    .update({ active: false })
    .eq("id", id)
    .eq("partner_id", session.partnerId);

  if (error) return NextResponse.json({ error: "Failed to deactivate template" }, { status: 500 });

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "voucher_template.deactivated",
    metadata: { template_id: id, title: existing.title },
  });

  return NextResponse.json({ ok: true });
}
