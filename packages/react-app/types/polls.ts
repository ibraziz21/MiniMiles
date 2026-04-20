// ── Verified Insights — Poll types ───────────────────────────────────────────
// Mirrors the DB schema in sql/verified_insights.sql.
// Future Self Protocol fields are present but optional so they can be
// populated progressively once ZK verification is wired in.

export type QuestionKind = "single_choice" | "multi_select" | "short_text";

export type PollStatus = "draft" | "active" | "closed";

// ── DB row shapes (server-side) ───────────────────────────────────────────────

export interface PollRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  reward_points: number;
  status: PollStatus;
  require_session: boolean;
  require_country: string | null;
  require_stablecoin_holder: boolean;
  /** Minimum profile completion % required to earn a reward. 0 = no gate. */
  min_profile_pct: number;
  // Future Self Protocol gate placeholders
  require_verification_source: string | null;
  require_trait_verified_age: boolean;
  require_trait_verified_country: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PollQuestionRow {
  id: string;
  poll_id: string;
  position: number;
  question: string;
  kind: QuestionKind;
  required: boolean;
  max_choices: number | null;
  created_at: string;
}

export interface PollOptionRow {
  id: string;
  question_id: string;
  position: number;
  label: string;
  created_at: string;
}

export interface PollResponseRow {
  id: string;
  poll_id: string;
  wallet_address: string;
  reward_queued: boolean;
  reward_points_awarded: number | null;
  // Future Self Protocol verification metadata
  verification_source: string | null;
  trait_verification_status: "verified" | "unverified" | null;
  submitted_at: string;
}

// ── API / UI shapes ───────────────────────────────────────────────────────────

export interface PollOption {
  id: string;
  label: string;
  position: number;
}

export interface PollQuestion {
  id: string;
  position: number;
  question: string;
  kind: QuestionKind;
  required: boolean;
  max_choices: number | null;
  options: PollOption[]; // empty for short_text
}

/** Returned by GET /api/polls and GET /api/polls/[id] */
export interface PollSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  reward_points: number;
  status: PollStatus;
  /** True if the current signed-in wallet has already submitted this poll */
  completed: boolean;
  /** True if the current user meets all targeting rules */
  eligible: boolean;
  /**
   * Set when eligible is false. Known values:
   *   "profile_incomplete" — wallet needs to complete more of their profile
   *   "not_started"        — poll hasn't opened yet
   *   "closed"             — poll has ended
   *   "auth_required"      — not signed in
   */
  ineligible_reason?: string;
  questions?: PollQuestion[]; // only in detail response
}

// ── Submission payload ────────────────────────────────────────────────────────

export interface PollAnswerPayload {
  question_id: string;
  /** IDs of selected options (single_choice / multi_select) */
  selected_option_ids?: string[];
  /** Free-text answer (short_text) */
  text_answer?: string;
}

export interface PollSubmitRequest {
  poll_id: string;
  answers: PollAnswerPayload[];
}

export interface PollSubmitResponse {
  success: boolean;
  code?:
    | "already"
    | "not_eligible"
    | "poll_not_found"
    | "poll_closed"
    | "validation_error"
    | "auth_required"
    | "server_error";
  message?: string;
  reward_points?: number;
  queued?: boolean;
}

// ── Mint queue payload kind for poll completion ───────────────────────────────

export type PollCompletionPayload = {
  kind: "poll_completion";
  userAddress: string;
  pollId: string;
  pollSlug: string;
  pointsAwarded: number;
  submittedAt: string;
};
