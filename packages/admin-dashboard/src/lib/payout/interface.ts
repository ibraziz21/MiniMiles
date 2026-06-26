import type {
  PayoutRequest,
  PayoutResult,
  PayoutStatusResult,
  ProviderCallbackPayload,
} from "./types";

/**
 * Provider-agnostic payout interface. Every concrete provider (test, manual,
 * mpesa_b2c, celo) implements this. Credentials never leave the adapter; the
 * sanitizeForLog hook guarantees no secrets reach hashes or audit logs.
 */
export interface IPayoutProvider {
  readonly name: string;
  /** False when required credentials/env are not provisioned (blocks live execution). */
  readonly isConfigured: boolean;

  /** Initiate a payout. Throws if the provider is not configured. */
  initiatePayout(req: PayoutRequest): Promise<PayoutResult>;

  /** Poll the provider for the current status of a previously-submitted payout. */
  queryPayoutStatus(providerReference: string): Promise<PayoutStatusResult>;

  /** Verify a webhook callback signature against the raw body. */
  verifyCallback(headers: Record<string, string>, rawBody: string): boolean;

  /** Parse a verified callback body into a normalized payload. */
  parseCallback(rawBody: string, rawBodyHash: string): ProviderCallbackPayload;

  /** Strip credentials/PII from an object before it is hashed or logged. */
  sanitizeForLog(body: unknown): unknown;
}
