/**
 * Maps the deletion domain's bounded failure codes to HTTP status, API error
 * code, and member-safe copy (AKIBA-MOB-002 §5.6).
 *
 * One table so all three routes answer identically, and so no Supabase or
 * Postgres message can reach a member: the copy here is the only text the
 * API ever returns for these failures.
 */
import type { DeletionFailureCode } from "@/lib/akiba/accountDeletion";

export type MappedDeletionError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
};

const MAP: Record<DeletionFailureCode, MappedDeletionError> = {
  account_has_no_email: {
    status: 422,
    code: "ACCOUNT_HAS_NO_EMAIL",
    message: "This account has no confirmed email, so we can't verify a deletion request. Contact support for help.",
    retryable: false,
  },
  rate_limited: {
    status: 429,
    code: "RATE_LIMITED",
    message: "Too many deletion codes requested. Wait a few minutes and try again.",
    retryable: true,
  },
  otp_send_failed: {
    status: 503,
    code: "OTP_SEND_FAILED",
    message: "We couldn't send your verification code. Please try again.",
    retryable: true,
  },
  challenge_not_found: {
    status: 400,
    code: "CHALLENGE_NOT_FOUND",
    message: "This verification has expired. Start the deletion request again.",
    retryable: false,
  },
  challenge_expired: {
    status: 400,
    code: "CHALLENGE_EXPIRED",
    message: "This verification has expired. Start the deletion request again.",
    retryable: false,
  },
  challenge_consumed: {
    status: 409,
    code: "CHALLENGE_CONSUMED",
    message: "This verification was already used. Start the deletion request again.",
    retryable: false,
  },
  challenge_attempts_exhausted: {
    status: 429,
    code: "CHALLENGE_ATTEMPTS_EXHAUSTED",
    message: "Too many incorrect codes. Request a new code to continue.",
    retryable: false,
  },
  otp_invalid: {
    status: 400,
    code: "OTP_INVALID",
    message: "That code didn't work. Check the 6 digits, or request a new one.",
    retryable: false,
  },
  identity_mismatch: {
    status: 403,
    code: "IDENTITY_MISMATCH",
    message: "That code belongs to a different account. Sign in again and retry.",
    retryable: false,
  },
  policy_version_mismatch: {
    status: 409,
    code: "POLICY_VERSION_MISMATCH",
    message: "Our deletion terms have been updated. Reopen this screen to review them before continuing.",
    retryable: false,
  },
  acknowledgement_required: {
    status: 400,
    code: "ACKNOWLEDGEMENT_REQUIRED",
    message: "Please confirm you understand what deleting your account removes.",
    retryable: false,
  },
  deletion_unavailable: {
    status: 503,
    code: "DELETION_UNAVAILABLE",
    message:
      "Account deletion isn't available in the app just yet. Email hello@akibamiles.com and we'll delete your account for you.",
    retryable: false,
  },
  storage_unavailable: {
    status: 503,
    code: "DELETION_SERVICE_UNAVAILABLE",
    message: "We couldn't reach the deletion service. Nothing has been deleted — please try again.",
    retryable: true,
  },
};

export function mapDeletionError(code: DeletionFailureCode): MappedDeletionError {
  return MAP[code] ?? MAP.storage_unavailable;
}
