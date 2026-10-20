/**
 * A fetch that cannot hang forever.
 *
 * React Native's fetch has no default timeout, so before this every request
 * could wait indefinitely on a stalled connection — which is not a crash or
 * an error, just a spinner that never resolves. That is the worst failure
 * shape for a member: nothing to retry, nothing to read, no way to tell
 * whether it is working.
 *
 * Kept out of client.ts for the same reason errors.ts is: the client imports
 * `react-native` and `expo-constants`, so this stays unit-testable with a
 * stubbed global fetch.
 *
 * Uses AbortController rather than AbortSignal.timeout — the static helper is
 * recent and its presence in this Hermes build is not something to assume for
 * every request in the app.
 */
import { ApiTimeoutError } from './errors';

/**
 * Generous on purpose. The budget has to cover a Vercel cold start on top of
 * a slow mobile network in the launch market, so it is set to fail a request
 * that is genuinely stuck rather than one that is merely slow. Too tight here
 * turns a bad connection into a broken app.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // We own this controller, so an abort can only be our own timeout.
    // Anything else — DNS failure, TLS error, airplane mode — is passed
    // through untouched so it keeps its own diagnosis.
    if (controller.signal.aborted) throw new ApiTimeoutError(timeoutMs);
    throw error;
  } finally {
    // Always, including the success path: a pending timer would otherwise
    // keep firing an abort at an already-settled request.
    clearTimeout(timer);
  }
}
