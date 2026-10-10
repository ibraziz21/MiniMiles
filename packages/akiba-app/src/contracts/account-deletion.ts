import { z } from 'zod';

// Source: hub-page's /api/v1/me/account-deletion* routes (AKIBA-MOB-002 §7).

// §7.1 — a fresh server projection of what the member stands to lose.
// Counts only: the server never sends wallet addresses, voucher codes, or
// ledger rows here, so there is nothing identifying for this screen to leak.
export const accountDeletionSummarySchema = z.object({
  maskedEmail: z.string(),
  milesBalance: z.number(),
  activeVoucherCount: z.number().int().nonnegative(),
  linkedWalletCount: z.number().int().nonnegative(),
  processingTargetDays: z.number().int().positive(),
  // Always true. Akiba can never erase a Celo record, so this is a statement
  // of fact rather than a per-member computation.
  onChainRecordsRemain: z.literal(true),
  /**
   * False while the server cannot carry a request out — submission switched
   * off, or the retention inventory not yet approved. The screen shows the
   * support fallback instead of a Continue button, rather than letting the
   * member read every disclosure and then be refused. Defaulted to false so
   * an older server that omits the field fails safe.
   */
  acceptingRequests: z.boolean().default(false),
});

export type AccountDeletionSummary = z.infer<typeof accountDeletionSummarySchema>;

// §7.2 — the email-ownership challenge. No code is ever returned; this is
// just the window the member has to use the one Supabase emailed them.
export const accountDeletionChallengeSchema = z.object({
  challengeId: z.string(),
  maskedEmail: z.string(),
  expiresAt: z.string(),
  resendAvailableAt: z.string(),
});

export type AccountDeletionChallenge = z.infer<typeof accountDeletionChallengeSchema>;

export const deletionRequestStatusSchema = z.enum([
  'requested',
  'processing',
  'legal_hold',
  'failed',
  'completed',
  'cancelled',
]);

// §7.3 — the durable receipt. `alreadyRequested` is how a retry after a
// dropped response is distinguished from a fresh submission; both are
// successes, and both carry the original request's timestamps.
export const accountDeletionReceiptSchema = z.object({
  requestId: z.string(),
  status: deletionRequestStatusSchema,
  requestedAt: z.string(),
  targetCompletionAt: z.string(),
  alreadyRequested: z.boolean(),
});

export type AccountDeletionReceipt = z.infer<typeof accountDeletionReceiptSchema>;
