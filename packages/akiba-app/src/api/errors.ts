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
