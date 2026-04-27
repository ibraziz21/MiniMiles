import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type RawAnswerRow = {
  id: string;
  response_id: string;
  question_id: string;
  selected_option_id: string | null;
  text_answer: string | null;
  created_at: string;
};

async function fetchAllAnswersByQuestionIds(questionIds: string[]): Promise<RawAnswerRow[]> {
  const pageSize = 1000;
  const rows: RawAnswerRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("poll_response_answers")
      .select("id, response_id, question_id, selected_option_id, text_answer, created_at")
      .in("question_id", questionIds)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as RawAnswerRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

// GET /api/admin/polls/[id] — raw poll detail with real response/answer schema
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [pollRes, questionsRes, responsesRes, insightRes] = await Promise.all([
    supabase.from("polls").select("*").eq("id", params.id).single(),
    supabase
      .from("poll_questions")
      .select("id, poll_id, position, question, kind, required, max_choices")
      .eq("poll_id", params.id)
      .order("position"),
    supabase
      .from("poll_responses")
      .select("id, poll_id, wallet_address, reward_queued, reward_points_awarded, verification_source, trait_verification_status, submitted_at, accepted_terms, terms_version, accepted_terms_at")
      .eq("poll_id", params.id)
      .order("submitted_at", { ascending: false }),
    supabase.from("verified_insights").select("*").eq("poll_id", params.id).maybeSingle(),
  ]);

  if (!pollRes.data) return NextResponse.json({ error: "Poll not found" }, { status: 404 });

  const questions = questionsRes.data ?? [];
  const questionIds = questions.map((q) => q.id);

  const [optionsRes, rawAnswers] = await Promise.all([
    questionIds.length
      ? supabase.from("poll_options").select("id, question_id, position, label").in("question_id", questionIds).order("position")
      : Promise.resolve({ data: [] }),
    questionIds.length ? fetchAllAnswersByQuestionIds(questionIds) : Promise.resolve([]),
  ]);

  const optionMap = new Map((optionsRes.data ?? []).map((option) => [option.id, option]));
  const answers = rawAnswers.map((answer) => ({
    ...answer,
    option_label: answer.selected_option_id ? optionMap.get(answer.selected_option_id)?.label ?? null : null,
  }));

  const answersByQuestion: Record<string, typeof answers> = {};
  for (const answer of answers) {
    answersByQuestion[answer.question_id] = [...(answersByQuestion[answer.question_id] ?? []), answer];
  }

  const optionsByQuestion: Record<string, typeof optionsRes.data> = {};
  for (const option of optionsRes.data ?? []) {
    optionsByQuestion[option.question_id] = [...(optionsByQuestion[option.question_id] ?? []), option];
  }

  return NextResponse.json({
    poll: pollRes.data,
    questions: questions.map((question) => ({
      ...question,
      options: optionsByQuestion[question.id] ?? [],
      answers: answersByQuestion[question.id] ?? [],
    })),
    response_count: responsesRes.data?.length ?? 0,
    responses: responsesRes.data ?? [],
    verified_insight: insightRes.data ?? null,
  });
}
