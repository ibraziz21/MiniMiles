import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import { KeywordDrilldown } from "@/components/polls/KeywordDrilldown";
import type { PollStatus } from "@/types";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";

type PollRow = {
  id: string;
  title: string;
  description: string | null;
  status: PollStatus;
  created_at: string;
};

type QuestionKind = "single_choice" | "multi_select" | "short_text";

type QuestionRow = {
  id: string;
  poll_id: string;
  position: number;
  question: string;
  kind: QuestionKind;
  required: boolean;
  max_choices: number | null;
};

type OptionRow = {
  id: string;
  question_id: string;
  position: number;
  label: string;
};

type ResponseRow = {
  id: string;
  poll_id: string;
  wallet_address: string;
  reward_queued: boolean | null;
  reward_points_awarded: number | null;
  verification_source: string | null;
  trait_verification_status: string | null;
  submitted_at: string;
  accepted_terms: boolean | null;
  terms_version: string | null;
  accepted_terms_at: string | null;
};

type AnswerRow = {
  id: string;
  response_id: string;
  question_id: string;
  selected_option_id: string | null;
  text_answer: string | null;
  created_at: string;
  option_label: string | null;
};

type RawAnswerRow = Omit<AnswerRow, "option_label">;

type QuestionAnalysis = QuestionRow & {
  options: OptionRow[];
  answers: AnswerRow[];
};

const STATUS_VARIANT: Record<PollStatus, "default" | "secondary" | "success" | "warning" | "outline"> = {
  draft: "secondary",
  live: "success",
  closed: "warning",
  verified: "default",
};

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item) || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function textKeywords(questions: QuestionAnalysis[]) {
  const stop = new Set([
    "the", "and", "for", "that", "this", "with", "from", "you", "are", "not",
    "but", "have", "they", "was", "were", "will", "would", "can", "could",
    "too", "very", "just", "more", "less", "when", "what", "why", "how",
  ]);
  const hits: Record<string, { count: number; answers: Set<string> }> = {};
  for (const q of questions) {
    if (q.kind !== "short_text") continue;
    for (const answer of q.answers) {
      const text = answer.text_answer?.trim();
      if (!text) continue;
      for (const word of text.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []) {
        if (stop.has(word)) continue;
        hits[word] ??= { count: 0, answers: new Set<string>() };
        hits[word].count += 1;
        hits[word].answers.add(text);
      }
    }
  }
  return Object.entries(hits)
    .map(([word, hit]) => ({ word, count: hit.count, answers: Array.from(hit.answers).slice(0, 50) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

const FREE_TEXT_THEMES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Trust / reliability", pattern: /\b(trust|trusted|reliable|reliability|legit|scam|safe|safety|secure|security|proof|verify|verified)\b/i },
  { label: "Voucher value", pattern: /\b(discount|voucher|offer|offers|free|cheap|price|prices|cost|value|worth|affordable|expensive)\b/i },
  { label: "Merchant choice", pattern: /\b(merchant|shop|store|partner|partners|restaurant|food|supermarket|electronics|category|categories)\b/i },
  { label: "Delivery / logistics", pattern: /\b(delivery|deliver|pickup|location|near|distance|fee|shipping|rider|transport)\b/i },
  { label: "Rewards / Miles", pattern: /\b(reward|rewards|miles|points|earn|earning|claim|bonus|cashback)\b/i },
  { label: "Games", pattern: /\b(game|games|dice|claw|play|playing|win|winner|prize|prediction)\b/i },
  { label: "App / UX", pattern: /\b(app|ui|ux|interface|easy|simple|smooth|fast|slow|bug|bugs|loading|confusing)\b/i },
  { label: "Payments / cash", pattern: /\b(pay|payment|cash|mpesa|m-pesa|mobile money|celo|cusd|usdt|wallet|withdraw)\b/i },
  { label: "Referrals / growth", pattern: /\b(invite|friend|friends|referral|refer|share|social|community)\b/i },
];

function normalizeFreeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function analyzeFreeText(question: QuestionAnalysis) {
  const answers = question.answers
    .map((answer) => answer.text_answer?.trim() ?? "")
    .filter(Boolean);

  const phraseCounts: Record<string, { display: string; count: number }> = {};
  const themeCounts: Record<string, number> = {};
  let totalWords = 0;

  for (const answer of answers) {
    const normalized = normalizeFreeText(answer);
    if (normalized) {
      const current = phraseCounts[normalized];
      phraseCounts[normalized] = {
        display: current?.display ?? sentenceCase(answer),
        count: (current?.count ?? 0) + 1,
      };
    }

    totalWords += answer.split(/\s+/).filter(Boolean).length;

    for (const theme of FREE_TEXT_THEMES) {
      if (theme.pattern.test(answer)) {
        themeCounts[theme.label] = (themeCounts[theme.label] ?? 0) + 1;
      }
    }
  }

  const repeatedPhrases = Object.values(phraseCounts)
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const themes = Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const representative = [...answers]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);

  return {
    answers,
    uniqueCount: Object.keys(phraseCounts).length,
    averageWords: answers.length > 0 ? Math.round(totalWords / answers.length) : 0,
    repeatedPhrases,
    themes,
    representative,
  };
}

function choiceValueByQuestion(questions: QuestionAnalysis[], match: RegExp) {
  const question = questions.find((q) => match.test(q.question));
  if (!question) return [];
  return countBy(question.answers, (answer) => answer.option_label ?? answer.text_answer).slice(0, 8);
}

async function getPollDetail(id: string) {
  const [pollRes, questionsRes, responsesRes, insightRes] = await Promise.all([
    supabase.from("polls").select("id, title, description, status, created_at").eq("id", id).single(),
    supabase.from("poll_questions").select("id, poll_id, position, question, kind, required, max_choices").eq("poll_id", id).order("position"),
    supabase
      .from("poll_responses")
      .select("id, poll_id, wallet_address, reward_queued, reward_points_awarded, verification_source, trait_verification_status, submitted_at, accepted_terms, terms_version, accepted_terms_at")
      .eq("poll_id", id)
      .order("submitted_at", { ascending: false }),
    supabase.from("verified_insights").select("*").eq("poll_id", id).maybeSingle(),
  ]);

  if (!pollRes.data) return null;

  const poll = pollRes.data as PollRow;
  const questions = (questionsRes.data ?? []) as QuestionRow[];
  const responses = (responsesRes.data ?? []) as ResponseRow[];
  const questionIds = questions.map((q) => q.id);

  const [optionsRes, rawAnswers] = await Promise.all([
    questionIds.length
      ? supabase.from("poll_options").select("id, question_id, position, label").in("question_id", questionIds).order("position")
      : Promise.resolve({ data: [] as OptionRow[] }),
    questionIds.length ? fetchAllAnswersByQuestionIds(questionIds) : Promise.resolve([]),
  ]);

  const options = (optionsRes.data ?? []) as OptionRow[];
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const enrichedAnswers = rawAnswers.map((answer) => ({
    ...answer,
    option_label: answer.selected_option_id ? optionMap.get(answer.selected_option_id)?.label ?? null : null,
  }));

  const optionsByQuestion: Record<string, OptionRow[]> = {};
  for (const option of options) {
    optionsByQuestion[option.question_id] = [...(optionsByQuestion[option.question_id] ?? []), option];
  }

  const answersByQuestion: Record<string, AnswerRow[]> = {};
  for (const answer of enrichedAnswers) {
    answersByQuestion[answer.question_id] = [...(answersByQuestion[answer.question_id] ?? []), answer];
  }

  return {
    poll,
    questions: questions.map((question) => ({
      ...question,
      options: optionsByQuestion[question.id] ?? [],
      answers: answersByQuestion[question.id] ?? [],
    })),
    responses,
    verified_insight: insightRes.data ?? null,
  };
}

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

function OptionBreakdown({ question, totalResponses }: { question: QuestionAnalysis; totalResponses: number }) {
  const denominator = Math.max(totalResponses, 1);
  const rows = question.options.map((option) => {
    const count = question.answers.filter((answer) => answer.selected_option_id === option.id).length;
    return { label: option.label, count, pct: Math.round((count / denominator) * 100) };
  }).sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[1fr_72px] items-center gap-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700">{row.label}</span>
              <span className="text-xs text-slate-400">{row.count} selections</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#238D9D]" style={{ width: `${row.pct}%` }} />
            </div>
          </div>
          <span className="text-right text-sm font-semibold text-slate-900">{row.pct}%</span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-slate-400">No options configured for this question.</p>}
    </div>
  );
}

function TextAnswers({ question }: { question: QuestionAnalysis }) {
  const analysis = analyzeFreeText(question);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-lg font-semibold text-slate-950">{formatNumber(analysis.answers.length)}</p>
          <p className="text-xs text-slate-500">Text answers</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-lg font-semibold text-slate-950">{formatNumber(analysis.uniqueCount)}</p>
          <p className="text-xs text-slate-500">Unique normalized answers</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-lg font-semibold text-slate-950">{analysis.averageWords}</p>
          <p className="text-xs text-slate-500">Avg. words</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Detected Themes</p>
          <div className="space-y-2">
            {analysis.themes.map(([theme, count]) => {
              const pct = analysis.answers.length > 0 ? Math.round((count / analysis.answers.length) * 100) : 0;
              return (
                <div key={theme} className="grid grid-cols-[1fr_56px] items-center gap-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-700">{theme}</span>
                      <span className="text-xs text-slate-400">{count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-[#238D9D]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-right text-sm font-semibold text-slate-900">{pct}%</span>
                </div>
              );
            })}
            {analysis.themes.length === 0 && <p className="text-sm text-slate-400">No strong themes detected.</p>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Repeated Phrases</p>
          <div className="space-y-2">
            {analysis.repeatedPhrases.map((phrase) => (
              <div key={phrase.display} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-700">{phrase.display}</span>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                  {phrase.count}
                </span>
              </div>
            ))}
            {analysis.repeatedPhrases.length === 0 && <p className="text-sm text-slate-400">No repeated phrases yet.</p>}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Representative Longer Answers</p>
        <div className="max-h-72 overflow-y-auto space-y-2">
          {analysis.representative.map((answer) => (
            <p key={answer} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {answer}
            </p>
          ))}
          {analysis.representative.length === 0 && <p className="text-sm text-slate-400">No text responses.</p>}
        </div>
      </div>
    </div>
  );
}

export default async function PollDetailPage({ params }: { params: { id: string } }) {
  const session = await requireAdminSession("polls.read");
  if (!session) redirect("/login");

  const detail = await getPollDetail(params.id);
  if (!detail) notFound();

  const { poll, questions, responses, verified_insight } = detail;
  const total = responses.length;
  const acceptedTerms = responses.filter((r) => r.accepted_terms).length;
  const rewardQueued = responses.filter((r) => r.reward_queued).length;
  const totalRewardPoints = responses.reduce((sum, r) => sum + (r.reward_points_awarded ?? 0), 0);
  const verifiedTraits = responses.filter((r) => r.trait_verification_status === "verified").length;
  const ageBreakdown = choiceValueByQuestion(questions, /age group/i);
  const countryBreakdown = choiceValueByQuestion(questions, /country/i);
  const qualityBreakdown = countBy(responses, (r) => r.trait_verification_status ?? "unverified").slice(0, 8);
  const keywords = textKeywords(questions);

  return (
    <div>
      <TopBar
        title={poll.title}
        subtitle={`Poll analysis · ${poll.status}`}
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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Status</CardTitle></CardHeader><CardContent><Badge variant={STATUS_VARIANT[poll.status]}>{poll.status}</Badge></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Responses</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(total)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Terms Accepted</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(acceptedTerms)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Rewards Queued</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(rewardQueued)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Miles Awarded</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(totalRewardPoints)}</p></CardContent></Card>
        </div>

        {verified_insight && (
          <Card className="border-[#238D9D]/20 bg-[#238D9D]/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-900">
                <ShieldCheck className="h-4 w-4 text-[#238D9D]" />
                Saved Verified Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-slate-700">{verified_insight.summary}</p>
              {Array.isArray(verified_insight.key_findings) && verified_insight.key_findings.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {verified_insight.key_findings.map((finding: string) => (
                    <span key={finding} className="rounded-full bg-white px-3 py-1 text-xs text-slate-700 ring-1 ring-[#238D9D]/10">{finding}</span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Country</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {countryBreakdown.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-medium text-slate-900">{count}</span>
                </div>
              ))}
              {countryBreakdown.length === 0 && <p className="text-sm text-slate-400">No country question found.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Age Group</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {ageBreakdown.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-medium text-slate-900">{count}</span>
                </div>
              ))}
              {ageBreakdown.length === 0 && <p className="text-sm text-slate-400">No age question found.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Verification</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">verified traits</span>
                <span className="font-medium text-slate-900">{verifiedTraits}</span>
              </div>
              {qualityBreakdown.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-medium text-slate-900">{count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Question Analysis</h2>
          {questions.map((question) => (
            <Card key={question.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <CardTitle className="text-sm">
                    Q{question.position}: {question.question}
                    <span className="ml-2 text-xs font-normal text-slate-400">{question.kind}</span>
                  </CardTitle>
                  <span className="shrink-0 text-xs text-slate-400">{formatNumber(question.answers.length)} answers</span>
                </div>
              </CardHeader>
              <CardContent>
                {question.kind === "short_text" ? (
                  <TextAnswers question={question} />
                ) : (
                  <OptionBreakdown question={question} totalResponses={total} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {keywords.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Free-text Keywords</CardTitle></CardHeader>
            <CardContent>
              <KeywordDrilldown keywords={keywords} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Raw Response Index</CardTitle></CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Wallet</th>
                    <th className="px-3 py-2 text-left">Reward</th>
                    <th className="px-3 py-2 text-left">Verification</th>
                    <th className="px-3 py-2 text-left">Terms</th>
                    <th className="px-3 py-2 text-left">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {responses.map((response) => (
                    <tr key={response.id}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{response.wallet_address}</td>
                      <td className="px-3 py-2 text-slate-600">{response.reward_queued ? "queued" : "not queued"} · {response.reward_points_awarded ?? 0} Miles</td>
                      <td className="px-3 py-2 text-slate-600">{response.trait_verification_status ?? "—"}</td>
                      <td className="px-3 py-2">{response.accepted_terms ? <Badge variant="success">accepted</Badge> : <Badge variant="warning">missing</Badge>}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(response.submitted_at)}</td>
                    </tr>
                  ))}
                  {responses.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No responses yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
