/**
 * Resend-cooldown arithmetic (AKIBA-MOB-001 §2). Pure, and separate from
 * the hook that renders it, both so it can be unit-tested and because the
 * cooldown is expressed as a *deadline* rather than a remaining count —
 * see useResendCountdown for why that matters when the app is backgrounded.
 */
export const RESEND_COOLDOWN_MS = 30_000;

export function secondsRemaining(availableAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((availableAt - now) / 1000));
}

/**
 * When a new code may be requested, given when the last one was sent.
 * `sentAt` arrives as a route parameter, so a missing or junk value has to
 * degrade to "cooldown starts now" rather than unlocking the button
 * immediately (NaN) or never (Infinity).
 */
export function resendDeadline(sentAt: unknown, now: number = Date.now()): number {
  const parsed = Number(sentAt);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : now;
  return base + RESEND_COOLDOWN_MS;
}
