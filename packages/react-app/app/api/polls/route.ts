// GET /api/polls
// Returns active polls with completion + eligibility state for the signed-in wallet.

import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { checkPollProfileGate } from "@/lib/pollProfileGate";
import type { PollRow, PollSummary } from "@/types/polls";

export async function GET() {
  try {
    const session = await requireSession();
    const walletAddress = session?.walletAddress ?? null;

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

    // Profile completion check — one DB query, reused across all polls
    // We compute it once because all reward-bearing polls share the same wallet.
    // Individual polls may have different min_profile_pct thresholds.
    const maxMinPct = Math.max(...(polls as PollRow[]).map((p) => p.min_profile_pct ?? 0));
    let profilePct = 100; // default pass when no gate needed
    if (walletAddress && maxMinPct > 0) {
      const gate = await checkPollProfileGate(walletAddress, maxMinPct);
      profilePct = gate.completionPct;
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

      // Profile completion gate
      const minPct = poll.min_profile_pct ?? 0;
      if (eligible && walletAddress && minPct > 0 && profilePct < minPct) {
        eligible = false;
        ineligible_reason = "profile_incomplete";
      }

      // Future gates (require_country, require_stablecoin_holder, Self Protocol)
      // are left as pass-through at MVP — hook them in here when ready.

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
