// Get-or-create the stable Akiba Pass ID for a Hub user — extracted from
// app/(protected)/me/page.tsx so /pass and /welcome's QR reveal slide create
// the same row (and fire the same first-time quest actions) as /me does.
//
// The pass-row insert and the pass_activated internal_event enqueue
// (discovery-quests-spec.md §3.1) happen atomically in one Postgres
// function. Since referral-system-spec.md §6.2 requires every Pass-creation
// path to carry server-resolved referral context, this now always calls
// create_or_get_hub_pass_with_referral (044/048's create_or_get_hub_pass
// with one added nullable arg) instead of branching per caller — passing a
// null referral token behaves identically to the old RPC, so every one of
// this function's callers (join-complete, /pass, /welcome, /me,
// lib/home/feed.ts, GET /api/me/pass) picks up referral binding for free,
// resolving the cookie itself so no caller needs to thread it through.
// quest-events.ts's `pass_signup` emission is a separate, older system (a
// different Platform-side engine) and is left untouched here — this only
// adds the new event, it doesn't replace that one.
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitQuestAction } from "@/lib/akiba/quest-events";
import { verifyReferralCookie, REFERRAL_COOKIE_NAME } from "@/lib/akiba/referral-token";

export type PassResult = {
  publicPassId: string | null;
  /** True only when this call just inserted the row (first-ever pass). */
  isNew: boolean;
  /** 'bound' | 'not_eligible' | 'program_paused' | 'budget_exhausted' | 'none' */
  referralOutcome: string;
};

async function resolveReferralTokenHash(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return verifyReferralCookie(cookieStore.get(REFERRAL_COOKIE_NAME)?.value ?? null);
  } catch {
    // cookies() throws outside a request context (shouldn't happen for any
    // real caller of this function, but never let referral resolution take
    // down Pass creation).
    return null;
  }
}

export async function getOrCreatePass(opts: {
  userId: string;
  email: string | null;
  walletAddress: string | null;
  /** Acquisition source, e.g. join_qr|organic|minipay_funnel. Only
   *  join-complete/route.ts captures a real value today; every other
   *  caller omits it and gets 'organic'. */
  src?: string;
}): Promise<PassResult> {
  const { userId, email, walletAddress, src } = opts;
  if (!email) return { publicPassId: null, isNew: false, referralOutcome: "none" };

  const admin = createAdminClient();
  const referralTokenHash = await resolveReferralTokenHash();

  const { data, error } = await admin.rpc("create_or_get_hub_pass_with_referral", {
    p_user_id: userId,
    p_email: email,
    // Always send every named argument in the canonical database signature.
    // This avoids relying on default-argument resolution in PostgREST's
    // schema cache and works identically for organic and attributed joins.
    p_src: src ?? "organic",
    p_referral_token_hash: referralTokenHash,
  });

  if (error) {
    console.error("[pass] create_or_get_hub_pass_with_referral failed:", error.message);
    return { publicPassId: null, isNew: false, referralOutcome: "none" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const publicPassId: string | null = row?.public_pass_id ?? null;
  const isNew: boolean = row?.is_new === true;
  const referralOutcome: string = row?.referral_outcome ?? "none";

  if (isNew && publicPassId) {
    await emitQuestAction({
      actionName: "pass_signup",
      userId,
      walletAddress,
      idempotencyKey: `quest-pass_signup-${userId}`,
      metadata: { email },
    });
  }

  return { publicPassId, isNew, referralOutcome };
}
