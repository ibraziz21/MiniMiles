import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

// GET /api/admin/polls  — list all polls with response counts
export async function GET(req: Request) {
  const session = await requireAdminSession("polls.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  let query = supabase
    .from("polls")
    .select("id, title, description, status, starts_at, ends_at, created_at")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data: polls, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch polls" }, { status: 500 });

  // Attach response counts
  const pollIds = (polls ?? []).map((p) => p.id);
  const [totalRes, completeRes] = await Promise.all([
    supabase.from("poll_responses").select("poll_id").in("poll_id", pollIds),
    supabase.from("poll_responses").select("poll_id").in("poll_id", pollIds).eq("is_complete", true),
  ]);

  const totalMap: Record<string, number> = {};
  const completeMap: Record<string, number> = {};
  for (const r of totalRes.data ?? []) totalMap[r.poll_id] = (totalMap[r.poll_id] ?? 0) + 1;
  for (const r of completeRes.data ?? []) completeMap[r.poll_id] = (completeMap[r.poll_id] ?? 0) + 1;

  const enriched = (polls ?? []).map((p) => ({
    ...p,
    response_count: totalMap[p.id] ?? 0,
    complete_count: completeMap[p.id] ?? 0,
  }));

  return NextResponse.json({ polls: enriched });
}

// POST /api/admin/polls  — create a new poll
export async function POST(req: Request) {
  const session = await requireAdminSession("polls.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { title?: string; description?: string; target_segment?: Record<string, unknown>; starts_at?: string; ends_at?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const adminUserId = adminIdForWrite(session);

  const { data, error } = await supabase
    .from("polls")
    .insert({
      title: body.title.trim(),
      description: body.description?.trim() ?? null,
      target_segment: body.target_segment ?? null,
      starts_at: body.starts_at ?? null,
      ends_at: body.ends_at ?? null,
      created_by: adminUserId,
      status: "draft",
    })
    .select("id, title, status")
    .single();

  if (error) return NextResponse.json({ error: "Failed to create poll" }, { status: 500 });

  void writeAdminAuditLog({ adminUserId, action: "poll.created", targetType: "poll", targetId: data.id, metadata: { title: data.title } });

  return NextResponse.json({ poll: data }, { status: 201 });
}
