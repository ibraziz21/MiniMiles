import { beforeEach, describe, expect, it } from 'vitest';

import { ApiRequestError } from '@/api/errors';
import { DELETION_STEPS, isReversibleStep, previousStep } from '@/account-deletion/steps';
import { resolveDeletionError } from '@/account-deletion/errors';
import { consumeSessionNotice, setSessionNotice } from '@/auth/session-notice';
import {
  accountDeletionReceiptSchema,
  accountDeletionSummarySchema,
} from '@/contracts/account-deletion';

function apiError(status: number, code?: string, message?: string, retryable?: boolean) {
  return new ApiRequestError(
    `Akiba API request failed with ${status}`,
    status,
    code ? { error: { code, message, retryable } } : null,
  );
}

describe('deletion step machine', () => {
  it('runs review → verify → confirm → receipt', () => {
    expect(DELETION_STEPS).toEqual(['review', 'verify', 'confirm', 'receipt']);
  });

  it('keeps a safe way back on every step before submission', () => {
    expect(isReversibleStep('review')).toBe(true);
    expect(isReversibleStep('verify')).toBe(true);
    expect(isReversibleStep('confirm')).toBe(true);
    // Nothing to go back to once the request is accepted.
    expect(isReversibleStep('receipt')).toBe(false);
  });

  it('steps back one at a time, and off the screen from the first step', () => {
    expect(previousStep('confirm')).toBe('verify');
    expect(previousStep('verify')).toBe('review');
    expect(previousStep('review')).toBeNull();
    expect(previousStep('receipt')).toBeNull();
  });
});

describe('OTP paste normalization', () => {
  it('recovers the code from a full pasted sentence', async () => {
    // This only works because the inputs carry no maxLength: React Native
    // and the browser both truncate a paste before the change handler runs,
    // so a six-character cap would turn this into "Your A".
    const { toVerificationCode } = await import('@/auth/otp');
    expect(toVerificationCode('Your Akiba code is 123456')).toBe('123456');
    expect(toVerificationCode('Your Akiba account deletion code is 987654. It expires in 10 minutes.')).toBe(
      '987654',
    );
  });
});

describe('resolveDeletionError', () => {
  it('sends a rejected code back to the verify step, keeping the attempt alive', () => {
    const resolution = resolveDeletionError(
      apiError(400, 'OTP_INVALID', 'That code didn’t work. Check the 6 digits, or request a new one.'),
    );
    expect(resolution.returnTo).toBe('verify');
    expect(resolution.signOut).toBe(false);
    expect(resolution.message).toContain('6 digits');
    expect(resolution.errorCode).toBe('OTP_INVALID');
  });

  it('sends a code that belongs to another account back to verify, not to sign-out', () => {
    const resolution = resolveDeletionError(apiError(403, 'IDENTITY_MISMATCH', 'Wrong account.'));
    expect(resolution.returnTo).toBe('verify');
    expect(resolution.signOut).toBe(false);
  });

  it('restarts the flow when the whole challenge is void', () => {
    for (const code of ['CHALLENGE_EXPIRED', 'CHALLENGE_CONSUMED', 'CHALLENGE_NOT_FOUND']) {
      expect(resolveDeletionError(apiError(400, code, 'Expired.')).returnTo).toBe('review');
    }
  });

  it('restarts the flow for a stale policy version so the member re-reads the copy', () => {
    const resolution = resolveDeletionError(apiError(409, 'POLICY_VERSION_MISMATCH', 'Terms updated.'));
    expect(resolution.returnTo).toBe('review');
    expect(resolution.signOut).toBe(false);
  });

  it('signs out on an expired session', () => {
    const resolution = resolveDeletionError(apiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    expect(resolution.signOut).toBe(true);
    expect(resolution.message).toContain('session expired');
  });

  it('signs out, with a neutral message, when another session already requested deletion', () => {
    const resolution = resolveDeletionError(
      apiError(410, 'ACCOUNT_DELETION_PENDING', 'This account has a deletion request in progress'),
    );
    expect(resolution.signOut).toBe(true);
    expect(resolution.errorCode).toBe('ACCOUNT_DELETION_PENDING');
    expect(resolution.message).toContain('being processed');
  });

  it('treats a 410 without a body as the pending guard too', () => {
    expect(resolveDeletionError(apiError(410)).signOut).toBe(true);
  });

  it('prefers the server message over local copy, so wording can be fixed without a release', () => {
    const resolution = resolveDeletionError(
      apiError(429, 'RATE_LIMITED', 'Too many deletion codes requested.', true),
    );
    expect(resolution.message).toBe('Too many deletion codes requested.');
    expect(resolution.retryable).toBe(true);
    expect(resolution.returnTo).toBeNull();
  });

  it('keeps the member in place and retryable on a service outage', () => {
    const resolution = resolveDeletionError(
      apiError(503, 'DELETION_SERVICE_UNAVAILABLE', 'Nothing has been deleted.', true),
    );
    expect(resolution.returnTo).toBeNull();
    expect(resolution.retryable).toBe(true);
    expect(resolution.signOut).toBe(false);
  });

  it('never implies failure when the response was simply lost', () => {
    // The submission may have been accepted — the copy must not say it
    // failed, and the retry must stay available (the API is idempotent).
    const resolution = resolveDeletionError(new TypeError('Network request failed'));
    expect(resolution.retryable).toBe(true);
    expect(resolution.signOut).toBe(false);
    expect(resolution.message).toMatch(/Nothing has been deleted/);
    expect(resolution.errorCode).toBe('transport_failure');
  });

  it('tells the member a retry is safe when the outcome is unknown', () => {
    const resolution = resolveDeletionError(new Error('something odd'));
    expect(resolution.message).toMatch(/won’t create a second request/);
    expect(resolution.retryable).toBe(true);
  });

  it('carries a bounded code for analytics, never a server message', () => {
    const resolution = resolveDeletionError(apiError(500));
    expect(resolution.errorCode).toBe('http_500');
    expect(resolution.errorCode).not.toContain(' ');
  });
});

describe('session notice', () => {
  beforeEach(() => {
    consumeSessionNotice();
  });

  it('explains a forced sign-out once, then stops', () => {
    setSessionNotice('account_deletion_pending');
    expect(consumeSessionNotice()).toContain('being processed');
    // One-shot: it must not reappear on the next visit to sign-in.
    expect(consumeSessionNotice()).toBeNull();
  });

  it('distinguishes an expired session from a pending deletion', () => {
    setSessionNotice('session_expired');
    expect(consumeSessionNotice()).toContain('session expired');
  });

  it('says nothing about the account beyond a request being handled', () => {
    setSessionNotice('account_deletion_pending');
    const message = consumeSessionNotice() ?? '';
    expect(message).not.toMatch(/deleted|removed|gone/i);
  });
});

describe('deletion contracts', () => {
  it('accepts the summary the server documents', () => {
    const parsed = accountDeletionSummarySchema.parse({
      maskedEmail: 'm•••••@example.com',
      milesBalance: 1250,
      activeVoucherCount: 3,
      linkedWalletCount: 1,
      processingTargetDays: 14,
      onChainRecordsRemain: true,
      acceptingRequests: true,
    });
    expect(parsed.processingTargetDays).toBe(14);
    expect(parsed.acceptingRequests).toBe(true);
  });

  it('assumes requests are NOT being accepted when the server omits the field', () => {
    // Fails safe against a server that predates the availability gate: the
    // screen shows the support fallback rather than offering a Continue the
    // request API would refuse.
    const parsed = accountDeletionSummarySchema.parse({
      maskedEmail: 'm•••@example.com',
      milesBalance: 0,
      activeVoucherCount: 0,
      linkedWalletCount: 0,
      processingTargetDays: 14,
      onChainRecordsRemain: true,
    });
    expect(parsed.acceptingRequests).toBe(false);
  });

  it('refuses a summary that claims on-chain records are removed', () => {
    // The literal is the contract: no server response may tell the app that
    // Celo data was deleted.
    expect(() =>
      accountDeletionSummarySchema.parse({
        maskedEmail: 'm•••@example.com',
        milesBalance: 0,
        activeVoucherCount: 0,
        linkedWalletCount: 0,
        processingTargetDays: 14,
        onChainRecordsRemain: false,
        acceptingRequests: true,
      }),
    ).toThrow();
  });

  it('rejects a summary carrying a raw email instead of a masked one', () => {
    expect(() =>
      accountDeletionSummarySchema.parse({
        maskedEmail: 'm•••@example.com',
        milesBalance: -1,
        activeVoucherCount: 0,
        linkedWalletCount: 0,
        processingTargetDays: 0,
        onChainRecordsRemain: true,
      }),
    ).toThrow();
  });

  it('parses both a fresh receipt and a repeat one', () => {
    const fresh = accountDeletionReceiptSchema.parse({
      requestId: 'req-1',
      status: 'requested',
      requestedAt: '2026-10-10T00:00:00.000Z',
      targetCompletionAt: '2026-10-24T00:00:00.000Z',
      alreadyRequested: false,
    });
    expect(fresh.alreadyRequested).toBe(false);

    const repeat = accountDeletionReceiptSchema.parse({
      requestId: 'req-1',
      status: 'processing',
      requestedAt: '2026-10-10T00:00:00.000Z',
      targetCompletionAt: '2026-10-24T00:00:00.000Z',
      alreadyRequested: true,
    });
    expect(repeat.requestId).toBe(fresh.requestId);
  });

  it('rejects an unknown request status rather than rendering it', () => {
    expect(() =>
      accountDeletionReceiptSchema.parse({
        requestId: 'req-1',
        status: 'deleted',
        requestedAt: '2026-10-10T00:00:00.000Z',
        targetCompletionAt: '2026-10-24T00:00:00.000Z',
        alreadyRequested: false,
      }),
    ).toThrow();
  });
});
