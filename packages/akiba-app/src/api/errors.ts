/**
 * The API client's error type, kept in its own module so pure logic (and its
 * unit tests) can inspect a failure without pulling in `react-native` and
 * `expo-constants` through the client itself.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * A request that outlived its budget.
 *
 * Deliberately not an ApiRequestError: that type carries an HTTP status, and
 * a timeout has none. Conflating them would also put a timeout within reach
 * of MemberProvider's `status === 401 || 410` branch, which signs the member
 * out — a stalled network must never look like an expired session.
 *
 * The message is written for a member because screens render `error.message`
 * straight into their error state.
 */
export class ApiTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super('The request took too long. Check your connection and try again.');
    this.name = 'ApiTimeoutError';
  }
}

/** The `{ error: { code, message, retryable } }` envelope every v1 route returns. */
export type ApiErrorEnvelope = {
  code: string | null;
  message: string | null;
  retryable: boolean | null;
};

export function readApiErrorEnvelope(error: unknown): ApiErrorEnvelope | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (!error.body || typeof error.body !== 'object' || !('error' in error.body)) return null;

  const envelope = (error.body as { error?: Record<string, unknown> }).error ?? {};
  return {
    code: typeof envelope.code === 'string' ? envelope.code : null,
    message: typeof envelope.message === 'string' ? envelope.message : null,
    retryable: typeof envelope.retryable === 'boolean' ? envelope.retryable : null,
  };
}
