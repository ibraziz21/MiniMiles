// GET /api/polls/[id]
// Returns full poll details including questions and options.
// Only serves active polls — draft/closed polls return 404 to prevent
// content leakage and avoid letting ineligible users attempt submission.

import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";
import { checkPollProfileGate } from "@/lib/pollProfileGate";
import { checkPollRewardEligibility } from "@/lib/pollEligibility";
import type {
  PollRow,
  PollQuestionRow,
  PollOptionRow,
  PollSummary,
  PollQuestion,
} from "@/types/polls";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const walletAddress = session?.walletAddress?.toLowerCase() ?? null;

    // Fetch poll — only active polls are served
    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .eq("id", id)
      .eq("status", "active")   // draft/closed → 404
      .maybeSingle();

    if (pollError) {
      console.error("[polls/id] DB error", pollError);
      return Response.json({ error: "db-error" }, { status: 500 });
    }
    if (!poll) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }

    const pollRow = poll as PollRow;

    // Check completion for this wallet
    let completed = false;
    if (walletAddress) {
      const { data: existing } = await supabase
        .from("poll_responses")
        .select("id")
        .eq("poll_id", pollRow.id)
        .eq("wallet_address", walletAddress)
        .maybeSingle();
      completed = !!existing;
    }

    // Fetch user profile data for targeting gates (single query)
    let userCountry: string | null = null;
    let userTraitVerified = false;
    let stablecoinEligible: boolean | null = null;

    if (walletAddress) {
      const { data: userRow } = await supabase
        .from("users")
        .select("country, trait_verification_status")
        .eq("user_address", walletAddress)
        .maybeSingle();
      const row = userRow as { country?: string; trait_verification_status?: string } | null;
      userCountry = row?.country?.toUpperCase() ?? null;
      userTraitVerified = row?.trait_verification_status === "verified";
    }

    if (walletAddress && (pollRow.require_stablecoin_holder || pollRow.reward_points > 0)) {
      const eligibility = await checkPollRewardEligibility(walletAddress);
      stablecoinEligible = eligibility.eligible;
    }

    // Eligibility
    const now = new Date();
    let eligible = true;
    let ineligible_reason: string | undefined;

    if (pollRow.require_session && !walletAddress) {
      eligible = false;
      ineligible_reason = "auth_required";
    }
    if (eligible && pollRow.starts_at && new Date(pollRow.starts_at) > now) {
      eligible = false;
      ineligible_reason = "not_started";
    }
    if (eligible && pollRow.ends_at && new Date(pollRow.ends_at) < now) {
      eligible = false;
      ineligible_reason = "closed";
    }

    // Country gate
    if (eligible && walletAddress && pollRow.require_country) {
      if (!userCountry || userCountry !== pollRow.require_country.toUpperCase()) {
        eligible = false;
        ineligible_reason = "wrong_region";
      }
    }

    // Stablecoin holder gate
    if (eligible && walletAddress && pollRow.require_stablecoin_holder) {
      if (stablecoinEligible === false) {
        eligible = false;
        ineligible_reason = "not_eligible";
      }
    }

    // Self Protocol verification gates
    if (eligible && walletAddress && (pollRow.require_trait_verified_age || pollRow.require_trait_verified_country)) {
      if (!userTraitVerified) {
        eligible = false;
        ineligible_reason = "verification_required";
      }
    }

    // Profile completion gate
    const minPct = pollRow.min_profile_pct ?? 0;
    if (eligible && walletAddress && minPct > 0) {
      const profileGate = await checkPollProfileGate(walletAddress, minPct);
      if (!profileGate.ok) {
        eligible = false;
        ineligible_reason = "profile_incomplete";
      }
    }

    // Reward eligibility gate (for reward-bearing polls, skip if stablecoin already checked)
    if (eligible && walletAddress && pollRow.reward_points > 0 && !pollRow.require_stablecoin_holder) {
      if (stablecoinEligible === false) {
        eligible = false;
        ineligible_reason = "not_eligible";
      }
    }

    // Fetch questions — only when the poll is completed or user is eligible.
    // Ineligible users get the summary so the UI can show the right blocked
    // state, but questions are withheld to avoid survey farming.
    let builtQuestions: PollQuestion[] = [];
    if (completed || eligible) {
      const { data: questions, error: qError } = await supabase
        .from("poll_questions")
        .select("*")
        .eq("poll_id", pollRow.id)
        .order("position", { ascending: true });

      if (qError) {
        console.error("[polls/id] questions DB error", qError);
        return Response.json({ error: "db-error" }, { status: 500 });
      }

      const questionIds = (questions as PollQuestionRow[]).map((q) => q.id);
      let optionsByQuestion: Record<string, PollOptionRow[]> = {};

      if (questionIds.length > 0) {
        const { data: options, error: oError } = await supabase
          .from("poll_options")
          .select("*")
          .in("question_id", questionIds)
          .order("position", { ascending: true });

        if (oError) {
          console.error("[polls/id] options DB error", oError);
          return Response.json({ error: "db-error" }, { status: 500 });
        }

        for (const opt of options as PollOptionRow[]) {
          if (!optionsByQuestion[opt.question_id]) {
            optionsByQuestion[opt.question_id] = [];
          }
          optionsByQuestion[opt.question_id].push(opt);
        }
      }

      builtQuestions = (questions as PollQuestionRow[]).map((q) => ({
        id: q.id,
        position: q.position,
        question: q.question,
        kind: q.kind,
        required: q.required,
        max_choices: q.max_choices,
        options: (optionsByQuestion[q.id] ?? []).map((o) => ({
          id: o.id,
          label: o.label,
          position: o.position,
        })),
      }));
    }

    const summary: PollSummary = {
      id: pollRow.id,
      slug: pollRow.slug,
      title: pollRow.title,
      description: pollRow.description,
      reward_points: pollRow.reward_points,
      status: pollRow.status,
      completed,
      eligible,
      ...(ineligible_reason ? { ineligible_reason } : {}),
      questions: builtQuestions,
    };

    return Response.json({ poll: summary });
  } catch (err: any) {
    console.error("[polls/id] unexpected error", err);
    return Response.json({ error: "server-error" }, { status: 500 });
  }
}
