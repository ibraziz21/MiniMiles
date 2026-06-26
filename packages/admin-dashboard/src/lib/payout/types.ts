// Phase 5 payout provider abstraction — shared types.
// LIVE PAYOUT EXECUTION IS BLOCKED until M-Pesa B2C / Celo credentials exist.

export type PayoutProvider = "mpesa_b2c" | "celo" | "manual" | "test";
export type PayoutStatus = "submitted" | "confirmed" | "failed" | "uncertain";

export interface PayoutRequest {
  instructionId: string;
  idempotencyKey: string;
  destinationDetails: Record<string, string>; // decrypted in-memory only, never persisted
  amount: number;
  currency: string;
  reference: string;
}

export interface PayoutResult {
  providerReference: string;
  status: PayoutStatus;
  requestHash: string; // SHA-256 of sanitized (credential-free) request body
  responseHash: string; // SHA-256 of sanitized response
  failureCode?: string;
  failureReason?: string;
}

export interface PayoutStatusResult {
  providerReference: string;
  status: PayoutStatus;
  confirmedAmount?: number;
  confirmedCurrency?: string;
  failureCode?: string;
  failureReason?: string;
}

export interface ProviderCallbackPayload {
  providerName: PayoutProvider;
  providerReference: string;
  status: PayoutStatus;
  amount: number;
  currency: string;
  rawBodyHash: string;
  signatureVerified: boolean;
}
