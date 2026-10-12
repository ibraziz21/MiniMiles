/**
 * Onboarding completion for both the web /welcome carousel and the native
 * first-run flow (AKIBA-MOB-001 §4). Both write the *same*
 * `hub_user_passes.onboarding_seen_at` column the web page has always read,
 * so a member who finished onboarding on web is never asked again on
 * mobile and vice versa — that cross-surface agreement is the whole reason
 * this is a shared column rather than a new native-only one.
 *
 * Idempotency is "first write wins": an already-completed member gets the
 * original timestamp back untouched, never a refreshed one, so repeated
 * taps (or a retry after a dropped response) can't move the completion
 * date that analytics and support read.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";

export type OnboardingCompletion = {
  completedAt: string;
  /** True when this call found an existing completion instead of writing one. */
  alreadyComplete: boolean;
};

export class OnboardingUnavailableError extends Error {
  constructor(readonly cause?: unknown) {
    super("Could not save onboarding completion");
    this.name = "OnboardingUnavailableError";
  }
}

async function readSeenAt(userId: string): Promise<string | null | undefined> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_passes")
    .select("onboarding_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  // `undefined` means "no pass row at all" — a different situation from a
  // row whose onboarding_seen_at is null, and the one case that needs the
  // pass to be provisioned before the write can land.
  if (error) throw new OnboardingUnavailableError(error);
  if (!data) return undefined;
  return data.onboarding_seen_at ?? null;
}

async function writeSeenAt(userId: string, completedAt: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_passes")
    .update({ onboarding_seen_at: completedAt })
    // Only claim the row if it hasn't been completed already, so two
    // concurrent calls can't both write and the loser can read the winner's
    // timestamp back.
    .eq("user_id", userId)
    .is("onboarding_seen_at", null)
    .select("onboarding_seen_at")
    .maybeSingle();
  if (error) throw new OnboardingUnavailableError(error);
  return !!data;
}

export async function markOnboardingComplete(opts: {
  userId: string;
  email: string | null;
}): Promise<OnboardingCompletion> {
  const { userId, email } = opts;

  const existing = await readSeenAt(userId);
  if (typeof existing === "string") return { completedAt: existing, alreadyComplete: true };

  if (existing === undefined) {
    // No pass yet — the native flow can reach "finish onboarding" without
    // ever having opened the Pass tab, which is what provisions the row on
    // the web side. Same call the web /welcome page makes before reading
    // this column, so the side effects are already-proven ones.
    if (!email) throw new OnboardingUnavailableError(new Error("account has no email"));
    const { walletAddress } = await resolveHubProfile({ userId, email });
    await getOrCreatePass({ userId, email, walletAddress });
  }

  const completedAt = new Date().toISOString();
  if (await writeSeenAt(userId, completedAt)) {
    return { completedAt, alreadyComplete: false };
  }

  // Lost the race (or the pass row still isn't there). Re-read rather than
  // retrying the write: whatever is stored now is the authoritative answer.
  const settled = await readSeenAt(userId);
  if (typeof settled === "string") return { completedAt: settled, alreadyComplete: true };
  throw new OnboardingUnavailableError(new Error("no pass row to record onboarding against"));
}
