import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { PollStatusActions } from "@/components/polls/PollStatusActions";
import { AddReviewNote } from "@/components/polls/AddReviewNote";
import { VerifiedInsightForm } from "@/components/polls/VerifiedInsightForm";
import type { PollStatus } from "@/types";
import { ArrowLeft, Download } from "lucide-react";

const STATUS_VARIANT: Record<PollStatus, "default" | "secondary" | "success" | "warning" | "outline"> = {
  draft: "secondary", live: "success", closed: "warning", verified: "default",
};

async function getPollDetail(id: string) {
  const [pollRes, questionsRes, responsesRes, insightRes, notesRes] = await Promise.all([
    supabase.from("polls").select("*").eq("id", id).single(),
    supabase.from("poll_questions").select("*").eq("poll_id", id).order("sort_order"),
    supabase.from("poll_responses").select("id, user_address, wallet_age_days, city, is_complete, quality_flag, started_at, completed_at").eq("poll_id", id).order("started_at", { ascending: false }),
    supabase.from("verified_insights").select("*").eq("poll_id", id).maybeSingle(),
    supabase.from("insight_review_notes").select("id, note, created_at, admin_users(name, email)").eq("poll_id", id).order("created_at", { ascending: false }),
  ]);

  if (!pollRes.data) return null;

  const responses = responsesRes.data ?? [];
  const total = responses.length;
  const complete = responses.filter((r) => r.is_complete).length;
  const questions = questionsRes.data ?? [];
  const qIds = questions.map((q) => q.id);

  const answersRes = await supabase
    .from("poll_response_answers")
    .select("question_id, selected_options, rating_value, free_text")
    .in("question_id", qIds);

  const answersByQ: Record<string, (typeof answersRes.data)[number][]> = {};
  for (const a of answersRes.data ?? []) {
    if (!answersByQ[a.question_id]) answersByQ[a.question_id] = [];
    answersByQ[a.question_id].push(a);
  }

  return {
    poll: pollRes.data,
    questions: questions.map((q) => ({ ...q, answers: answersByQ[q.id] ?? [] })),
    responses,
    total,
    complete,
    completion_rate: total > 0 ? Math.round((complete / total) * 100) : 0,
    verified_insight: insightRes.data ?? null,
    review_notes: notesRes.data ?? [],
  };
}

export default async function PollDetailPage({ params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.read");
  if (!session) redirect("/login");

  const detail = await getPollDetail(params.id);
  if (!detail) notFound();

  const { poll, questions, responses, total, complete, completion_rate, verified_insight, review_notes } = detail;

  return (
    <div>
      <TopBar
        title={poll.title}
        subtitle={`Poll · ${poll.status}`}
        actions={
          <a
            href={`/api/admin/polls/${params.id}/export`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </a>
        }
      />

      <div className="p-6 space-y-6">
        <Link href="/insights/polls" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to polls
        </Link>

        <div className="grid gap-4 sm:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Status</CardTitle></CardHeader><CardContent><Badge variant={STATUS_VARIANT[poll.status as PollStatus]}>{poll.status}</Badge></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Responses</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(total)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Completion Rate</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{completion_rate}%</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Completed</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(complete)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Status Controls</CardTitle></CardHeader>
          <CardContent>
            <PollStatusActions pollId={params.id} currentStatus={poll.status as PollStatus} canWrite={true} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Questions & Responses</h2>
          {questions.map((q, i) => (
            <Card key={q.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Q{i + 1}: {q.question_text}
                  <span className="ml-2 text-xs font-normal text-slate-400">{q.question_type}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {q.question_type === "free_text" ? (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {q.answers.filter((a: { free_text: string | null }) => a.free_text).map((a: { free_text: string | null }, j: number) => (
                      <p key={j} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-700">{a.free_text}</p>
                    ))}
                    {q.answers.filter((a: { free_text: string | null }) => a.free_text).length === 0 && <p className="text-sm text-slate-400">No text responses.</p>}
                  </div>
                ) : q.question_type === "rating" ? (
                  <div className="flex gap-4">
                    {[1, 2, 3, 4, 5].map((v) => {
                      const count = q.answers.filter((a: { rating_value: number | null }) => a.rating_value === v).length;
                      return (
                        <div key={v} className="text-center">
                          <p className="text-lg font-bold text-slate-900">{count}</p>
                          <p className="text-xs text-slate-400">{v} ★</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(q.options ?? []).map((opt: string) => {
                      const count = q.answers.filter((a: { selected_options: string[] | null }) => (a.selected_options ?? []).includes(opt)).length;
                      const pct = q.answers.length > 0 ? Math.round((count / q.answers.length) * 100) : 0;
                      return (
                        <div key={opt} className="flex items-center gap-3">
                          <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2">
                            <div className="h-2 rounded-full bg-[#238D9D]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
                          <span className="text-sm text-slate-700">{opt}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {responses.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Top Cities</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(responses.reduce<Record<string, number>>((acc, r) => { const c = r.city ?? "Unknown"; acc[c] = (acc[c] ?? 0) + 1; return acc; }, {}))
                  .sort((a, b) => b[1] - a[1]).slice(0, 10)
                  .map(([city, count]) => (
                    <span key={city} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">{city} <span className="text-slate-400">({count})</span></span>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Verified Insight</CardTitle></CardHeader>
          <CardContent>
            <VerifiedInsightForm pollId={params.id} existing={verified_insight} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Review Notes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {review_notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {(review_notes as Array<{ id: string; note: string; created_at: string; admin_users?: { name: string | null; email: string } | null }>).map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-sm text-slate-700">{note.note}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {note.admin_users?.name ?? note.admin_users?.email ?? "Unknown"} · {formatDateTime(note.created_at)}
                </p>
              </div>
            ))}
            <AddReviewNote pollId={params.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
