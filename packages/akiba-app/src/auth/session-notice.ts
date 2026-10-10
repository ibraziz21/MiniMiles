/**
 * A one-shot, in-memory reason for why the session ended, read by the
 * sign-in screen so a forced sign-out doesn't look like a random logout
 * (AKIBA-MOB-002 §5.5).
 *
 * In memory on purpose: it is relevant only to the sign-in screen the member
 * is about to land on, and persisting "this account is being deleted" to
 * device storage would outlive its usefulness and leak account state to the
 * next person using the phone.
 */
export type SessionNotice = 'account_deletion_pending' | 'session_expired';

const NOTICE_COPY: Record<SessionNotice, string> = {
  // Neutral by design: it must not confirm or deny anything about the
  // account beyond the fact that a request is being handled.
  account_deletion_pending: 'This account’s deletion request is being processed, so you’ve been signed out.',
  session_expired: 'Your session expired. Sign in again to continue.',
};

let pending: SessionNotice | null = null;

export function setSessionNotice(notice: SessionNotice): void {
  pending = notice;
}

/** Returns the notice copy once, then clears it. */
export function consumeSessionNotice(): string | null {
  if (!pending) return null;
  const message = NOTICE_COPY[pending];
  pending = null;
  return message;
}
