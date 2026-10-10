import { describe, expect, it } from 'vitest';

import { mapAuthError, parseCooldownSeconds } from '@/auth/errors';
import { emailFieldError, isValidEmail, normalizeEmail } from '@/auth/email';

describe('mapAuthError', () => {
  it('never returns the raw server message', () => {
    const raw = 'AuthApiError: Token has expired or is invalid';
    const mapped = mapAuthError({ code: 'otp_expired', status: 403, message: raw }, 'verify');
    expect(mapped).not.toContain('AuthApiError');
    expect(mapped).toBe('That code has expired. Request a new one to continue.');
  });

  it('reports a transport failure as a connection problem, not a bad code', () => {
    expect(mapAuthError({ name: 'AuthRetryableFetchError', status: 0 }, 'verify')).toContain(
      'couldn’t reach Akiba',
    );
    expect(mapAuthError({ message: 'Network request failed' }, 'send')).toContain('couldn’t reach Akiba');
  });

  it('surfaces the server-stated cooldown verbatim in seconds', () => {
    const message = 'For security purposes, you can only request this after 48 seconds.';
    expect(mapAuthError({ status: 429, message }, 'send')).toBe(
      'Please wait 48 seconds before requesting another code.',
    );
    expect(mapAuthError({ status: 429, message: 'you can only request this after 1 second' }, 'send')).toBe(
      'Please wait 1 second before requesting another code.',
    );
  });

  it('maps rate limiting by code and by status', () => {
    const expected = 'Too many attempts. Wait a minute, then request a new code.';
    expect(mapAuthError({ code: 'over_email_send_rate_limit' }, 'send')).toBe(expected);
    expect(mapAuthError({ status: 429 }, 'send')).toBe(expected);
  });

  it('phrases a validation failure for the step it happened on', () => {
    expect(mapAuthError({ code: 'validation_failed' }, 'send')).toContain('email address');
    expect(mapAuthError({ code: 'validation_failed' }, 'verify')).toContain('6 digits');
  });

  it('treats a rejected code during verification as a bad code', () => {
    expect(mapAuthError({ status: 403 }, 'verify')).toContain('6 digits');
    expect(mapAuthError({ code: 'invalid_credentials' }, 'verify')).toContain('6 digits');
  });

  it('falls back to a generic message for anything unrecognised', () => {
    expect(mapAuthError({ code: 'something_new', status: 418 }, 'send')).toBe(
      'Something went wrong. Please try again.',
    );
    expect(mapAuthError(null, 'send')).toBe('Something went wrong. Please try again.');
    expect(mapAuthError('a string', 'verify')).toBe('Something went wrong. Please try again.');
  });
});

describe('parseCooldownSeconds', () => {
  it('extracts the seconds Supabase names', () => {
    expect(parseCooldownSeconds({ message: 'only request this after 24 seconds' })).toBe(24);
  });

  it('returns null when no cooldown is named', () => {
    expect(parseCooldownSeconds({ message: 'Invalid email' })).toBeNull();
    expect(parseCooldownSeconds(undefined)).toBeNull();
  });
});

describe('email validation', () => {
  it('accepts ordinary addresses, case- and space-insensitively', () => {
    expect(isValidEmail('  Member@Example.CO.KE ')).toBe(true);
    expect(normalizeEmail('  Member@Example.CO.KE ')).toBe('member@example.co.ke');
  });

  it('rejects the typo cases before a request is spent', () => {
    expect(isValidEmail('member')).toBe(false);
    expect(isValidEmail('member@')).toBe(false);
    expect(isValidEmail('member@example')).toBe(false);
    expect(isValidEmail('member @example.com')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });

  it('distinguishes an empty field from an invalid one', () => {
    expect(emailFieldError('   ')).toBe('Enter your email address.');
    expect(emailFieldError('nope')).toContain('valid email address');
    expect(emailFieldError('member@example.com')).toBeNull();
  });
});
