/**
 * Shared referral-dashboard query (referral-system-spec.md §8's
 * ReferralDashboard contract). Used by both GET /api/referrals/me (the BFF
 * JSON contract) and the /referrals page's server component (so the first
 * paint doesn't wait on a self-fetch of its own API route) — and by the
 * home card, which only needs a few of these fields but gets them for free
 * rather than duplicating the query.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateReferralCode } from "@/lib/akiba/referralCode";
import { buildReferralUrl, friendLabel } from "@/lib/akiba/referral";

export type ReferralDashboard = {
  program: {
    status: "active" | "paused" | "ended";
    signupMiles: number;
    activationMiles: number;
    activationWindowDays: number;
    remainingRewardedReferrals: number;
    termsVersion: string;
  };
  invite: {
    code: string | null;
    url: string;
    canEarn: boolean;
    ineligibleReason?: "account_not_active" | "limit_reached" | "program_paused";
  };
  summary: {
    friendsJoined: number;
    friendsActivated: number;
    milesPending: number;
    milesEarned: number;
  };
  referrals: Array<{
    id: string;
    friendLabel: string;
    state:
      | "joined_pending" | "joined" | "activation_pending" | "complete"
      | "under_review" | "expired" | "not_eligible";
    earnedMiles: number;
    pendingMiles: number;
    nextStep: string | null;
    joinedAt: string;
  }>;
};

type ReferralRow = {
  id: string;
  status: string;
  signup_reward_miles: number;
  activation_reward_miles: number;
  created_at: string;
};

type RewardJobRow = {
  referral_id: string;
  milestone: "signup" | "activation";
  amount_miles: number;
  status: string;
};

function memberState(referral: ReferralRow, jobs: RewardJobRow[]): {
  state: ReferralDashboard["referrals"][number]["state"];
  earnedMiles: number;
  pendingMiles: number;
  nextStep: string | null;
} {
  const signup = jobs.find((j) => j.milestone === "signup");
  const activation = jobs.find((j) => j.milestone === "activation");
  const released = (j?: RewardJobRow) => j?.status === "released";
  const pending = (j?: RewardJobRow) =>
    !!j && ["pending_hold", "eligible", "processing"].includes(j.status);
  const reversing = (j?: RewardJobRow) =>
    !!j && ["reversal_pending", "reversed"].includes(j.status);

  const earnedMiles =
    (released(signup) ? referral.signup_reward_miles : 0) +
    (released(activation) ? referral.activation_reward_miles : 0);
  const pendingMiles =
    (pending(signup) ? referral.signup_reward_miles : 0) +
    (pending(activation) ? referral.activation_reward_miles : 0);

  if (referral.status === "rejected") {
    return { state: "not_eligible", earnedMiles, pendingMiles: 0, nextStep: null };
  }
  if (
    referral.status === "manual_review" ||
    signup?.status === "manual_review" ||
    activation?.status === "manual_review" ||
    reversing(signup) ||
    reversing(activation)
  ) {
    return { state: "under_review", earnedMiles, pendingMiles, nextStep: null };
  }
  if (referral.status === "complete") {
    return { state: "complete", earnedMiles, pendingMiles: 0, nextStep: null };
  }
  if (referral.status === "expired") {
    return { state: "expired", earnedMiles, pendingMiles, nextStep: null };
  }
  if (referral.status === "qualified") {
    return {
      state: "activation_pending",
      earnedMiles,
      pendingMiles,
      nextStep: released(activation) ? null : `${referral.activation_reward_miles} Miles left when the hold clears`,
    };
  }
  if (released(signup)) {
    return {
      state: "joined",
      earnedMiles,
      pendingMiles,
      nextStep: `${referral.activation_reward_miles} Miles left when they shop or use an eligible voucher`,
    };
  }
  return {
    state: "joined_pending",
    earnedMiles,
    pendingMiles,
    nextStep: `${referral.activation_reward_miles} Miles left when they shop or use an eligible voucher`,
  };
}

export async function getReferralDashboard(userId: string): Promise<ReferralDashboard> {
  const admin = createAdminClient();

  const { data: program } = await admin
    .from("referral_program_versions")
    .select("id, version, status, signup_reward_miles, activation_reward_miles, activation_window_days, daily_signup_cap, rolling_30_day_referral_cap")
    .eq("status", "active")
    .maybeSingle();

  const code = await getOrCreateReferralCode(userId);

  const { data: referrals } = await admin
    .from("hub_referrals")
    .select("id, status, signup_reward_miles, activation_reward_miles, created_at")
    .eq("referrer_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200) as { data: ReferralRow[] | null };

  const referralIds = (referrals ?? []).map((r) => r.id);
  const { data: jobs } = referralIds.length
    ? await admin
        .from("referral_reward_jobs")
        .select("referral_id, milestone, amount_miles, status")
        .in("referral_id", referralIds) as { data: RewardJobRow[] | null }
    : { data: [] as RewardJobRow[] };

  const jobsByReferral = new Map<string, RewardJobRow[]>();
  for (const job of jobs ?? []) {
    const list = jobsByReferral.get(job.referral_id) ?? [];
    list.push(job);
    jobsByReferral.set(job.referral_id, list);
  }

  let friendsJoined = 0;
  let friendsActivated = 0;
  let milesPending = 0;
  let milesEarned = 0;

  const referralList = (referrals ?? []).map((r) => {
    const jobsForReferral = jobsByReferral.get(r.id) ?? [];
    const derived = memberState(r, jobsForReferral);

    friendsJoined += 1;
    if (r.status === "qualified" || r.status === "complete") friendsActivated += 1;
    milesPending += derived.pendingMiles;
    milesEarned += derived.earnedMiles;

    return {
      id: r.id,
      friendLabel: friendLabel(),
      state: derived.state,
      earnedMiles: derived.earnedMiles,
      pendingMiles: derived.pendingMiles,
      nextStep: derived.nextStep,
      joinedAt: r.created_at,
    };
  });

  const { data: eligibilityData, error: eligibilityError } = await admin.rpc(
    "get_referral_invite_eligibility",
    { p_user_id: userId }
  );
  const eligibility = (Array.isArray(eligibilityData) ? eligibilityData[0] : eligibilityData) as
    | { can_earn: boolean; reason: ReferralDashboard["invite"]["ineligibleReason"] | null; remaining_rewarded_referrals: number }
    | null;
  const canEarn = !eligibilityError && eligibility?.can_earn === true;
  const remainingRewardedReferrals = eligibility?.remaining_rewarded_referrals ?? 0;
  const ineligibleReason = canEarn
    ? undefined
    : (eligibility?.reason ?? "program_paused");

  return {
    program: {
      status: (program?.status as "active" | "paused" | "ended" | undefined) ?? "paused",
      signupMiles: program?.signup_reward_miles ?? 0,
      activationMiles: program?.activation_reward_miles ?? 0,
      activationWindowDays: program?.activation_window_days ?? 0,
      remainingRewardedReferrals,
      termsVersion: program ? String(program.version) : "0",
    },
    invite: {
      code,
      url: code ? buildReferralUrl(code) : "",
      canEarn,
      ...(ineligibleReason ? { ineligibleReason } : {}),
    },
    summary: {
      friendsJoined,
      friendsActivated,
      milesPending,
      milesEarned,
    },
    referrals: referralList,
  };
}
