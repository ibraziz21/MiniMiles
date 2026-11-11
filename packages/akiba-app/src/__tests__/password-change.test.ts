import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ reauthenticate: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/auth/supabase', () => ({ supabase: { auth } }));

const { changePassword, passwordChangeErrorMessage, passwordProblem, requestPasswordChangeCode } = await import(
  '@/auth/password-change'
);

beforeEach(() => {
  auth.reauthenticate.mockReset();
  auth.updateUser.mockReset();
});

describe('passwordProblem', () => {
  it('accepts a long enough password typed the same twice', () => {
    expect(passwordProblem('correct horse', 'correct horse')).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(passwordProblem('short', 'short')).toBe('Use at least 8 characters.');
    expect(passwordProblem('        ', '        ')).toBe('Use some letters or numbers, not only spaces.');
    expect(passwordProblem('a'.repeat(73), 'a'.repeat(73))).toBe('Use a shorter password.');
    expect(passwordProblem('correct horse', 'correct house')).toBe('The two passwords don’t match.');
  });
});

describe('changing the password', () => {
  it('emails a code before anything changes', async () => {
    auth.reauthenticate.mockResolvedValue({ error: null });
    await requestPasswordChangeCode();
    expect(auth.reauthenticate).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('sends the emailed code with the new password', async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    await changePassword('correct horse', ' 123456 ');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'correct horse', nonce: '123456' });
  });

  it('surfaces a rejected code instead of reporting success', async () => {
    const rejected = { code: 'reauthentication_not_valid', status: 401, message: 'Invalid nonce' };
    auth.updateUser.mockResolvedValue({ error: rejected });
    await expect(changePassword('correct horse', '000000')).rejects.toBe(rejected);
    expect(passwordChangeErrorMessage(rejected)).toBe('That code didn’t work or has expired. Request a new one.');
  });
});

describe('passwordChangeErrorMessage', () => {
  it('never shows the server’s own wording', () => {
    expect(passwordChangeErrorMessage({ code: 'same_password', message: 'New password should be different' })).toBe(
      'That’s already your password. Choose a different one.',
    );
    expect(passwordChangeErrorMessage({ status: 429 })).toBe('Too many attempts. Wait a minute, then try again.');
    expect(passwordChangeErrorMessage({ message: 'Network request failed' })).toBe(
      'We couldn’t reach Akiba. Check your connection and try again.',
    );
    expect(passwordChangeErrorMessage({ status: 500, message: 'internal: db exploded' })).toBe(
      'Couldn’t change your password. Please try again.',
    );
  });
});
