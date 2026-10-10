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
import { reviewInventory } from "@/lib/akiba/accountDeletionPolicy";

export type DeletionUnavailableReason =
  /** The operator switch is off — §16 step 5 has not happened yet. */
  | "submission_disabled"
  /** §9: processing may not run while any retention row is unapproved. */
  | "retention_inventory_unapproved"
  /** Processing is switched off, so accepting a request would strand it. */
  | "processing_disabled";

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

  return { acceptingRequests: true };
}
