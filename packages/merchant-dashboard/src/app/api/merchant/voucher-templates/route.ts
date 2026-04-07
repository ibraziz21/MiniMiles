// GET  /api/merchant/voucher-templates  — list all templates for this partner
// POST /api/merchant/voucher-templates  — create new template (owner/manager)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { PRODUCT_CATEGORY_SET } from "@/types";

function validateTemplate(body: Record<string, unknown>): string | null {
  const { voucher_type, discount_percent, discount_cusd, miles_cost, applicable_category } = body;
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    return "title is required";
  }
  if (!["free", "percent_off", "fixed_off"].includes(voucher_type as string)) {
    return "voucher_type must be free | percent_off | fixed_off";
  }
  if (typeof miles_cost !== "number" || miles_cost < 0) {
    return "miles_cost must be a non-negative number";
  }
  if (voucher_type === "percent_off") {
    if (typeof discount_percent !== "number" || discount_percent <= 0 || discount_percent > 100) {
      return "discount_percent must be 1–100 for percent_off";
    }
  }
  if (voucher_type === "fixed_off") {
    if (typeof discount_cusd !== "number" || discount_cusd <= 0) {
      return "discount_cusd must be > 0 for fixed_off";
    }
  }
  if (
    applicable_category != null &&
    applicable_category !== "" &&
    (typeof applicable_category !== "string" ||
      !PRODUCT_CATEGORY_SET.has(applicable_category.trim().toLowerCase()))
  ) {
    return "applicable_category must match a supported product category";
  }
  return null;
}

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("spend_voucher_templates")
    .select("id,partner_id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,cooldown_seconds,global_cap,active,expires_at,created_at,updated_at")
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validateTemplate(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const {
    title,
    voucher_type,
    miles_cost,
    discount_percent = null,
    discount_cusd = null,
    applicable_category = null,
    cooldown_seconds = 0,
    global_cap = null,
    active = true,
    expires_at = null,
  } = body;

  const normalizedApplicableCategory =
    typeof applicable_category === "string" && applicable_category.trim()
      ? applicable_category.trim().toLowerCase()
      : null;

  const { data, error } = await supabase
    .from("spend_voucher_templates")
    .insert({
      partner_id: session.partnerId,
      title: (title as string).trim(),
      voucher_type,
      miles_cost,
      discount_percent,
      discount_cusd,
      applicable_category: normalizedApplicableCategory,
      cooldown_seconds,
      global_cap,
      active,
      expires_at,
    })
    .select("id,title,voucher_type,miles_cost,active")
    .single();

  if (error) {
    console.error("[voucher-templates] insert failed", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "voucher_template.created",
    metadata: { template_id: data.id, title: data.title, voucher_type },
  });

  return NextResponse.json({ template: data }, { status: 201 });
}
