// GET  /api/merchant/team  — list all merchant users for this partner
// POST /api/merchant/team  — invite/create a new team member (owner only)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("merchant_users")
    .select("id,email,name,role,is_active,created_at,updated_at")
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to fetch team" }, { status: 500 });
  return NextResponse.json({ members: data ?? [] });
}

export async function POST(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only owners can add team members" }, { status: 403 });
  }

  let body: { email?: string; name?: string; role?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, name, role = "staff", password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (!["owner", "manager", "staff"].includes(role)) {
    return NextResponse.json({ error: "role must be owner | manager | staff" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from("merchant_users")
    .insert({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      partner_id: session.partnerId,
      name: name?.trim() ?? null,
      role,
      is_active: true,
    })
    .select("id,email,name,role,is_active,created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    console.error("[team] insert failed", error);
    return NextResponse.json({ error: "Failed to create team member" }, { status: 500 });
  }

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "team.member_created",
    metadata: { new_member_id: data.id, email: data.email, role: data.role },
  });

  return NextResponse.json({ member: data }, { status: 201 });
}
