/**
 * Verification-code normalization, kept out of the screen so the paste
 * behaviour (AKIBA-MOB-001 §2 "OTP autofill and paste support") is
 * testable without a device.
 *
 * Members paste from a mail app, which rarely means six bare digits —
 * "Your Akiba code is 123456", a trailing newline, or spaced digits are
 * all normal. Stripping to digits accepts all of them instead of silently
 * rejecting a correct code.
 */
export const CODE_LENGTH = 6;

/**
 * Why no `maxLength` on the input: React Native (and the browser) truncate a
 * paste *before* onChangeText sees it, so a six-character cap turns
 * "Your Akiba code is 123456" into "Your A" and the code is lost. The field
 * is left uncapped and `toVerificationCode` does the clamping, which is the
 * only way the paste case above can work.
 */

export function toVerificationCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(value: string): boolean {
  return value.length === CODE_LENGTH;
}
