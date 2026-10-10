import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { DetailHeader } from "@/components/shell/DetailHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatNumber } from "@/lib/utils";
import { KeywordDrilldown } from "@/components/polls/KeywordDrilldown";
import type { PollStatus } from "@/types";
import { Download, ShieldCheck } from "lucide-react";

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
              <span className="text-sm font-medium text-ink">{row.label}</span>
              <span className="text-xs text-ink-muted">{row.count} selections</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
              <div className="h-full rounded-full bg-primary" style={{ width: `${row.pct}%` }} />
            </div>
          </div>
          <span className="text-right text-sm font-semibold text-ink">{row.pct}%</span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-ink-muted">No options configured for this question.</p>}
    </div>
  );
}

function TextAnswers({ question }: { question: QuestionAnalysis }) {
  const analysis = analyzeFreeText(question);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-card bg-surface-subtle px-3 py-2">
          <p className="text-lg font-semibold text-ink">{formatNumber(analysis.answers.length)}</p>
          <p className="text-xs text-ink-muted">Text answers</p>
        </div>
        <div className="rounded-card bg-surface-subtle px-3 py-2">
          <p className="text-lg font-semibold text-ink">{formatNumber(analysis.uniqueCount)}</p>
          <p className="text-xs text-ink-muted">Unique normalized answers</p>
        </div>
        <div className="rounded-card bg-surface-subtle px-3 py-2">
          <p className="text-lg font-semibold text-ink">{analysis.averageWords}</p>
          <p className="text-xs text-ink-muted">Avg. words</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Detected Themes</p>
          <div className="space-y-2">
            {analysis.themes.map(([theme, count]) => {
              const pct = analysis.answers.length > 0 ? Math.round((count / analysis.answers.length) * 100) : 0;
              return (
                <div key={theme} className="grid grid-cols-[1fr_56px] items-center gap-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-ink">{theme}</span>
                      <span className="text-xs text-ink-muted">{count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-right text-sm font-semibold text-ink">{pct}%</span>
                </div>
              );
            })}
            {analysis.themes.length === 0 && <p className="text-sm text-ink-muted">No strong themes detected.</p>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Repeated Phrases</p>
          <div className="space-y-2">
            {analysis.repeatedPhrases.map((phrase) => (
              <div key={phrase.display} className="flex items-start justify-between gap-3 rounded-card bg-surface-subtle px-3 py-2">
                <span className="text-sm text-ink">{phrase.display}</span>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-border">
                  {phrase.count}
                </span>
              </div>
            ))}
            {analysis.repeatedPhrases.length === 0 && <p className="text-sm text-ink-muted">No repeated phrases yet.</p>}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Representative Longer Answers</p>
        <div className="max-h-72 overflow-y-auto space-y-2">
          {analysis.representative.map((answer) => (
            <p key={answer} className="rounded-card bg-surface-subtle px-3 py-2 text-sm text-ink">
              {answer}
            </p>
          ))}
          {analysis.representative.length === 0 && <p className="text-sm text-ink-muted">No text responses.</p>}
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
      <PageHeader title={poll.title} subtitle={`Poll analysis · ${poll.status}`} />

      <div className="p-4 sm:p-6 space-y-6">
        <DetailHeader
          backHref="/insights/polls"
          backLabel="Back to polls"
          title={poll.title}
          badges={<Badge variant={STATUS_VARIANT[poll.status]}>{poll.status}</Badge>}
          actions={
            <a
              href={`/api/admin/polls/${params.id}/export`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-card border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-subtle transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Responses" value={formatNumber(total)} />
          <MetricCard label="Terms Accepted" value={formatNumber(acceptedTerms)} />
          <MetricCard label="Rewards Queued" value={formatNumber(rewardQueued)} />
          <MetricCard label="Miles Awarded" value={formatNumber(totalRewardPoints)} />
        </div>

        {verified_insight && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-ink">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Saved Verified Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-ink">{verified_insight.summary}</p>
              {Array.isArray(verified_insight.key_findings) && verified_insight.key_findings.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {verified_insight.key_findings.map((finding: string) => (
                    <span key={finding} className="rounded-full bg-white px-3 py-1 text-xs text-ink ring-1 ring-primary/10">{finding}</span>
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
                  <span className="text-ink-muted">{label}</span>
                  <span className="font-medium text-ink">{count}</span>
                </div>
              ))}
              {countryBreakdown.length === 0 && <p className="text-sm text-ink-muted">No country question found.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Age Group</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {ageBreakdown.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted">{label}</span>
                  <span className="font-medium text-ink">{count}</span>
                </div>
              ))}
              {ageBreakdown.length === 0 && <p className="text-sm text-ink-muted">No age question found.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Verification</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">verified traits</span>
                <span className="font-medium text-ink">{verifiedTraits}</span>
              </div>
              {qualityBreakdown.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted">{label}</span>
                  <span className="font-medium text-ink">{count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">Question Analysis</h2>
          {questions.map((question) => (
            <Card key={question.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <CardTitle className="text-sm">
                    Q{question.position}: {question.question}
                    <span className="ml-2 text-xs font-normal text-ink-muted">{question.kind}</span>
                  </CardTitle>
                  <span className="shrink-0 text-xs text-ink-muted">{formatNumber(question.answers.length)} answers</span>
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
            {responses.length === 0 ? (
              <EmptyState message="No responses yet." isHealthy={false} />
            ) : (
              <>
                {/* Mobile: cards */}
                <div className="max-h-96 space-y-2 overflow-y-auto lg:hidden">
                  {responses.map((response) => (
                    <div key={response.id} className="rounded-card border border-border p-3">
                      <p className="font-mono text-xs text-ink-muted">{response.wallet_address}</p>
                      <p className="mt-1 text-sm text-ink">
                        {response.reward_queued ? "queued" : "not queued"} · {response.reward_points_awarded ?? 0} Miles
                      </p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-xs text-ink-muted">{response.trait_verification_status ?? "—"} · {formatDate(response.submitted_at)}</span>
                        {response.accepted_terms ? <Badge variant="success">accepted</Badge> : <Badge variant="warning">missing</Badge>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden max-h-96 overflow-auto rounded-card border border-border lg:block">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-subtle text-xs uppercase tracking-wider text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 text-left">Wallet</th>
                        <th className="px-3 py-2 text-left">Reward</th>
                        <th className="px-3 py-2 text-left">Verification</th>
                        <th className="px-3 py-2 text-left">Terms</th>
                        <th className="px-3 py-2 text-left">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {responses.map((response) => (
                        <tr key={response.id}>
                          <td className="px-3 py-2 font-mono text-xs text-ink-muted">{response.wallet_address}</td>
                          <td className="px-3 py-2 text-ink-muted">{response.reward_queued ? "queued" : "not queued"} · {response.reward_points_awarded ?? 0} Miles</td>
                          <td className="px-3 py-2 text-ink-muted">{response.trait_verification_status ?? "—"}</td>
                          <td className="px-3 py-2">{response.accepted_terms ? <Badge variant="success">accepted</Badge> : <Badge variant="warning">missing</Badge>}</td>
                          <td className="px-3 py-2 text-ink-muted">{formatDate(response.submitted_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
