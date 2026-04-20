"use client";

import React, { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { akibaMilesSymbol } from "@/lib/svg";
import { CheckCircle2, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import Link from "next/link";
import {
  POLL_TERMS_VERSION,
  type PollSummary,
  type PollQuestion,
  type PollAnswerPayload,
  type PollSubmitResponse,
} from "@/types/polls";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PollSheetProps {
  pollId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (rewardPoints: number) => void;
}

type AnswerState = Record<
  string,
  { selected_option_ids: string[]; text_answer: string }
>;

type Step = "intro" | "questions" | "review" | "done";

// ── sessionStorage draft helpers ─────────────────────────────────────────────

function draftKey(pollId: string) {
  return `poll_draft_${pollId}`;
}

function saveDraft(pollId: string, answers: AnswerState, currentIndex: number) {
  try {
    sessionStorage.setItem(draftKey(pollId), JSON.stringify({ answers, currentIndex }));
  } catch {
    // sessionStorage unavailable (e.g. private browsing quota) — silently skip
  }
}

function loadDraft(pollId: string): { answers: AnswerState; currentIndex: number } | null {
  try {
    const raw = sessionStorage.getItem(draftKey(pollId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft(pollId: string) {
  try {
    sessionStorage.removeItem(draftKey(pollId));
  } catch {
    // ignore
  }
}

// ── Logic helpers ─────────────────────────────────────────────────────────────

function buildPayload(questions: PollQuestion[], answers: AnswerState): PollAnswerPayload[] {
  return questions.map((q) => {
    const a = answers[q.id] ?? { selected_option_ids: [], text_answer: "" };
    if (q.kind === "short_text") return { question_id: q.id, text_answer: a.text_answer };
    return { question_id: q.id, selected_option_ids: a.selected_option_ids };
  });
}

function isQuestionAnswered(q: PollQuestion, answers: AnswerState): boolean {
  if (!q.required) return true;
  const a = answers[q.id];
  if (!a) return false;
  if (q.kind === "short_text") return a.text_answer.trim().length > 0;
  return a.selected_option_ids.length > 0;
}

function allAnswered(questions: PollQuestion[], answers: AnswerState): boolean {
  return questions.every((q) => isQuestionAnswered(q, answers));
}

function summariseAnswer(q: PollQuestion, answers: AnswerState): string {
  const a = answers[q.id];
  if (!a) return "—";
  if (q.kind === "short_text") return a.text_answer.trim() || "—";
  const labels = a.selected_option_ids
    .map((id) => q.options.find((o) => o.id === id)?.label)
    .filter(Boolean)
    .join(", ");
  return labels || "—";
}

// ── Option input components ───────────────────────────────────────────────────

function SingleChoice({
  question,
  selected,
  onChange,
}: {
  question: PollQuestion;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-2.5">
      {question.options.map((opt) => {
        const checked = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange([opt.id])}
            className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm font-medium transition-all duration-150 ${
              checked
                ? "border-[#238D9D] bg-[#E6FAFA] text-[#1b6b76] shadow-sm"
                : "border-gray-100 bg-gray-50 text-gray-700 hover:border-[#238D9D]/40 hover:bg-[#f0fafa]"
            }`}
          >
            <span
              className={`h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                checked ? "border-[#238D9D] bg-[#238D9D]" : "border-gray-300"
              }`}
            >
              {checked && <span className="h-2 w-2 rounded-full bg-white" />}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelect({
  question,
  selected,
  onChange,
}: {
  question: PollQuestion;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      const max = question.max_choices;
      if (max && selected.length >= max) return;
      onChange([...selected, id]);
    }
  };

  const max = question.max_choices;
  const full = !!max && selected.length >= max;

  return (
    <div className="space-y-2.5">
      {max && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-400">Pick up to {max}</span>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              full ? "bg-[#238D9D] text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {selected.length}/{max}
          </span>
        </div>
      )}
      {question.options.map((opt) => {
        const checked = selected.includes(opt.id);
        const disabled = !checked && full;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle(opt.id)}
            disabled={disabled}
            className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm font-medium transition-all duration-150 disabled:opacity-40 ${
              checked
                ? "border-[#238D9D] bg-[#E6FAFA] text-[#1b6b76] shadow-sm"
                : "border-gray-100 bg-gray-50 text-gray-700 hover:border-[#238D9D]/40 hover:bg-[#f0fafa]"
            }`}
          >
            <span
              className={`h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                checked ? "border-[#238D9D] bg-[#238D9D]" : "border-gray-300"
              }`}
            >
              {checked && (
                <svg viewBox="0 0 10 8" fill="none" className="h-3 w-3 text-white">
                  <path
                    d="M1 4l3 3 5-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ShortText({
  question,
  value,
  onChange,
}: {
  question: PollQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const max = 500;
  return (
    <div className="relative">
      <textarea
        className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3 text-base resize-none focus:outline-none focus:ring-0 focus:border-[#238D9D] placeholder-gray-400 transition-colors"
        rows={4}
        placeholder="Type your answer…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
      />
      <span className="absolute bottom-3 right-4 text-[10px] text-gray-300">
        {value.length}/{max}
      </span>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  current,
  total,
  answered,
}: {
  current: number;
  total: number;
  answered: boolean;
}) {
  const pct = total === 0 ? 0 : Math.round(((current + (answered ? 1 : 0)) / total) * 100);

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-400 font-medium">
          Question {current + 1} of {total}
        </span>
        <span className="text-xs font-semibold text-[#238D9D]">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#238D9D] to-[#24E5E0] transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-1.5 justify-center mt-2">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`rounded-full transition-all duration-300 ${
              i < current
                ? "h-1.5 w-4 bg-[#238D9D]"
                : i === current
                ? "h-1.5 w-4 bg-[#24E5E0]"
                : "h-1.5 w-1.5 bg-gray-200"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Slide animation wrapper ───────────────────────────────────────────────────

function QuestionSlide({
  question,
  answers,
  onAnswer,
  direction,
}: {
  question: PollQuestion;
  answers: AnswerState;
  onAnswer: (qId: string, update: Partial<AnswerState[string]>) => void;
  direction: "forward" | "backward";
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(id);
  }, []);

  const enter = direction === "forward" ? "translate-x-8" : "-translate-x-8";

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        visible ? "opacity-100 translate-x-0" : `opacity-0 ${enter}`
      }`}
    >
      <p className="text-base font-semibold text-gray-900 mb-4 leading-snug">
        {question.question}
        {question.required && <span className="text-[#238D9D] ml-1">*</span>}
      </p>

      {question.kind === "single_choice" && (
        <SingleChoice
          question={question}
          selected={answers[question.id]?.selected_option_ids ?? []}
          onChange={(ids) => onAnswer(question.id, { selected_option_ids: ids })}
        />
      )}
      {question.kind === "multi_select" && (
        <MultiSelect
          question={question}
          selected={answers[question.id]?.selected_option_ids ?? []}
          onChange={(ids) => onAnswer(question.id, { selected_option_ids: ids })}
        />
      )}
      {question.kind === "short_text" && (
        <ShortText
          question={question}
          value={answers[question.id]?.text_answer ?? ""}
          onChange={(v) => onAnswer(question.id, { text_answer: v })}
        />
      )}
    </div>
  );
}

// ── Review screen ─────────────────────────────────────────────────────────────

function ReviewScreen({
  questions,
  answers,
  acceptedTerms,
  error,
  onAcceptedTermsChange,
  onEdit,
}: {
  questions: PollQuestion[];
  answers: AnswerState;
  acceptedTerms: boolean;
  error: string | null;
  onAcceptedTermsChange: (accepted: boolean) => void;
  onEdit: (index: number) => void;
}) {
  return (
    <div className="px-4 pt-4 pb-2">
      <p className="text-sm text-gray-500 mb-4">
        Review your answers before submitting. Tap{" "}
        <Pencil className="inline h-3 w-3 text-[#238D9D]" /> to change any answer.
      </p>

      <div className="space-y-3 mb-4">
        {questions.map((q, idx) => {
          const summary = summariseAnswer(q, answers);
          const answered = isQuestionAnswered(q, answers);
          return (
            <div
              key={q.id}
              className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-gray-500 leading-snug flex-1">
                  <span className="text-[#238D9D] mr-1">{idx + 1}.</span>
                  {q.question}
                </p>
                <button
                  type="button"
                  onClick={() => onEdit(idx)}
                  className="shrink-0 p-1 rounded-lg hover:bg-[#E6FAFA] text-[#238D9D] transition-colors"
                  aria-label="Edit answer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
              <p
                className={`mt-1.5 text-sm font-medium ${
                  answered ? "text-gray-800" : "text-gray-400 italic"
                }`}
              >
                {summary}
              </p>
            </div>
          );
        })}
      </div>

      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#C8EEED] bg-[#F0FAF9] px-4 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#238D9D] focus:ring-[#238D9D]"
          checked={acceptedTerms}
          onChange={(e) => onAcceptedTermsChange(e.target.checked)}
        />
        <span className="text-xs leading-relaxed text-gray-600">
          I agree that Akiba may use my wallet-linked responses to improve products,
          rewards, games, and merchant partnerships, and may share aggregated insights
          with partners. Individual responses are not sold. Rewards may be withheld for
          abuse, duplicate submissions, or ineligible wallets.
        </span>
      </label>

      {error && (
        <p className="text-xs text-red-500 text-center mb-3">{error}</p>
      )}
    </div>
  );
}

// ── Done screen ───────────────────────────────────────────────────────────────

function DoneScreen({
  rewardPoints,
  onClose,
}: {
  rewardPoints: number;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-8 px-5 text-center space-y-5">
      {/* animated ring */}
      <div className="relative flex items-center justify-center h-24 w-24">
        <svg className="absolute inset-0 animate-spin-slow" viewBox="0 0 96 96" fill="none">
          <circle cx="48" cy="48" r="44" stroke="#E6FAFA" strokeWidth="6" />
          <circle
            cx="48" cy="48" r="44"
            stroke="url(#done-grad)"
            strokeWidth="6"
            strokeDasharray="200 76"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="done-grad" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
              <stop stopColor="#238D9D" />
              <stop offset="1" stopColor="#24E5E0" />
            </linearGradient>
          </defs>
        </svg>
        <CheckCircle2 className="h-10 w-10 text-[#238D9D]" />
      </div>

      <div>
        <p className="text-xl font-semibold text-gray-900">All done! 🎉</p>
        <p className="text-sm text-gray-500 mt-1">
          You've helped shape the future of Akiba merchants.
        </p>
      </div>

      {/* Receipt-style summary cards */}
      <div className="w-full space-y-2 text-left">
        {/* Response confirmed */}
        <div className="flex items-center gap-3 rounded-2xl bg-[#F0FAF9] border border-[#C8EEED] px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[#238D9D]" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Response recorded</p>
            <p className="text-xs text-gray-500">Your answers have been saved securely.</p>
          </div>
        </div>

        {/* Reward queued */}
        {rewardPoints > 0 && (
          <div className="flex items-center gap-3 rounded-2xl bg-[#F0FAF9] border border-[#C8EEED] px-4 py-3">
            <Image src={akibaMilesSymbol} width={20} height={20} alt="Miles" className="shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <Image src={akibaMilesSymbol} width={16} height={16} alt="Miles" className="shrink-0" />
                <span>+{rewardPoints}</span>
              </p>
              <p className="text-xs text-gray-500">
                Will appear in your balance shortly.
              </p>
            </div>
          </div>
        )}
      </div>

      <Button
        className="w-full rounded-2xl py-5 bg-[#238D9D] text-white hover:bg-[#1b6b76]"
        title="Back to Earn"
        onClick={onClose}
      >
        Back to Earn
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PollSheet = ({ pollId, open, onOpenChange, onSuccess }: PollSheetProps) => {
  const [poll, setPoll] = useState<PollSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [step, setStep] = useState<Step>("intro");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [slideKey, setSlideKey] = useState(0);
  const [doneReward, setDoneReward] = useState(0);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Load poll when sheet opens; restore draft if one exists
  useEffect(() => {
    if (!open || !pollId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/polls/${pollId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.poll) { setError("Could not load poll."); return; }
        setPoll(data.poll);

        // Restore draft — but only if the poll isn't already completed
        if (!data.poll.completed) {
          const draft = loadDraft(pollId);
          setAcceptedTerms(false);
          if (draft && Object.keys(draft.answers).length > 0) {
            setAnswers(draft.answers);
            setCurrentIndex(draft.currentIndex ?? 0);
            setStep("questions");
          } else {
            setAnswers({});
            setCurrentIndex(0);
            setStep("intro");
          }
        } else {
          setAnswers({});
          setCurrentIndex(0);
          setAcceptedTerms(false);
          setStep("intro");
        }
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [open, pollId]);

  const questions = poll?.questions ?? [];
  const currentQ = questions[currentIndex] ?? null;
  const isLastQuestion = currentIndex === questions.length - 1;
  const currentAnswered = currentQ ? isQuestionAnswered(currentQ, answers) : false;

  // Persist draft to sessionStorage whenever answers or position change
  useEffect(() => {
    if (!pollId || step === "done" || Object.keys(answers).length === 0) return;
    saveDraft(pollId, answers, currentIndex);
  }, [answers, currentIndex, pollId, step]);

  const handleAnswer = (qId: string, update: Partial<AnswerState[string]>) => {
    setAnswers((prev) => ({
      ...prev,
      [qId]: {
        selected_option_ids: prev[qId]?.selected_option_ids ?? [],
        text_answer: prev[qId]?.text_answer ?? "",
        ...update,
      },
    }));
  };

  const goNext = () => {
    if (!currentAnswered) return;
    if (isLastQuestion) {
      // Last question answered → go to review
      setStep("review");
      setError(null);
      return;
    }
    setDirection("forward");
    setCurrentIndex((i) => i + 1);
    setSlideKey((k) => k + 1);
    setError(null);
  };

  const goBack = () => {
    if (currentIndex === 0) return;
    setDirection("backward");
    setCurrentIndex((i) => i - 1);
    setSlideKey((k) => k + 1);
    setError(null);
  };

  // Jump back to a specific question from the review screen
  const editFromReview = (index: number) => {
    setDirection("backward");
    setCurrentIndex(index);
    setSlideKey((k) => k + 1);
    setStep("questions");
    setError(null);
  };

  const handleSubmit = async () => {
    if (!poll?.questions) return;
    if (!acceptedTerms) {
      setError("Please accept the poll terms before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/polls/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poll_id: poll.id,
          answers: buildPayload(questions, answers),
          accepted_terms: true,
          terms_version: POLL_TERMS_VERSION,
        }),
      });
      const data: PollSubmitResponse = await res.json();

      if (data.success || data.code === "already") {
        const pts = data.success ? (data.reward_points ?? poll.reward_points) : 0;
        if (pollId) clearDraft(pollId);
        setDoneReward(pts);
        setStep("done");
        onSuccess(pts);
      } else {
        setError(
          data.message
            ? `${data.message} Your answers are still here — tap Retry to try again.`
            : "Submission failed. Your answers are still here — tap Retry to try again."
        );
      }
    } catch {
      setError("Network error. Your answers are still here — tap Retry to try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Intro screen ──────────────────────────────────────────────────────────
  const hasDraft = pollId ? Object.keys(answers).length > 0 : false;

  const IntroScreen = () => (
    <div className="px-4 pb-6 pt-2">
      <div className="bg-gradient-to-br from-[#238D9D] to-[#1b6b76] rounded-2xl p-5 text-white mb-5">
        <div className="flex items-center gap-3 mb-3">
          <Image src={akibaMilesSymbol} width={36} height={36} alt="Miles" />
          <div>
            <p className="text-2xl font-bold leading-none">{poll?.reward_points}</p>
            <p className="text-xs opacity-80">Reward</p>
          </div>
        </div>
        <p className="text-sm opacity-90 leading-relaxed">{poll?.description}</p>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <span className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1 text-xs text-gray-500">
          <span>📋</span> {questions.length} questions
        </span>
        <span className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1 text-xs text-gray-500">
          <span>⏱️</span> ~{Math.ceil(questions.length * 0.5)} min
        </span>
        {hasDraft && (
          <span className="inline-flex items-center gap-1 bg-[#E6FAFA] rounded-full px-3 py-1 text-xs text-[#238D9D] font-medium">
            <span>💾</span> Draft saved
          </span>
        )}
      </div>

      {hasDraft ? (
        <div className="space-y-2">
          <Button
            className="w-full rounded-2xl py-5 bg-[#238D9D] text-white hover:bg-[#1b6b76]"
            title="Continue survey"
            onClick={() => setStep("questions")}
          >
            <span className="flex items-center justify-center gap-2">
              Continue where you left off
              <ChevronRight className="h-4 w-4" />
            </span>
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-gray-400 py-2 hover:text-gray-600"
            onClick={() => {
              if (pollId) clearDraft(pollId);
              setAnswers({});
              setCurrentIndex(0);
              setStep("questions");
            }}
          >
            Start over
          </button>
        </div>
      ) : (
        <Button
          className="w-full rounded-2xl py-5 bg-[#238D9D] text-white hover:bg-[#1b6b76]"
          title="Start survey"
          onClick={() => setStep("questions")}
        >
          <span className="flex items-center justify-center gap-2">
            Start survey
            <ChevronRight className="h-4 w-4" />
          </span>
        </Button>
      )}

      {/* Privacy note */}
      <p className="text-center text-[11px] text-gray-400 leading-relaxed pt-1">
        Your responses are linked to your wallet for rewards and eligibility.
        Akiba uses them for product analysis and partner-level aggregate insights.
      </p>
    </div>
  );

  // ── Ineligible screens (all non-profile-incomplete reasons) ─────────────
  const IneligibleScreen = ({ reason }: { reason: string }) => {
    const config: Record<string, { icon: React.ReactNode; title: string; body: string; cta?: React.ReactNode }> = {
      profile_incomplete: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-amber-500" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        ),
        title: "Profile required",
        body: "Complete your Akiba profile to unlock Verified Insights. Your answers are more valuable when we know a bit about you.",
        cta: (
          <Link
            href="/profile"
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 bg-[#238D9D] text-white text-sm font-semibold hover:bg-[#1b6b76] transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Complete my profile
            <ChevronRight className="h-4 w-4" />
          </Link>
        ),
      },
      auth_required: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-[#238D9D]" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        ),
        title: "Sign in to participate",
        body: "Connect your wallet to unlock surveys and earn Akiba Miles.",
      },
      not_started: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-gray-400" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        ),
        title: "Survey not open yet",
        body: "This survey hasn't started yet. Check back soon.",
      },
      closed: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-gray-400" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        ),
        title: "Survey closed",
        body: "This survey is no longer accepting responses.",
      },
      wrong_region: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-gray-400" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        ),
        title: "Not available in your region",
        body: "This survey is only available in certain regions at this time.",
      },
      verification_required: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-[#238D9D]" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        ),
        title: "Verification required",
        body: "This survey requires identity verification via Self Protocol. Verification will be available soon.",
      },
      not_eligible: {
        icon: (
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-gray-400" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        ),
        title: "Not eligible",
        body: "You don't currently meet the requirements for this survey. Keep using Akiba and check back later.",
      },
    };

    const { icon, title, body, cta } = config[reason] ?? config["not_eligible"];

    return (
      <div className="px-4 pb-8 pt-4 flex flex-col items-center text-center space-y-5">
        <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-900">{title}</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{body}</p>
        </div>
        {cta ?? (
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 border-2 border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
        )}
        {cta && (
          <button
            type="button"
            className="text-xs text-gray-400 hover:text-gray-600"
            onClick={() => onOpenChange(false)}
          >
            Maybe later
          </button>
        )}
      </div>
    );
  };


  // ── Derive header subtitle for review step ────────────────────────────────
  const headerSub =
    step === "review"
      ? "Review your answers"
      : step === "questions" && questions.length > 0
      ? null // progress bar handles it
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-2xl font-sterling p-0 max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* ── Sticky header ─────────────────────────────────────────────── */}
        <div className="shrink-0 px-4 pt-5 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center rounded-full bg-[#E6FAFA] px-3 py-0.5 text-xs font-medium text-[#238D9D]">
              Verified Insights
            </span>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 leading-tight">
            {loading ? "Loading…" : poll?.title}
          </h2>
          {headerSub && (
            <p className="text-xs text-gray-400 mt-0.5">{headerSub}</p>
          )}
        </div>

        {/* ── Progress bar (questions step only) ────────────────────────── */}
        {step === "questions" && !loading && questions.length > 0 && (
          <div className="shrink-0 border-b border-gray-50">
            <ProgressBar
              current={currentIndex}
              total={questions.length}
              answered={currentAnswered}
            />
          </div>
        )}

        {/* ── Review step: full-width "all answered" bar ─────────────────── */}
        {step === "review" && (
          <div className="shrink-0 border-b border-gray-50 px-4 py-2">
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-[#238D9D] to-[#24E5E0]" />
            <p className="text-center text-[10px] text-[#238D9D] font-medium mt-1">
              All questions answered ✓
            </p>
          </div>
        )}

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {/* Loading */}
          {loading && (
            <div className="py-16 text-center text-gray-400 text-sm">
              Loading survey…
            </div>
          )}

          {/* Load error (non-question step) */}
          {!loading && error && step === "intro" && (
            <div className="py-8 px-4 text-center">
              <p className="text-sm text-red-500 mb-4">{error}</p>
              <Button variant="outline" size="sm" title="Close" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          )}

          {/* Already completed */}
          {!loading && poll?.completed && step !== "done" && (
            <div className="py-10 px-4 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-[#238D9D] mx-auto" />
              <p className="text-lg font-semibold text-gray-900">Already completed</p>
              <p className="text-sm text-gray-500">You have already submitted this survey.</p>
              <Button
                variant="outline"
                className="w-full rounded-2xl py-5"
                title="Close"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          )}

          {/* Ineligible state — any reason that blocks participation */}
          {!loading && !poll?.completed && step === "intro" && poll && !poll.eligible && (
            <IneligibleScreen reason={poll.ineligible_reason ?? "not_eligible"} />
          )}

          {/* Intro — eligible, not yet completed */}
          {!loading && !poll?.completed && step === "intro" && poll?.eligible && (
            <IntroScreen />
          )}

          {/* Questions */}
          {!loading && !poll?.completed && step === "questions" && currentQ && (
            <div className="px-4 pt-4 pb-2">
              <QuestionSlide
                key={slideKey}
                question={currentQ}
                answers={answers}
                onAnswer={handleAnswer}
                direction={direction}
              />
              {error && (
                <p className="text-xs text-red-500 text-center mt-3">{error}</p>
              )}
            </div>
          )}

          {/* Review */}
          {!loading && !poll?.completed && step === "review" && (
            <ReviewScreen
              questions={questions}
              answers={answers}
              acceptedTerms={acceptedTerms}
              error={error}
              onAcceptedTermsChange={setAcceptedTerms}
              onEdit={editFromReview}
            />
          )}

          {/* Done */}
          {step === "done" && (
            <DoneScreen rewardPoints={doneReward} onClose={() => onOpenChange(false)} />
          )}
        </div>

        {/* ── Sticky nav footer ──────────────────────────────────────────── */}

        {/* Questions footer: back + next/review */}
        {!loading && !poll?.completed && step === "questions" && currentQ && (
          <div className="shrink-0 px-4 py-3 border-t border-gray-100 flex gap-3">
            {currentIndex > 0 && (
              <Button
                variant="outline"
                className="rounded-2xl px-4 py-5 border-gray-200 text-gray-500"
                title="Previous"
                onClick={goBack}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <Button
              className="flex-1 rounded-2xl py-5 bg-[#238D9D] text-white hover:bg-[#1b6b76] disabled:opacity-50"
              title={isLastQuestion ? "Review answers" : "Next question"}
              disabled={!currentAnswered}
              onClick={goNext}
            >
              <span className="flex items-center justify-center gap-2">
                {isLastQuestion ? "Review answers" : "Next"}
                <ChevronRight className="h-4 w-4" />
              </span>
            </Button>
          </div>
        )}

        {/* Review footer: back to questions + submit */}
        {!loading && !poll?.completed && step === "review" && (
          <div className="shrink-0 px-4 py-3 border-t border-gray-100 flex gap-3">
            <Button
              variant="outline"
              className="rounded-2xl px-4 py-5 border-gray-200 text-gray-500"
              title="Back to questions"
              onClick={() => {
                setDirection("backward");
                setStep("questions");
                setError(null);
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              className="flex-1 rounded-2xl py-5 bg-[#238D9D] text-white hover:bg-[#1b6b76] disabled:opacity-50"
              title={submitting ? "Submitting…" : error ? "Retry" : `Submit & Earn ${poll?.reward_points}`}
              disabled={submitting || !acceptedTerms || !allAnswered(questions, answers)}
              onClick={handleSubmit}
            >
              {submitting ? (
                "Submitting…"
              ) : error ? (
                <span className="flex items-center justify-center gap-2">
                  Retry
                  <ChevronRight className="h-4 w-4" />
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Submit & Earn
                  <Image src={akibaMilesSymbol} width={16} height={16} alt="Miles" className="shrink-0" />
                  <span>{poll?.reward_points}</span>
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default PollSheet;
