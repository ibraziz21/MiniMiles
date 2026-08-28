import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export async function GET() {
  const session = await requireAdminSession("vouchers.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("platform_voucher_pricing_versions")
    .select("id,benefit_key,display_name,voucher_type,discount_percent,minimum_miles_price,maximum_miles_price,selected_miles_price,effective_from,effective_to")
    .in("status", ["scheduled", "active"])
    .lte("effective_from", now)
    .or(`effective_to.is.null,effective_to.gt.${now}`)
    .order("minimum_miles_price", { ascending: true });

  if (error) {
    console.error("[admin/voucher-pricing GET]", error.message);
    return NextResponse.json({ error: "Failed to load voucher pricing" }, { status: 500 });
  }
  return NextResponse.json({ bands: data ?? [] });
}

export async function PATCH(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "super_admin" || session.openAccess) {
    return NextResponse.json({ error: "Only authenticated super admins can set voucher prices" }, { status: 403 });
  }
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const benefitKey = typeof body?.benefitKey === "string" ? body.benefitKey.trim() : "";
  const selectedMilesPrice = body?.selectedMilesPrice;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!/^[a-z0-9_]{2,64}$/.test(benefitKey)) {
    return NextResponse.json({ error: "Choose a valid benefit" }, { status: 400 });
  }
  if (!Number.isInteger(selectedMilesPrice) || Number(selectedMilesPrice) <= 0) {
    return NextResponse.json({ error: "Miles price must be a positive whole number" }, { status: 400 });
  }
  if (reason.length < 8 || reason.length > 240) {
    return NextResponse.json({ error: "Give a reason between 8 and 240 characters" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("set_platform_voucher_price_atomic", {
    p_benefit_key: benefitKey,
    p_selected_miles_price: selectedMilesPrice,
    p_admin_user_id: adminIdForWrite(session),
    p_change_reason: reason,
  });
  if (error) {
    if (error.message.includes("VOUCHER_PRICE_OUTSIDE_APPROVED_BAND")) {
      return NextResponse.json({ error: "The selected price is outside the approved Miles band" }, { status: 400 });
    }
    if (error.message.includes("VOUCHER_BENEFIT_NOT_CONFIGURED")) {
      return NextResponse.json({ error: "This voucher benefit is not active" }, { status: 404 });
    }
    console.error("[admin/voucher-pricing PATCH]", error.message);
    return NextResponse.json({ error: "Failed to update voucher pricing" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return NextResponse.json({ error: "Voucher pricing update returned no result" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_pricing.updated",
    targetType: "voucher_pricing_policy",
    targetId: row.pricing_policy_version_id,
    metadata: {
      benefitKey: row.benefit_key,
      selectedMilesPrice: row.selected_miles_price,
      minimumMilesPrice: row.minimum_miles_price,
      maximumMilesPrice: row.maximum_miles_price,
      reason,
    },
  });

  return NextResponse.json({
    band: {
      id: row.pricing_policy_version_id,
      benefit_key: row.benefit_key,
      display_name: row.display_name,
      minimum_miles_price: Number(row.minimum_miles_price),
      maximum_miles_price: Number(row.maximum_miles_price),
      selected_miles_price: Number(row.selected_miles_price),
      effective_from: row.effective_from,
    },
  });
}
