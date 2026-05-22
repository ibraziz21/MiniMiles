// PATCH /api/merchant/team/[id]  — update role or is_active (owner only)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only owners can manage team members" }, { status: 403 });
  }

  const { id } = await params;

  // Prevent self-demotion/deactivation
  if (id === session.merchantUserId) {
    return NextResponse.json({ error: "Cannot modify your own account" }, { status: 400 });
  }

  let body: { role?: string; is_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("merchant_users")
    .select("id,email,role,is_active,partner_id")
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .single();

  if (!existing) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if ("role" in body) {
    if (!["owner", "manager", "staff"].includes(body.role as string)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    updates.role = body.role;
  }
  if ("is_active" in body) {
    updates.is_active = body.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("merchant_users")
    .update(updates)
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .select("id,email,role,is_active")
    .single();

  if (error) return NextResponse.json({ error: "Failed to update member" }, { status: 500 });

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "team.member_updated",
    metadata: { member_id: id, before: { role: existing.role, is_active: existing.is_active }, changes: updates },
  });

  return NextResponse.json({ member: data });
}
