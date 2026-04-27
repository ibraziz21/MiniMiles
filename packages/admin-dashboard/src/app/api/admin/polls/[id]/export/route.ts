import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

// GET /api/admin/polls/[id]/export — CSV export of all responses + answers
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [pollRes, questionsRes, responsesRes] = await Promise.all([
    supabase.from("polls").select("title").eq("id", params.id).single(),
    supabase.from("poll_questions").select("id, question_text, sort_order").eq("poll_id", params.id).order("sort_order"),
    supabase
      .from("poll_responses")
      .select("id, user_address, wallet_age_days, city, merchant_id, started_at, completed_at, is_complete, quality_flag")
      .eq("poll_id", params.id),
  ]);

  if (!pollRes.data) return NextResponse.json({ error: "Poll not found" }, { status: 404 });

  const questions = questionsRes.data ?? [];
  const responses = responsesRes.data ?? [];
  const responseIds = responses.map((r) => r.id);

  const answersRes = await supabase
    .from("poll_response_answers")
    .select("response_id, question_id, selected_options, rating_value, free_text")
    .in("response_id", responseIds);

  const answerMap: Record<string, Record<string, string>> = {};
  for (const a of answersRes.data ?? []) {
    if (!answerMap[a.response_id]) answerMap[a.response_id] = {};
    const val = a.free_text ?? (a.rating_value != null ? String(a.rating_value) : (a.selected_options ?? []).join("; "));
    answerMap[a.response_id][a.question_id] = val;
  }

  const headers = [
    "response_id",
    "user_address",
    "wallet_age_days",
    "city",
    "merchant_id",
    "started_at",
    "completed_at",
    "is_complete",
    "quality_flag",
    ...questions.map((q) => `Q${q.sort_order + 1}: ${q.question_text.replace(/,/g, ";")}`.slice(0, 80)),
  ];

  const rows = responses.map((r) => [
    r.id,
    r.user_address,
    r.wallet_age_days ?? "",
    r.city ?? "",
    r.merchant_id ?? "",
    r.started_at,
    r.completed_at ?? "",
    r.is_complete ? "1" : "0",
    r.quality_flag ?? "",
    ...questions.map((q) => (answerMap[r.id]?.[q.id] ?? "").replace(/,/g, ";")),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");

  void writeAdminAuditLog({ adminUserId: session.adminUserId, action: "poll.export_csv", targetType: "poll", targetId: params.id });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="poll-${params.id}-responses.csv"`,
    },
  });
}
