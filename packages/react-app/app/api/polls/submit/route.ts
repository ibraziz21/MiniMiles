// POST /api/polls/submit
// Submits a completed poll, stores answers, and queues the Miles reward.
//
// Security layers (in order):
//   1. Iron-session auth (requireSession)
//   2. Session minimum age gate (blocks sessions < SESSION_MIN_AGE_MS old)
//   3. Blacklist check
//   4. In-process rate limit (per-IP + per-wallet failed-submit counts)
//   5. Poll state + duplicate-submission gate
//   6. Answer validation (required questions, per-question option ownership)
//   7. Profile completion gate (wallet must meet polls.min_profile_pct)
//   8. Reward eligibility gate (stablecoin hold OR prior engagement history)
//   9. Atomic DB write (response + answers; rollback on answer failure)
//  10. Reward queue (idempotency key prevents double-mint on retries)

import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession, SESSION_MIN_AGE_MS } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { claimQueuedPollReward } from "@/lib/minipointQueue";
import { checkPollSubmitRateLimit, recordFailedSubmit, recordSuccessfulSubmit } from "@/lib/pollRateLimit";
import { checkPollRewardEligibility } from "@/lib/pollEligibility";
import { checkPollProfileGate } from "@/lib/pollProfileGate";
import type {
  PollRow,
  PollQuestionRow,
  PollOptionRow,
  PollSubmitRequest,
  PollSubmitResponse,
} from "@/types/polls";

// ── Helper ────────────────────────────────────────────────────────────────────

function fail(
  code: PollSubmitResponse["code"],
  message: string,
  status: number,
  ip: string,
  wallet: string,
  countAsFailure = true
): Response {
  if (countAsFailure) recordFailedSubmit(ip, wallet);
  return Response.json(
    { success: false, code, message } satisfies PollSubmitResponse,
    { status }
  );
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const session = await requireSession();
  if (!session) {
    return Response.json(
      { success: false, code: "auth_required", message: "Authentication required" } satisfies PollSubmitResponse,
      { status: 401 }
    );
  }
  const walletAddress = session.walletAddress;

  // ── 2. Session age gate ───────────────────────────────────────────────────
  // logSessionAge only observes; here we enforce.
  const sessionAgeMs = Date.now() - (session.issuedAt ?? 0);
  if (sessionAgeMs < SESSION_MIN_AGE_MS) {
    const waitS = Math.ceil((SESSION_MIN_AGE_MS - sessionAgeMs) / 1000);
    return fail(
      "not_eligible",
      `Your session is too new. Please wait ${waitS} seconds and try again.`,
      429,
      ip,
      walletAddress,
      false // fresh session is not abuse — don't penalise
    );
  }

  // ── 3. Blacklist ──────────────────────────────────────────────────────────
  if (await isBlacklisted(walletAddress, "polls/submit")) {
    return fail("not_eligible", "Forbidden", 403, ip, walletAddress, false);
  }

  // ── 4. Rate limit ─────────────────────────────────────────────────────────
  const rateCheck = checkPollSubmitRateLimit(ip, walletAddress);
  if (!rateCheck.ok) {
    const headers: Record<string, string> = {};
    if (rateCheck.retryAfterMs) {
      headers["Retry-After"] = String(Math.ceil(rateCheck.retryAfterMs / 1000));
    }
    return Response.json(
      { success: false, code: "not_eligible", message: rateCheck.reason } satisfies PollSubmitResponse,
      { status: 429, headers }
    );
  }

  // ── 5. Parse body ─────────────────────────────────────────────────────────
  let body: PollSubmitRequest;
  try {
    body = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON", 400, ip, walletAddress);
  }

  const { poll_id, answers } = body;

  if (!poll_id || !Array.isArray(answers)) {
    return fail("validation_error", "poll_id and answers are required", 400, ip, walletAddress);
  }

  // ── 6. Load poll ──────────────────────────────────────────────────────────
  const { data: poll, error: pollError } = await supabase
    .from("polls")
    .select("*")
    .eq("id", poll_id)
    .maybeSingle();

  if (pollError) {
    console.error("[polls/submit] poll DB error", pollError);
    return fail("server_error", "db-error", 500, ip, walletAddress);
  }
  if (!poll) {
    return fail("poll_not_found", "Poll not found", 404, ip, walletAddress);
  }

  const pollRow = poll as PollRow;

  if (pollRow.status !== "active") {
    return fail("poll_closed", "This poll is no longer active", 400, ip, walletAddress, false);
  }

  const now = new Date();
  if (pollRow.starts_at && new Date(pollRow.starts_at) > now) {
    return fail("not_eligible", "Poll has not started yet", 403, ip, walletAddress, false);
  }
  if (pollRow.ends_at && new Date(pollRow.ends_at) < now) {
    return fail("poll_closed", "Poll has ended", 400, ip, walletAddress, false);
  }

  // ── 7. Duplicate check ────────────────────────────────────────────────────
  const { data: existing, error: dupError } = await supabase
    .from("poll_responses")
    .select("id")
    .eq("poll_id", poll_id)
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (dupError) {
    console.error("[polls/submit] dup check error", dupError);
    return fail("server_error", "db-error", 500, ip, walletAddress);
  }
  if (existing) {
    return Response.json(
      { success: false, code: "already", message: "You have already completed this poll" } satisfies PollSubmitResponse,
      { status: 200 }
    );
  }

  // ── 8. Load questions + options ───────────────────────────────────────────
  const { data: questions, error: qError } = await supabase
    .from("poll_questions")
    .select("*")
    .eq("poll_id", poll_id);

  if (qError || !questions) {
    return fail("server_error", "db-error", 500, ip, walletAddress);
  }

  const questionMap = new Map<string, PollQuestionRow>(
    (questions as PollQuestionRow[]).map((q) => [q.id, q])
  );

  const questionIds = questions.map((q: PollQuestionRow) => q.id);
  // options keyed per question for cross-question spoofing prevention
  const optionsByQuestion = new Map<string, Set<string>>();
  if (questionIds.length > 0) {
    const { data: options, error: oError } = await supabase
      .from("poll_options")
      .select("id, question_id")
      .in("question_id", questionIds);
    if (oError) {
      return fail("server_error", "db-error", 500, ip, walletAddress);
    }
    for (const opt of (options ?? []) as Pick<PollOptionRow, "id" | "question_id">[]) {
      const set = optionsByQuestion.get(opt.question_id) ?? new Set<string>();
      set.add(opt.id);
      optionsByQuestion.set(opt.question_id, set);
    }
  }

  // ── 9. Validate: all required questions present ──────────────────────────
  const answerByQuestion = new Map<string, (typeof answers)[number]>();
  for (const answer of answers) {
    if (answerByQuestion.has(answer.question_id)) {
      return fail("validation_error", `Duplicate answer for question_id: ${answer.question_id}`, 400, ip, walletAddress);
    }
    answerByQuestion.set(answer.question_id, answer);
  }

  for (const question of questions as PollQuestionRow[]) {
    if (!question.required) continue;
    if (!answerByQuestion.has(question.id)) {
      return fail(
        "validation_error",
        `Missing answer for required question: "${question.question}"`,
        400,
        ip,
        walletAddress
      );
    }
  }

  // ── 10. Validate each answer ──────────────────────────────────────────────
  for (const answer of answers) {
    const question = questionMap.get(answer.question_id);
    if (!question) {
      return fail("validation_error", `Unknown question_id: ${answer.question_id}`, 400, ip, walletAddress);
    }

    if (question.kind === "short_text") {
      if (question.required && !answer.text_answer?.trim()) {
        return fail("validation_error", `Question "${question.question}" requires a text answer`, 400, ip, walletAddress);
      }
    } else {
      const selectedIds = answer.selected_option_ids ?? [];
      if (question.required && selectedIds.length === 0) {
        return fail("validation_error", `Question "${question.question}" requires at least one selection`, 400, ip, walletAddress);
      }
      if (question.kind === "single_choice" && selectedIds.length > 1) {
        return fail("validation_error", `Question "${question.question}" only allows one selection`, 400, ip, walletAddress);
      }
      if (question.max_choices !== null && selectedIds.length > question.max_choices) {
        return fail("validation_error", `Question "${question.question}" allows at most ${question.max_choices} selections`, 400, ip, walletAddress);
      }
      const validForThisQuestion = optionsByQuestion.get(question.id) ?? new Set<string>();
      for (const optId of selectedIds) {
        if (!validForThisQuestion.has(optId)) {
          return fail("validation_error", `Option ${optId} does not belong to question "${question.question}"`, 400, ip, walletAddress);
        }
      }
    }
  }

  // ── 12. Profile completion gate ───────────────────────────────────────────
  // Only enforced for polls that have a minimum profile threshold set.
  const minProfilePct = pollRow.min_profile_pct ?? 0;
  if (minProfilePct > 0) {
    const profileGate = await checkPollProfileGate(walletAddress, minProfilePct);
    if (!profileGate.ok) {
      return fail(
        "not_eligible",
        `Complete your profile to unlock this survey. You're at ${profileGate.completionPct}% — need ${minProfilePct}%.`,
        403,
        ip,
        walletAddress,
        false
      );
    }
  }

  // ── 13. Reward eligibility gate ───────────────────────────────────────────
  // Only enforced for polls that award points — zero-point polls are informational.
  if (pollRow.reward_points > 0) {
    const eligibility = await checkPollRewardEligibility(walletAddress);
    if (!eligibility.eligible) {
      console.log(
        `[polls/submit] eligibility fail addr=${walletAddress.slice(0, 8)}… reason=${eligibility.reason}`
      );
      return fail("not_eligible", eligibility.userMessage, 403, ip, walletAddress, false);
    }
  }

  // ── 14. Build answer rows ─────────────────────────────────────────────────
  const answerRows: {
    question_id: string;
    selected_option_id: string | null;
    text_answer: string | null;
  }[] = [];

  for (const answer of answers) {
    const question = questionMap.get(answer.question_id)!;
    if (question.kind === "short_text") {
      answerRows.push({
        question_id: answer.question_id,
        selected_option_id: null,
        text_answer: answer.text_answer?.trim() ?? null,
      });
    } else {
      const selectedIds = answer.selected_option_ids ?? [];
      if (selectedIds.length === 0) {
        answerRows.push({ question_id: answer.question_id, selected_option_id: null, text_answer: null });
      } else {
        for (const optId of selectedIds) {
          answerRows.push({ question_id: answer.question_id, selected_option_id: optId, text_answer: null });
        }
      }
    }
  }

  // ── 15. Store response row ────────────────────────────────────────────────
  const { data: responseRow, error: insertError } = await supabase
    .from("poll_responses")
    .insert({
      poll_id,
      wallet_address: walletAddress,
      reward_queued: false,
      reward_points_awarded: pollRow.reward_points,
      verification_source: null,
      trait_verification_status: null,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return Response.json(
        { success: false, code: "already", message: "You have already completed this poll" } satisfies PollSubmitResponse,
        { status: 200 }
      );
    }
    console.error("[polls/submit] insert response error", insertError);
    return fail("server_error", "Failed to save response", 500, ip, walletAddress);
  }

  const responseId = responseRow.id;

  // ── 16. Store answers — fail hard + rollback on error ─────────────────────
  if (answerRows.length > 0) {
    const { error: answerError } = await supabase
      .from("poll_response_answers")
      .insert(answerRows.map((r) => ({ ...r, response_id: responseId })));

    if (answerError) {
      console.error("[polls/submit] insert answers error", answerError);
      await supabase.from("poll_responses").delete().eq("id", responseId);
      return fail("server_error", "Failed to save answers — please try again", 500, ip, walletAddress);
    }
  }

  // ── 17. Queue reward ──────────────────────────────────────────────────────
  let rewardQueued = false;
  if (pollRow.reward_points > 0) {
    try {
      await claimQueuedPollReward({
        userAddress: walletAddress,
        pollId: poll_id,
        pollSlug: pollRow.slug,
        points: pollRow.reward_points,
      });
      rewardQueued = true;
      await supabase.from("poll_responses").update({ reward_queued: true }).eq("id", responseId);
    } catch (rewardErr) {
      console.error("[polls/submit] reward queue error", rewardErr);
      // Answers stored; idempotency key makes a later retry safe.
    }
  }

  // ── 18. Record successful submission for rate-limit tracking ──────────────
  recordSuccessfulSubmit(ip, walletAddress);

  return Response.json(
    { success: true, reward_points: pollRow.reward_points, queued: rewardQueued } satisfies PollSubmitResponse,
    { status: 200 }
  );
}
