import { describe, expect, it } from 'vitest';

import { CODE_LENGTH, isCompleteCode, toVerificationCode } from '@/auth/otp';
import { RESEND_COOLDOWN_MS, resendDeadline, secondsRemaining } from '@/auth/resend';

describe('toVerificationCode', () => {
  it('accepts a plain six-digit code', () => {
    expect(toVerificationCode('123456')).toBe('123456');
    expect(isCompleteCode(toVerificationCode('123456'))).toBe(true);
  });

  it('recovers the code from text pasted out of a mail app', () => {
    expect(toVerificationCode('Your Akiba code is 123456')).toBe('123456');
    expect(toVerificationCode('1 2 3 4 5 6')).toBe('123456');
    expect(toVerificationCode('123456\n')).toBe('123456');
  });

  it('never exceeds the code length', () => {
    expect(toVerificationCode('1234567890')).toHaveLength(CODE_LENGTH);
  });

  it('reports an incomplete code as incomplete', () => {
    expect(isCompleteCode(toVerificationCode('12345'))).toBe(false);
    expect(isCompleteCode(toVerificationCode('abcdef'))).toBe(false);
  });
});

describe('resend cooldown', () => {
  it('counts down in whole seconds and stops at zero', () => {
    const now = 1_000_000;
    expect(secondsRemaining(now + 30_000, now)).toBe(30);
    expect(secondsRemaining(now + 1, now)).toBe(1);
    expect(secondsRemaining(now, now)).toBe(0);
    expect(secondsRemaining(now - 60_000, now)).toBe(0);
  });

  it('is unaffected by how long the app spent in the background', () => {
    // The deadline is absolute, so returning after 25 of 30 seconds shows
    // 5 — a tick-based counter would still read 30.
    const sentAt = 1_000_000;
    const deadline = resendDeadline(sentAt, sentAt);
    expect(secondsRemaining(deadline, sentAt + 25_000)).toBe(5);
    expect(secondsRemaining(deadline, sentAt + 120_000)).toBe(0);
  });

  it('starts the cooldown now when the sent-at parameter is missing or junk', () => {
    const now = 1_000_000;
    expect(resendDeadline(undefined, now)).toBe(now + RESEND_COOLDOWN_MS);
    expect(resendDeadline('not-a-number', now)).toBe(now + RESEND_COOLDOWN_MS);
    expect(resendDeadline('0', now)).toBe(now + RESEND_COOLDOWN_MS);
    expect(resendDeadline(String(now), now)).toBe(now + RESEND_COOLDOWN_MS);
  });
});
