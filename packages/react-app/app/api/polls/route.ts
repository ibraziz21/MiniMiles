// GET /api/polls
// Returns active polls with completion + eligibility state for the signed-in wallet.

import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { checkPollProfileGate } from "@/lib/pollProfileGate";
import { checkPollRewardEligibility } from "@/lib/pollEligibility";
import type { PollRow, PollSummary } from "@/types/polls";

export async function GET() {
  try {
    const session = await requireSession();
    const walletAddress = session?.walletAddress?.toLowerCase() ?? null;

    // Blacklist check — blacklisted wallets see no eligible polls
    if (walletAddress && await isBlacklisted(walletAddress, "polls")) {
      return Response.json({ polls: [] });
    }

    // Fetch all active polls
    const { data: polls, error: pollsError } = await supabase
      .from("polls")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (pollsError) {
      console.error("[polls] DB error", pollsError);
      return Response.json({ error: "db-error" }, { status: 500 });
    }

    if (!polls || polls.length === 0) {
      return Response.json({ polls: [] });
    }

    // Fetch completed poll IDs for this wallet (if signed in)
    let completedPollIds = new Set<string>();
    if (walletAddress) {
      const { data: responses } = await supabase
        .from("poll_responses")
        .select("poll_id")
        .eq("wallet_address", walletAddress);

      if (responses) {
        completedPollIds = new Set(responses.map((r: { poll_id: string }) => r.poll_id));
      }
    }

    // Fetch user profile data needed for targeting gates (one query)
    let userCountry: string | null = null;
    let userTraitVerified = false;
    let stablecoinEligible: boolean | null = null; // null = not yet checked

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

    // Profile completion — one DB query reused across all polls
    const maxMinPct = Math.max(...(polls as PollRow[]).map((p) => p.min_profile_pct ?? 0));
    let profilePct = 100; // default pass when no gate needed
    if (walletAddress && maxMinPct > 0) {
      const gate = await checkPollProfileGate(walletAddress, maxMinPct);
      profilePct = gate.completionPct;
    }

    // Stablecoin / reward eligibility — only fetch once if any poll needs it
    const needsEligibilityCheck = (polls as PollRow[]).some(
      (p) => p.require_stablecoin_holder || p.reward_points > 0
    );
    if (walletAddress && needsEligibilityCheck) {
      const eligibility = await checkPollRewardEligibility(walletAddress);
      stablecoinEligible = eligibility.eligible;
    }

    const now = new Date();

    const summaries: PollSummary[] = (polls as PollRow[]).map((poll) => {
      const completed = completedPollIds.has(poll.id);

      let eligible = true;
      let ineligible_reason: string | undefined;

      // Auth gate
      if (poll.require_session && !walletAddress) {
        eligible = false;
        ineligible_reason = "auth_required";
      }

      // Time gates
      if (eligible && poll.starts_at && new Date(poll.starts_at) > now) {
        eligible = false;
        ineligible_reason = "not_started";
      }
      if (eligible && poll.ends_at && new Date(poll.ends_at) < now) {
        eligible = false;
        ineligible_reason = "closed";
      }

      // Country gate
      if (eligible && walletAddress && poll.require_country) {
        if (!userCountry || userCountry !== poll.require_country.toUpperCase()) {
          eligible = false;
          ineligible_reason = "wrong_region";
        }
      }

      // Stablecoin holder gate
      if (eligible && walletAddress && poll.require_stablecoin_holder) {
        if (stablecoinEligible === false) {
          eligible = false;
          ineligible_reason = "not_eligible";
        }
      }

      // Self Protocol verification gates
      if (eligible && walletAddress && (poll.require_trait_verified_age || poll.require_trait_verified_country)) {
        if (!userTraitVerified) {
          eligible = false;
          ineligible_reason = "verification_required";
        }
      }

      // Profile completion gate
      const minPct = poll.min_profile_pct ?? 0;
      if (eligible && walletAddress && minPct > 0 && profilePct < minPct) {
        eligible = false;
        ineligible_reason = "profile_incomplete";
      }

      // Reward eligibility gate (for reward-bearing polls that don't already
      // gate on stablecoin holder — avoids double-checking)
      if (eligible && walletAddress && poll.reward_points > 0 && !poll.require_stablecoin_holder) {
        if (stablecoinEligible === false) {
          eligible = false;
          ineligible_reason = "not_eligible";
        }
      }

      return {
        id: poll.id,
        slug: poll.slug,
        title: poll.title,
        description: poll.description,
        reward_points: poll.reward_points,
        status: poll.status,
        completed,
        eligible,
        ...(ineligible_reason ? { ineligible_reason } : {}),
      };
    });

    return Response.json({ polls: summaries });
  } catch (err: any) {
    console.error("[polls] unexpected error", err);
    return Response.json({ error: "server-error" }, { status: 500 });
  }
}
