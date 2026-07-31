/**
 * Correlation-ID plumbing (production-readiness-security-spec.md §11.1).
 *
 * Every request and job should carry one ID end to end so structured log
 * lines, error reports, and reconciliation incidents can be joined. Reuses
 * an inbound `x-correlation-id` (e.g. set by middleware, a cron caller, or
 * an upstream proxy) when present and well-formed; otherwise mints a new one.
 *
 * Edge-safe: uses Web Crypto only, no `node:crypto` import, so this can be
 * imported from middleware.ts as well as route handlers.
 */

export const CORRELATION_ID_HEADER = "x-correlation-id";

const VALID_ID = /^[a-zA-Z0-9_-]{8,128}$/;

export function getOrCreateCorrelationId(
  headers: Headers | Record<string, string | string[] | undefined>
): string {
  const inbound = readHeader(headers, CORRELATION_ID_HEADER);
  if (inbound && VALID_ID.test(inbound)) return inbound;
  return crypto.randomUUID();
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Prefixes a job-scoped correlation ID, distinguishing cron/worker runs from HTTP requests. */
export function newJobCorrelationId(jobKind: string): string {
  return `job-${jobKind}-${crypto.randomUUID()}`;
}
