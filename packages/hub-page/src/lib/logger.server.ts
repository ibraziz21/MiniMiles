/**
 * Structured, sanitized server-side event logging
 * (production-readiness-security-spec.md §11.1).
 *
 * Every event is a flat, JSON-serializable record carrying a correlation ID.
 * Field names that commonly carry PII/secrets are rejected at call time
 * instead of trusting every call site to remember to redact them.
 */

const FORBIDDEN_FIELD_NAMES = [
  "email",
  "wallet",
  "walletaddress",
  "address",
  "phone",
  "phonenumber",
  "msisdn",
  "signature",
  "nonce",
  "fulfillmentaddress",
  "rawcallback",
  "callback",
  "authtoken",
  "token",
  "secret",
  "password",
];

function isForbiddenField(key: string): boolean {
  const normalized = key.toLowerCase();
  return FORBIDDEN_FIELD_NAMES.some((forbidden) => normalized.includes(forbidden));
}

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type StructuredEvent = {
  /** e.g. "wallet_challenge_created", "mpesa_stk_initiated", "internal_event_claimed" */
  event: string;
  correlationId: string;
  /** "info" | "warn" | "error" — defaults to "info" */
  level?: "info" | "warn" | "error";
  fields?: LogFields;
};

/**
 * Logs one structured event line. Throws in development if a field name
 * looks like it carries PII/secrets, so the mistake is caught before it
 * ships; in production it strips the field and logs a redaction marker
 * instead of losing the whole event.
 */
export function logEvent({ event, correlationId, level = "info", fields = {} }: StructuredEvent): void {
  const safeFields: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isForbiddenField(key)) {
      if (process.env.NODE_ENV !== "production") {
        throw new Error(
          `[logger] Refusing to log field "${key}" for event "${event}" — looks like PII/secret. Rename or hash it.`
        );
      }
      safeFields[key] = "[redacted]";
      continue;
    }
    safeFields[key] = value;
  }

  const record = {
    event,
    correlationId,
    level,
    timestamp: new Date().toISOString(),
    ...safeFields,
  };

  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
