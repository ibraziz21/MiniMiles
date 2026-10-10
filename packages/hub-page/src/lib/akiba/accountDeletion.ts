/**
 * Account-deletion domain logic (AKIBA-MOB-002 §7).
 *
 * Every function here is self-only: the caller passes an already-resolved
 * actor, and nothing accepts an email, user id, or wallet from a request
 * body. The three member-facing operations are the summary projection, the
 * email-ownership challenge, and the request submission — all three composed
 * from loaders the Hub already uses, so the native and web paths can never
 * diverge.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { checkRateLimit } from "@/lib/rateLimit";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getUserBalance } from "@/lib/akiba/balance";
import { getActiveVoucherSummary, getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_SECONDS,
  DELETION_POLICY_VERSION,
  PROCESSING_TARGET_DAYS,
} from "@/lib/akiba/accountDeletionPolicy";
import { encryptCompletionContact } from "@/lib/akiba/accountDeletionContact";
import { maskEmail } from "@/lib/akiba/maskEmail";
import { deletionAvailability } from "@/lib/akiba/accountDeletionAvailability";
import {
  DeletionLookupUnavailableError,
  findOpenDeletionRequest,
} from "@/lib/akiba/accountDeletionGuard";

export { findOpenDeletionRequest };
export { maskEmail };

export type DeletionRequestStatus =
  | "requested"
  | "processing"
  | "legal_hold"
  | "failed"
  | "completed"
  | "cancelled";

export type AccountDeletionSummary = {
  maskedEmail: string;
  milesBalance: number;
  activeVoucherCount: number;
  linkedWalletCount: number;
  processingTargetDays: number;
  onChainRecordsRemain: true;
  /**
   * False while the workflow cannot carry a request out. The app shows the
   * support fallback instead of a Continue button, rather than letting the
   * member read every disclosure and then be refused.
   */
  acceptingRequests: boolean;
};

export type AccountDeletionChallenge = {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
  resendAvailableAt: string;
};

export type AccountDeletionReceipt = {
  requestId: string;
  status: DeletionRequestStatus;
  requestedAt: string;
  targetCompletionAt: string;
  alreadyRequested: boolean;
};

/** Bounded failure codes. Never a provider message, never free text. */
export type DeletionFailureCode =
  | "account_has_no_email"
  | "rate_limited"
  | "otp_send_failed"
  | "challenge_not_found"
  | "challenge_expired"
  | "challenge_consumed"
  | "challenge_attempts_exhausted"
  | "otp_invalid"
  | "identity_mismatch"
  | "policy_version_mismatch"
  | "acknowledgement_required"
  | "deletion_unavailable"
  | "storage_unavailable";

export class AccountDeletionError extends Error {
  constructor(readonly code: DeletionFailureCode) {
    super(code);
    this.name = "AccountDeletionError";
  }
}

/** The actor's own deletion-effects projection. Counts only — never ids. */
export async function getAccountDeletionSummary(actor: {
  userId: string;
  email: string | null;
}): Promise<AccountDeletionSummary> {
  // Nothing here is allowed to degrade to a zero. The member is about to
  // make an irreversible decision partly on these counts, so a failed
  // lookup fails the whole summary as a retryable 503 rather than quietly
  // reporting "0 linked wallets" or "0 active vouchers".
  let profile;
  let walletAddresses: string[];
  let balance;
  let vouchers;
  try {
    [profile, walletAddresses] = await Promise.all([
      resolveHubProfile({ userId: actor.userId, email: actor.email }),
      getLinkedWalletAddresses(actor.userId),
    ]);

    [balance, vouchers] = await Promise.all([
      getUserBalance({ walletAddress: profile.walletAddress, email: actor.email }),
      getActiveVoucherSummary({ userId: actor.userId, walletAddresses }),
    ]);
  } catch (error) {
    console.error(
      `[accountDeletion] summary projection failed name=${
        error instanceof Error ? error.name : "unknown"
      }`,
    );
    throw new AccountDeletionError("storage_unavailable");
  }

  return {
    maskedEmail: maskEmail(actor.email),
    milesBalance: balance.balance,
    activeVoucherCount: vouchers.activeCount,
    linkedWalletCount: walletAddresses.length,
    processingTargetDays: PROCESSING_TARGET_DAYS,
    // Stated as a constant true, not computed: Akiba can never erase a Celo
    // record, whether or not this member has one today.
    onChainRecordsRemain: true,
    acceptingRequests: deletionAvailability().acceptingRequests,
  };
}

function anonClient() {
  const env = getServerEnv();
  // persistSession:false keeps the verification session out of any shared
  // storage — it exists for the length of one request and is revoked after.
  return createSupabaseClient(env.supabase.url, env.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Issues the deletion challenge: Akiba's own bounded window plus a Supabase
 * email OTP sent with `shouldCreateUser: false`, so a deletion flow can
 * never bring an account into existence.
 */
export async function createDeletionChallenge(actor: {
  userId: string;
  email: string | null;
}): Promise<AccountDeletionChallenge> {
  // Before anything else: never send a verification code for a request that
  // cannot be accepted. Sending one would walk the member up to a locked
  // door.
  if (!deletionAvailability().acceptingRequests) {
    throw new AccountDeletionError("deletion_unavailable");
  }
  if (!actor.email) throw new AccountDeletionError("account_has_no_email");

  const withinLimit = await checkRateLimit({
    scope: `account_deletion_challenge:user:${actor.userId}`,
    limit: 3,
    windowSeconds: 900,
  });
  if (!withinLimit) throw new AccountDeletionError("rate_limited");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_account_deletion_challenge", {
    p_hub_user_id: actor.userId,
    p_ttl_seconds: CHALLENGE_TTL_SECONDS,
  });
  if (error) {
    console.error(
      `[accountDeletion] challenge insert failed sqlstate=${error.code ?? "unknown"}`,
    );
    throw new AccountDeletionError("storage_unavailable");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.challenge_id) throw new AccountDeletionError("storage_unavailable");

  const { error: otpError } = await anonClient().auth.signInWithOtp({
    email: actor.email,
    options: { shouldCreateUser: false },
  });
  if (otpError) {
    // The row stays; the member can resend. Only bounded fields are logged:
    // Supabase's message quotes the email address for several failure modes
    // (SMTP rejections especially), and §14 forbids an address reaching a
    // log just as firmly as reaching a response.
    const authError = otpError as typeof otpError & { code?: string; status?: number };
    console.error(
      `[accountDeletion] deletion OTP send failed name=${otpError.name} code=${
        authError.code ?? "unknown"
      } status=${authError.status ?? "unknown"}`,
    );
    throw new AccountDeletionError("otp_send_failed");
  }

  return {
    challengeId: row.challenge_id as string,
    maskedEmail: maskEmail(actor.email),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    // Mirrors the app's deadline-based resend so both sides agree without
    // the client inventing the cooldown.
    resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
  };
}

export type SubmitDeletionInput = {
  actor: { userId: string; email: string | null };
  challengeId: string;
  otp: string;
  acknowledgement: boolean;
  policyVersion: string;
  source: "native_ios" | "native_android" | "web";
};

/**
 * §7.3's server sequence, in order. The two properties that matter:
 *
 * - an actor who already has an open request gets the original receipt back
 *   before the OTP is looked at, so a retry after a dropped response never
 *   needs a second code; and
 * - the challenge is consumed and the request inserted in one RPC under an
 *   advisory lock, so concurrent submissions produce one request.
 */
export async function submitDeletionRequest(
  input: SubmitDeletionInput,
): Promise<AccountDeletionReceipt> {
  const { actor, challengeId, otp, acknowledgement, policyVersion, source } = input;

  if (!acknowledgement) throw new AccountDeletionError("acknowledgement_required");
  if (!actor.email) throw new AccountDeletionError("account_has_no_email");

  // Step 2: an existing request short-circuits everything else.
  let existing;
  try {
    existing = await findOpenDeletionRequest(actor.userId);
  } catch (error) {
    if (error instanceof DeletionLookupUnavailableError) {
      throw new AccountDeletionError("storage_unavailable");
    }
    throw error;
  }
  if (existing) {
    return {
      requestId: existing.id,
      status: existing.status,
      requestedAt: new Date(existing.requested_at).toISOString(),
      targetCompletionAt: new Date(existing.target_completion_at).toISOString(),
      alreadyRequested: true,
    };
  }

  // Checked *after* the existing-request short-circuit on purpose: a member
  // whose request was already accepted must still be able to retry and read
  // their receipt, even if submission was switched off in between.
  if (!deletionAvailability().acceptingRequests) {
    throw new AccountDeletionError("deletion_unavailable");
  }

  // Step 7 before the OTP is spent: a stale app build must be rejected
  // without burning the member's code.
  if (policyVersion !== DELETION_POLICY_VERSION) {
    throw new AccountDeletionError("policy_version_mismatch");
  }

  const admin = createAdminClient();

  // Steps 3–4: burn an attempt first, so a wrong code always costs one even
  // if the verify call itself errors.
  const { data: attemptData, error: attemptError } = await admin.rpc(
    "record_account_deletion_challenge_attempt",
    {
      p_challenge_id: challengeId,
      p_hub_user_id: actor.userId,
      p_max_attempts: CHALLENGE_MAX_ATTEMPTS,
    },
  );
  if (attemptError) {
    console.error(
      `[accountDeletion] challenge attempt failed sqlstate=${attemptError.code ?? "unknown"}`,
    );
    throw new AccountDeletionError("storage_unavailable");
  }
  const attempt = Array.isArray(attemptData) ? attemptData[0] : attemptData;
  if (!attempt?.ok) {
    throw new AccountDeletionError((attempt?.error_code ?? "challenge_not_found") as DeletionFailureCode);
  }

  const client = anonClient();
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    email: actor.email,
    token: otp,
    type: "email",
  });

  // Step 6: drop the session this verification created, whatever the outcome.
  await client.auth.signOut().catch(() => null);

  if (verifyError || !verified?.user) throw new AccountDeletionError("otp_invalid");
  // Step 5: the code must belong to the actor making the request, not merely
  // to some valid account.
  if (verified.user.id !== actor.userId) throw new AccountDeletionError("identity_mismatch");

  // Step 10's prerequisite: capture the completion address now, encrypted,
  // because after processing there is no record left to read it from.
  const contact = encryptCompletionContact(actor.email);

  const { data: created, error: createError } = await admin.rpc("create_account_deletion_request", {
    p_hub_user_id: actor.userId,
    p_challenge_id: challengeId,
    p_policy_version: policyVersion,
    p_source: source,
    p_target_days: PROCESSING_TARGET_DAYS,
    p_contact_ciphertext: contact?.ciphertext ?? null,
    p_contact_key_version: contact?.keyVersion ?? null,
  });
  if (createError) {
    console.error(
      `[accountDeletion] request insert failed sqlstate=${createError.code ?? "unknown"}`,
    );
    throw new AccountDeletionError("storage_unavailable");
  }

  const row = Array.isArray(created) ? created[0] : created;
  if (!row?.ok) {
    throw new AccountDeletionError((row?.error_code ?? "storage_unavailable") as DeletionFailureCode);
  }

  return {
    requestId: row.request_id as string,
    status: row.status as DeletionRequestStatus,
    requestedAt: new Date(row.requested_at as string).toISOString(),
    targetCompletionAt: new Date(row.target_completion_at as string).toISOString(),
    alreadyRequested: Boolean(row.already_requested),
  };
}

/** Request source from the native platform header, defaulting to web. */
export function resolveRequestSource(request: Request): "native_ios" | "native_android" | "web" {
  const platform = request.headers.get("x-akiba-platform")?.trim().toLowerCase();
  if (platform === "ios") return "native_ios";
  if (platform === "android") return "native_android";
  return "web";
}
