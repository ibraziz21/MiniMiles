import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET /api/admin/polls/[id] — poll detail with questions, responses, insight
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;

  const [pollRes, questionsRes, responsesRes, insightRes, notesRes] = await Promise.all([
    supabase.from("polls").select("*").eq("id", id).single(),
    supabase.from("poll_questions").select("*").eq("poll_id", id).order("sort_order"),
    supabase
      .from("poll_responses")
      .select("id, user_address, wallet_age_days, city, merchant_id, started_at, completed_at, is_complete, quality_flag")
      .eq("poll_id", id)
      .order("started_at", { ascending: false }),
    supabase.from("verified_insights").select("*").eq("poll_id", id).maybeSingle(),
    supabase
      .from("insight_review_notes")
      .select("id, note, created_at, admin_users(name, email)")
      .eq("poll_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!pollRes.data) return NextResponse.json({ error: "Poll not found" }, { status: 404 });

  const responses = responsesRes.data ?? [];
  const total = responses.length;
  const complete = responses.filter((r) => r.is_complete).length;

  // Aggregate answers per question
  const questionIds = (questionsRes.data ?? []).map((q) => q.id);
  const answersRes = await supabase
    .from("poll_response_answers")
    .select("question_id, selected_options, rating_value, free_text")
    .in("question_id", questionIds);

  const answersByQuestion: Record<string, typeof answersRes.data> = {};
  for (const a of answersRes.data ?? []) {
    if (!answersByQuestion[a.question_id]) answersByQuestion[a.question_id] = [];
    answersByQuestion[a.question_id]!.push(a);
  }

  return NextResponse.json({
    poll: pollRes.data,
    questions: (questionsRes.data ?? []).map((q) => ({
      ...q,
      answers: answersByQuestion[q.id] ?? [],
    })),
    response_count: total,
    complete_count: complete,
    completion_rate: total > 0 ? Math.round((complete / total) * 100) : 0,
    responses,
    verified_insight: insightRes.data ?? null,
    review_notes: notesRes.data ?? [],
  });
}
