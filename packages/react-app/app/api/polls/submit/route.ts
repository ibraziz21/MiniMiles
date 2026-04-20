// POST /api/polls/submit
// Submits a completed poll, stores answers, and queues the Miles reward.
//
// Security layers (in order):
//   1. Iron-session auth (requireSession)
//   2. Session minimum age gate (blocks sessions < SESSION_MIN_AGE_MS old)
//   3. Blacklist check
//   4. In-process rate limit (per-IP + per-wallet failed-submit counts)
//   5. Poll state + duplicate-submission gate
//   6. Server-side input limits (payload size, answer count, text length)
//   7. Answer validation (required questions, per-question option ownership)
//   8. Targeting gates (country, stablecoin, Self Protocol traits)
//   9. Profile completion gate (wallet must meet polls.min_profile_pct)
//  10. Reward eligibility gate (stablecoin hold OR prior engagement history)
//  11. Atomic DB write via submit_poll_response RPC
//       — response + answers + mint job in one transaction; no partial state

import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession, SESSION_MIN_AGE_MS } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { checkPollSubmitRateLimit, recordFailedSubmit, recordSuccessfulSubmit } from "@/lib/pollRateLimit";
import { checkPollRewardEligibility } from "@/lib/pollEligibility";
import { checkPollProfileGate } from "@/lib/pollProfileGate";
import {
  POLL_TERMS_VERSION,
  type PollRow,
  type PollQuestionRow,
  type PollOptionRow,
  type PollSubmitRequest,
  type PollSubmitResponse,
} from "@/types/polls";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_BYTES = 64 * 1024;       // 64 KB
const MAX_ANSWERS       = 50;              // max questions per poll
const MAX_TEXT_LENGTH   = 500;             // chars per short_text answer
const MAX_TERMS_VERSION_LENGTH = 100;

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
  // Normalize to lowercase immediately — all DB reads/writes use this value.
  const walletAddress = session.walletAddress.toLowerCase();

  // ── 2. Session age gate ───────────────────────────────────────────────────
  const sessionAgeMs = Date.now() - (session.issuedAt ?? 0);
  if (sessionAgeMs < SESSION_MIN_AGE_MS) {
    const waitS = Math.ceil((SESSION_MIN_AGE_MS - sessionAgeMs) / 1000);
    return fail(
      "not_eligible",
      `Your session is too new. Please wait ${waitS} seconds and try again.`,
      429,
      ip,
      walletAddress,
      false
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

  // ── 5. Parse body (with size guard) ──────────────────────────────────────
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return fail("validation_error", "Request payload too large", 413, ip, walletAddress);
  }

  let body: PollSubmitRequest;
  try {
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return fail("validation_error", "Request payload too large", 413, ip, walletAddress);
    }
    body = JSON.parse(raw) as PollSubmitRequest;
  } catch {
    return fail("validation_error", "Invalid JSON", 400, ip, walletAddress);
  }

  const { poll_id, answers, accepted_terms, terms_version } = body;

  if (!poll_id || !Array.isArray(answers)) {
    return fail("validation_error", "poll_id and answers are required", 400, ip, walletAddress);
  }

  if (accepted_terms !== true || typeof terms_version !== "string" || !terms_version.trim()) {
    return fail("validation_error", "Poll terms must be accepted before submitting", 400, ip, walletAddress);
  }

  const acceptedTermsVersion = terms_version.trim();

  if (acceptedTermsVersion.length > MAX_TERMS_VERSION_LENGTH) {
    return fail("validation_error", "Invalid poll terms version", 400, ip, walletAddress);
  }

  if (acceptedTermsVersion !== POLL_TERMS_VERSION) {
    return fail("validation_error", "Unsupported poll terms version", 400, ip, walletAddress);
  }

  // ── 6. Server-side input limits ───────────────────────────────────────────
  if (answers.length > MAX_ANSWERS) {
    return fail("validation_error", `Too many answers (max ${MAX_ANSWERS})`, 400, ip, walletAddress);
  }

  for (const answer of answers) {
    if (answer.text_answer && answer.text_answer.length > MAX_TEXT_LENGTH) {
      return fail(
        "validation_error",
        `Text answer exceeds ${MAX_TEXT_LENGTH} characters`,
        400,
        ip,
        walletAddress
      );
    }
  }

  // ── 7. Load poll ──────────────────────────────────────────────────────────
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

  // ── 8. Duplicate check ────────────────────────────────────────────────────
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

  // ── 9. Load questions + options ───────────────────────────────────────────
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

  // ── 10. Validate: all required questions present ──────────────────────────
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

  // ── 11. Validate each answer ──────────────────────────────────────────────
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

  // ── 12. Targeting gates ───────────────────────────────────────────────────
  // country gate
  if (pollRow.require_country) {
    // We don't have a server-side country lookup yet; fail open for now but
    // log so we know when to implement it. Replace with real geo lookup when
    // the country field is reliably populated on the user row.
    const { data: userRow } = await supabase
      .from("users")
      .select("country")
      .eq("user_address", walletAddress)
      .maybeSingle();
    const userCountry = (userRow as { country?: string } | null)?.country?.toUpperCase() ?? null;
    if (!userCountry || userCountry !== pollRow.require_country.toUpperCase()) {
      return fail(
        "not_eligible",
        "This survey is only available in certain regions.",
        403,
        ip,
        walletAddress,
        false
      );
    }
  }

  // stablecoin holder gate (mirrors the eligibility check but at the poll level)
  if (pollRow.require_stablecoin_holder) {
    const eligibility = await checkPollRewardEligibility(walletAddress);
    if (!eligibility.eligible) {
      return fail("not_eligible", eligibility.userMessage, 403, ip, walletAddress, false);
    }
  }

  // Self Protocol verification gates
  if (pollRow.require_trait_verified_age || pollRow.require_trait_verified_country) {
    // Placeholder: Self Protocol ZK verification not yet implemented.
    // When implemented, verify the wallet's on-chain attestation here.
    // For now, block if the poll explicitly requires verified traits to prevent
    // reward farming on future premium polls that have these flags set.
    const { data: verifiedRow } = await supabase
      .from("users")
      .select("trait_verification_status, verification_source")
      .eq("user_address", walletAddress)
      .maybeSingle();

    const verified =
      (verifiedRow as { trait_verification_status?: string } | null)
        ?.trait_verification_status === "verified";

    if (!verified) {
      return fail(
        "not_eligible",
        "This survey requires identity verification. Check back once Self Protocol verification is available.",
        403,
        ip,
        walletAddress,
        false
      );
    }
  }

  // ── 13. Profile completion gate ───────────────────────────────────────────
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

  // ── 14. Reward eligibility gate ───────────────────────────────────────────
  // Skip if poll has no reward AND targeting didn't already check it.
  if (pollRow.reward_points > 0 && !pollRow.require_stablecoin_holder) {
    const eligibility = await checkPollRewardEligibility(walletAddress);
    if (!eligibility.eligible) {
      console.log(
        `[polls/submit] eligibility fail addr=${walletAddress.slice(0, 8)}… reason=${eligibility.reason}`
      );
      return fail("not_eligible", eligibility.userMessage, 403, ip, walletAddress, false);
    }
  }

  // ── 15. Build answer rows for the RPC ─────────────────────────────────────
  // For multi_select each chosen option becomes a separate row.
  // selected_option_id is a single uuid (or null); text_answer is text (or null).
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

  // ── 16. Atomic DB write via RPC ───────────────────────────────────────────
  // submit_poll_response inserts poll_responses + poll_response_answers +
  // minipoint_mint_jobs in a single transaction. If any step fails the whole
  // transaction rolls back — no partial state, no permanent lock-out.
  const idempotencyKey = `poll-completion:${poll_id}:${walletAddress}`;

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "submit_poll_response",
    {
      p_poll_id:         poll_id,
      p_wallet:          walletAddress,
      p_reward_points:   pollRow.reward_points,
      p_answers:         answerRows,
      p_idempotency_key: idempotencyKey,
      p_poll_slug:       pollRow.slug,
      p_accepted_terms:  accepted_terms,
      p_terms_version:   POLL_TERMS_VERSION,
    }
  );

  if (rpcError) {
    console.error("[polls/submit] RPC error", rpcError);
    return fail("server_error", "Failed to save response — please try again", 500, ip, walletAddress);
  }

  // RPC returns a single row
  const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  if (!row) {
    return fail("server_error", "Unexpected empty RPC result", 500, ip, walletAddress);
  }

  if (row.code === "already") {
    return Response.json(
      { success: false, code: "already", message: "You have already completed this poll" } satisfies PollSubmitResponse,
      { status: 200 }
    );
  }

  // ── 17. Record successful submission for rate-limit tracking ──────────────
  recordSuccessfulSubmit(ip, walletAddress);

  return Response.json(
    {
      success: true,
      reward_points: pollRow.reward_points,
      queued: pollRow.reward_points > 0,
    } satisfies PollSubmitResponse,
    { status: 200 }
  );
}
