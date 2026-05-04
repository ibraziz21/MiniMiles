import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

// GET /api/admin/merchants/[id]
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [partnerRes, settingsRes, ordersRes, productsRes, vouchersRes, teamRes, notesRes] = await Promise.all([
    supabase.from("partners").select("*").eq("id", params.id).single(),
    supabase.from("partner_settings").select("*").eq("partner_id", params.id).maybeSingle(),
    supabase.from("merchant_transactions").select("id, status, amount_cusd, created_at").eq("partner_id", params.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("merchant_products").select("id, name, price_cusd, active").eq("merchant_id", params.id),
    supabase.from("spend_voucher_templates").select("id, title, active, miles_cost").eq("partner_id", params.id),
    supabase.from("merchant_users").select("id, email, name, role, is_active").eq("partner_id", params.id),
    supabase.from("merchant_admin_notes").select("id, note, created_at, admin_users(name, email)").eq("partner_id", params.id).order("created_at", { ascending: false }),
  ]);

  if (!partnerRes.data) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  const orders = ordersRes.data ?? [];
  const totalRevenue = orders.filter((o) => ["delivered", "received", "completed"].includes(o.status)).reduce((s, o) => s + (o.amount_cusd ?? 0), 0);

  return NextResponse.json({
    partner: partnerRes.data,
    settings: settingsRes.data ?? null,
    recent_orders: orders,
    total_orders: orders.length,
    total_revenue_cusd: Math.round(totalRevenue * 100) / 100,
    products: productsRes.data ?? [],
    voucher_templates: vouchersRes.data ?? [],
    team: teamRes.data ?? [],
    notes: notesRes.data ?? [],
  });
}

// PATCH /api/admin/merchants/[id] — update store_active, name, etc.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const actions: string[] = [];
  const adminUserId = adminIdForWrite(session);

  // store_active toggle
  if ("store_active" in body && typeof body.store_active === "boolean") {
    const { error } = await supabase
      .from("partner_settings")
      .update({ store_active: body.store_active })
      .eq("partner_id", params.id);
    if (error) return NextResponse.json({ error: "Failed to update store status" }, { status: 500 });
    actions.push(body.store_active ? "merchant.activated" : "merchant.deactivated");
  }

  // name/slug update
  const partnerUpdates: Record<string, unknown> = {};
  if (typeof body.name === "string") partnerUpdates.name = body.name.trim();
  if (typeof body.slug === "string") partnerUpdates.slug = body.slug.trim();
  if (Object.keys(partnerUpdates).length > 0) {
    const { error } = await supabase.from("partners").update(partnerUpdates).eq("id", params.id);
    if (error) return NextResponse.json({ error: "Failed to update merchant" }, { status: 500 });
    actions.push("merchant.metadata_updated");
  }

  for (const action of actions) {
    void writeAdminAuditLog({ adminUserId, action, targetType: "merchant", targetId: params.id, metadata: body });
  }

  return NextResponse.json({ ok: true });
}
