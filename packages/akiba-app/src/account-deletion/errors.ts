import { ApiRequestError, readApiErrorEnvelope } from '@/api/errors';

import type { DeletionStep } from './steps';

/**
 * Turns any deletion failure into the three decisions the screen has to
 * make (AKIBA-MOB-002 §5.6): what to tell the member, where to put them,
 * and whether their session is still usable.
 *
 * The server already returns member-safe copy for every mapped deletion
 * error, so that message is preferred over a local paraphrase — one source
 * of wording, and it can be corrected without an app release. Local copy
 * covers only what the server cannot answer: transport failures, and the
 * auth/pending cases where the session itself is the problem.
 */
export type DeletionErrorResolution = {
  message: string;
  /** `null` keeps the member on the current step. */
  returnTo: DeletionStep | null;
  retryable: boolean;
  /** The local session must be cleared — it is expired or the account is going. */
  signOut: boolean;
  /** Bounded code for analytics. Never free text, never a server message. */
  errorCode: string;
};

const OFFLINE = 'We couldn’t reach Akiba. Nothing has been deleted — check your connection and try again.';
const SESSION_EXPIRED = 'Your session expired. Sign in again to continue.';
const ALREADY_PENDING =
  'This account already has a deletion request being processed. You’ve been signed out.';
const LOST_RESPONSE =
  'We couldn’t confirm your request. Try again — you won’t create a second request.';
const GENERIC = 'Something went wrong. Nothing has been deleted — please try again.';

/** Codes that mean the code itself was wrong, so the member retries at `verify`. */
const RETRY_AT_VERIFY = new Set([
  'OTP_INVALID',
  'IDENTITY_MISMATCH',
  'CHALLENGE_ATTEMPTS_EXHAUSTED',
]);

/** Codes that invalidate the whole attempt, so the member restarts at `review`. */
const RESTART_AT_REVIEW = new Set([
  'CHALLENGE_NOT_FOUND',
  'CHALLENGE_EXPIRED',
  'CHALLENGE_CONSUMED',
  'POLICY_VERSION_MISMATCH',
]);

export function resolveDeletionError(error: unknown): DeletionErrorResolution {
  if (!(error instanceof ApiRequestError)) {
    // No HTTP status means the request never completed — the submission may
    // still have been accepted, so the copy must not imply failure and the
    // retry must stay available.
    return {
      message: isLikelyTransportFailure(error) ? OFFLINE : LOST_RESPONSE,
      returnTo: null,
      retryable: true,
      signOut: false,
      errorCode: 'transport_failure',
    };
  }

  const envelope = readApiErrorEnvelope(error);
  const code = envelope?.code ?? `http_${error.status}`;

  if (error.status === 401) {
    return { message: SESSION_EXPIRED, returnTo: null, retryable: false, signOut: true, errorCode: code };
  }

  // 410 is the pending-account guard (§7.4) — another session already
  // started this, so this device has to let go of its own.
  if (error.status === 410 || code === 'ACCOUNT_DELETION_PENDING') {
    return {
      message: ALREADY_PENDING,
      returnTo: null,
      retryable: false,
      signOut: true,
      errorCode: 'ACCOUNT_DELETION_PENDING',
    };
  }

  const message = envelope?.message ?? GENERIC;
  const retryable = envelope?.retryable ?? error.status >= 500;

  if (RETRY_AT_VERIFY.has(code)) {
    return { message, returnTo: 'verify', retryable: false, signOut: false, errorCode: code };
  }
  if (RESTART_AT_REVIEW.has(code)) {
    return { message, returnTo: 'review', retryable: false, signOut: false, errorCode: code };
  }

  return { message, returnTo: null, retryable, signOut: false, errorCode: code };
}

function isLikelyTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /network request failed|fetch failed|timeout|aborted/i.test(error.message);
}
