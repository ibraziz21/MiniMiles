import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";
import type { PollStatus } from "@/types";

const VALID_TRANSITIONS: Record<PollStatus, PollStatus[]> = {
  draft: ["live"],
  live: ["closed"],
  closed: ["verified"],
  verified: [],
};

// PATCH /api/admin/polls/[id]/status — advance poll status
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { status?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const newStatus = body.status as PollStatus;
  if (!newStatus) return NextResponse.json({ error: "status is required" }, { status: 400 });

  const { data: poll } = await supabase.from("polls").select("status").eq("id", params.id).single();
  if (!poll) return NextResponse.json({ error: "Poll not found" }, { status: 404 });

  const allowed = VALID_TRANSITIONS[poll.status as PollStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    return NextResponse.json({ error: `Cannot transition from ${poll.status} to ${newStatus}` }, { status: 422 });
  }

  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "closed") { update.closed_by = session.adminUserId; update.closed_at = new Date().toISOString(); }

  const { error } = await supabase.from("polls").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: "Failed to update poll status" }, { status: 500 });

  void writeAdminAuditLog({
    adminUserId: session.adminUserId,
    action: `poll.status.${newStatus}`,
    targetType: "poll",
    targetId: params.id,
    metadata: { from: poll.status, to: newStatus },
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
