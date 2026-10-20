/**
 * Whether Akiba can accept a deletion request *right now*.
 *
 * This closes a trap the first implementation left open. The request route
 * returned 202 and the pending-account guard immediately locked the member
 * out of every protected route — while the worker refused to process
 * anything, because processing is disabled by default and blocked by the
 * unapproved retention inventory. A member could therefore be signed out and
 * shut out of their account by a request that was never going to be carried
 * out.
 *
 * So acceptance and processing are gated on the *same* conditions, and
 * acceptance is the stricter of the two to reason about: if the worker
 * cannot run, the request is not accepted. That also matches the spec's own
 * rollout order (§16 step 2: ship the public page "with deletion submission
 * disabled", step 5: enable submission), which the original implementation
 * skipped.
 */
import { executableInventoryRows, reviewInventory } from "@/lib/akiba/accountDeletionPolicy";
import { DELETION_IMPLEMENTATION_VERSION, IMPLEMENTED_DELETION_STEPS } from "@/lib/akiba/accountDeletionRetention";
import { adminExecutionConfigBlockers } from "./accountDeletionAdminConfig";

export type DeletionUnavailableReason =
  /** The operator switch is off — §16 step 5 has not happened yet. */
  | "submission_disabled"
  /** §9: processing may not run while any retention row is unapproved. */
  | "retention_inventory_unapproved"
  /** Processing is switched off, so accepting a request would strand it. */
  | "processing_disabled"
  | "implementation_unverified";

export type DeletionAvailability =
  | { acceptingRequests: true }
  | { acceptingRequests: false; reason: DeletionUnavailableReason; unapprovedRowIds?: string[] };

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function isProcessingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.ACCOUNT_DELETION_PROCESSING_ENABLED);
}

export function isSubmissionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.ACCOUNT_DELETION_SUBMISSION_ENABLED);
}

export function deletionAvailability(env: NodeJS.ProcessEnv = process.env): DeletionAvailability {
  if (!isSubmissionEnabled(env)) {
    return { acceptingRequests: false, reason: "submission_disabled" };
  }

  const review = reviewInventory();
  if (!review.approved) {
    return {
      acceptingRequests: false,
      reason: "retention_inventory_unapproved",
      unapprovedRowIds: review.unapprovedRowIds,
    };
  }

  // Deliberately checked after the inventory: an operator who has paused the
  // worker for an incident should still see the inventory blocker first,
  // since it is the one that needs a decision rather than a restart.
  if (!isProcessingEnabled(env)) {
    return { acceptingRequests: false, reason: "processing_disabled" };
  }

  if (executableInventoryRows().some((row) => !IMPLEMENTED_DELETION_STEPS.has(row.id)) ||
      env.ACCOUNT_DELETION_IMPLEMENTATION_VERIFIED !== DELETION_IMPLEMENTATION_VERSION ||
      env.ACCOUNT_DELETION_EXPIRY_ENABLED !== "true") {
    return { acceptingRequests: false, reason: "implementation_unverified" };
  }

  return { acceptingRequests: true };
}

/**
 * How a request would be carried out if one arrived now.
 *
 * `manual` is the escape hatch for the state this deployment is actually in:
 * the native-only scope decision holds the automated pipeline closed, but Play
 * requires a working in-app deletion path regardless, and Google accepts a
 * request form fulfilled by a human. See BDR-003.
 *
 * Deliberately a separate function rather than a fourth `DeletionAvailability`
 * case: `acceptingRequests` means "the worker will do this", and every caller
 * that branches on it is right to keep meaning that.
 */
export type FulfilmentMode = "automated" | "manual" | "unavailable";

export function isManualFulfilmentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.ACCOUNT_DELETION_MANUAL_FULFILMENT_ENABLED);
}

export function deletionFulfilmentMode(env: NodeJS.ProcessEnv = process.env): FulfilmentMode {
  if (deletionAvailability(env).acceptingRequests) return "automated";
  // Still gated on the submission switch, so one flag stops everything —
  // enabling manual fulfilment must not quietly reopen a path an operator
  // closed for an incident.
  if (isSubmissionEnabled(env) && isManualFulfilmentEnabled(env) && adminExecutionConfigBlockers(env).length === 0) return "manual";
  return "unavailable";
}
