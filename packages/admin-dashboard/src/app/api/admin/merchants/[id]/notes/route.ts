import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

// POST /api/admin/merchants/[id]/notes
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.note?.trim()) return NextResponse.json({ error: "note is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("merchant_admin_notes")
    .insert({ partner_id: params.id, admin_user_id: session.adminUserId, note: body.note.trim() })
    .select("id, note, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to add note" }, { status: 500 });

  void writeAdminAuditLog({ adminUserId: session.adminUserId, action: "merchant.note_added", targetType: "merchant", targetId: params.id });

  return NextResponse.json({ note: data }, { status: 201 });
}
