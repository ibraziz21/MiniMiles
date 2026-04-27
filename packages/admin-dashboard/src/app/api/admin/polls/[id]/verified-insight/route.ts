import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

// PUT /api/admin/polls/[id]/verified-insight — upsert a verified insight summary
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("insights.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { summary?: string; key_findings?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.summary?.trim()) return NextResponse.json({ error: "summary is required" }, { status: 400 });
  const adminUserId = adminIdForWrite(session);

  const existing = await supabase.from("verified_insights").select("id").eq("poll_id", params.id).maybeSingle();

  let result;
  if (existing.data) {
    result = await supabase
      .from("verified_insights")
      .update({ summary: body.summary.trim(), key_findings: body.key_findings ?? null, reviewed_by: adminUserId })
      .eq("id", existing.data.id)
      .select("id")
      .single();
  } else {
    result = await supabase
      .from("verified_insights")
      .insert({ poll_id: params.id, summary: body.summary.trim(), key_findings: body.key_findings ?? null, reviewed_by: adminUserId })
      .select("id")
      .single();
  }

  if (result.error) return NextResponse.json({ error: "Failed to save insight" }, { status: 500 });

  void writeAdminAuditLog({
    adminUserId,
    action: "insight.upserted",
    targetType: "poll",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
