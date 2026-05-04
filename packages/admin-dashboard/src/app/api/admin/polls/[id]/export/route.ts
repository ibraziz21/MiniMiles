import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

type RawAnswerRow = {
  response_id: string;
  question_id: string;
  selected_option_id: string | null;
  text_answer: string | null;
};

async function fetchAllAnswersByResponseIds(responseIds: string[]): Promise<RawAnswerRow[]> {
  const pageSize = 1000;
  const rows: RawAnswerRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("poll_response_answers")
      .select("response_id, question_id, selected_option_id, text_answer")
      .in("response_id", responseIds)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as RawAnswerRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

// GET /api/admin/polls/[id]/export — CSV export of all responses + answers
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [pollRes, questionsRes, responsesRes] = await Promise.all([
    supabase.from("polls").select("title").eq("id", params.id).single(),
    supabase.from("poll_questions").select("id, position, question, kind").eq("poll_id", params.id).order("position"),
    supabase
      .from("poll_responses")
      .select("id, wallet_address, reward_queued, reward_points_awarded, verification_source, trait_verification_status, submitted_at, accepted_terms, terms_version")
      .eq("poll_id", params.id),
  ]);

  if (!pollRes.data) return NextResponse.json({ error: "Poll not found" }, { status: 404 });

  const questions = questionsRes.data ?? [];
  const responses = responsesRes.data ?? [];
  const responseIds = responses.map((r) => r.id);

  const [answers, optionsRes] = await Promise.all([
    responseIds.length ? fetchAllAnswersByResponseIds(responseIds) : Promise.resolve([]),
    questions.length
      ? supabase.from("poll_options").select("id, label")
      : Promise.resolve({ data: [] }),
  ]);

  const optionMap = new Map((optionsRes.data ?? []).map((option) => [option.id, option.label]));
  const answerMap: Record<string, Record<string, string>> = {};
  for (const a of answers) {
    if (!answerMap[a.response_id]) answerMap[a.response_id] = {};
    const val = a.text_answer ?? (a.selected_option_id ? optionMap.get(a.selected_option_id) ?? a.selected_option_id : "");
    answerMap[a.response_id][a.question_id] = answerMap[a.response_id][a.question_id]
      ? `${answerMap[a.response_id][a.question_id]}; ${val}`
      : val;
  }

  const headers = [
    "response_id",
    "wallet_address",
    "reward_queued",
    "reward_points_awarded",
    "verification_source",
    "trait_verification_status",
    "submitted_at",
    "accepted_terms",
    "terms_version",
    ...questions.map((q) => `Q${q.position}: ${q.question.replace(/,/g, ";")}`.slice(0, 100)),
  ];

  const rows = responses.map((r) => [
    r.id,
    r.wallet_address,
    r.reward_queued ? "1" : "0",
    r.reward_points_awarded ?? "",
    r.verification_source ?? "",
    r.trait_verification_status ?? "",
    r.submitted_at,
    r.accepted_terms ? "1" : "0",
    r.terms_version ?? "",
    ...questions.map((q) => (answerMap[r.id]?.[q.id] ?? "").replace(/,/g, ";")),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");

  void writeAdminAuditLog({ adminUserId: adminIdForWrite(session), action: "poll.export_csv", targetType: "poll", targetId: params.id });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="poll-${params.id}-responses.csv"`,
    },
  });
}
