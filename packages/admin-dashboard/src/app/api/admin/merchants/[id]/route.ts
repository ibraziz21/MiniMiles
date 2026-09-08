import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

// GET /api/admin/merchants/[id]
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [partnerRes, settingsRes, subscriptionRes, vouchersRes, teamRes, notesRes] = await Promise.all([
    supabase.from("partners").select("*").eq("id", params.id).single(),
    supabase.from("partner_settings").select("directory_status").eq("partner_id", params.id).maybeSingle(),
    supabase
      .from("partner_subscriptions")
      .select("plan,status,billing_period,included_monthly_miles,miles_issued_current_period,overage_miles_current_period,next_renewal_at")
      .eq("partner_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("spend_voucher_templates").select("id, title, active, lifecycle_state, miles_cost").eq("partner_id", params.id),
    supabase.from("merchant_users").select("id, email, name, role, is_active").eq("partner_id", params.id),
    supabase.from("merchant_admin_notes").select("id, note, created_at, admin_users(name, email)").eq("partner_id", params.id).order("created_at", { ascending: false }),
  ]);

  if (!partnerRes.data) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  return NextResponse.json({
    partner: partnerRes.data,
    settings: settingsRes.data ?? null,
    subscription: subscriptionRes.data ?? null,
    voucher_templates: vouchersRes.data ?? [],
    team: teamRes.data ?? [],
    notes: notesRes.data ?? [],
  });
}

// PATCH /api/admin/merchants/[id] — update merchant identity metadata.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const actions: string[] = [];
  const adminUserId = adminIdForWrite(session);

  // name/slug update
  const partnerUpdates: Record<string, unknown> = {};
  if (typeof body.name === "string") partnerUpdates.name = body.name.trim();
  if (typeof body.slug === "string") partnerUpdates.slug = body.slug.trim();
  if (Object.keys(partnerUpdates).length > 0) {
    const { error } = await supabase.from("partners").update(partnerUpdates).eq("id", params.id);
    if (error) return NextResponse.json({ error: "Failed to update merchant" }, { status: 500 });
    actions.push("merchant.metadata_updated");
  }

  if (actions.length === 0) {
    return NextResponse.json({ error: "No supported merchant fields were provided." }, { status: 400 });
  }

  for (const action of actions) {
    void writeAdminAuditLog({ adminUserId, action, targetType: "merchant", targetId: params.id, metadata: body });
  }

  return NextResponse.json({ ok: true });
}
