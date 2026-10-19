import { afterEach, describe, expect, it, vi } from "vitest";
import * as policy from "@/lib/akiba/accountDeletionPolicy";
import { DELETION_IMPLEMENTATION_VERSION } from "@/lib/akiba/accountDeletionRetention";

import {
  deletionAvailability,
  isProcessingEnabled,
  isSubmissionEnabled,
} from "@/lib/akiba/accountDeletionAvailability";
import { reviewInventory } from "@/lib/akiba/accountDeletionPolicy";

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ACCOUNT_DELETION_SUBMISSION_ENABLED;
  delete process.env.ACCOUNT_DELETION_PROCESSING_ENABLED;
});

describe("deletion availability", () => {
  it("accepts nothing by default", () => {
    // §16 step 2 ships the public page with submission disabled; step 5
    // enables it. Default-off is what makes that order real rather than
    // advisory.
    expect(deletionAvailability(env())).toMatchObject({
      acceptingRequests: false,
      reason: "submission_disabled",
    });
  });

  it("reads both switches as plain truthy strings", () => {
    expect(isSubmissionEnabled(env({ ACCOUNT_DELETION_SUBMISSION_ENABLED: "true" }))).toBe(true);
    expect(isSubmissionEnabled(env({ ACCOUNT_DELETION_SUBMISSION_ENABLED: "1" }))).toBe(true);
    expect(isSubmissionEnabled(env({ ACCOUNT_DELETION_SUBMISSION_ENABLED: "off" }))).toBe(false);
    expect(isProcessingEnabled(env({ ACCOUNT_DELETION_PROCESSING_ENABLED: "yes" }))).toBe(true);
    expect(isProcessingEnabled(env({}))).toBe(false);
  });

  it("refuses while the retention inventory is unapproved, even with both switches on", () => {
    // This is the pairing that matters: acceptance and processing are gated
    // on the SAME conditions. The first implementation accepted requests the
    // worker was guaranteed to refuse, which signed the member out and
    // locked them out of an account nothing was going to process.
    const result = deletionAvailability(
      env({
        ACCOUNT_DELETION_SUBMISSION_ENABLED: "true",
        ACCOUNT_DELETION_PROCESSING_ENABLED: "true",
      }),
    );

    const review = reviewInventory();
    if (review.approved) {
      expect(result).toEqual({ acceptingRequests: false, reason: "implementation_unverified" });
      return;
    }

    expect(result).toMatchObject({
      acceptingRequests: false,
      reason: "retention_inventory_unapproved",
    });
    expect(result.acceptingRequests).toBe(false);
    if (!result.acceptingRequests) {
      expect(result.unapprovedRowIds).toEqual(review.unapprovedRowIds);
    }
  });

  it("gates on the exact version string and the expiry worker, then accepts", () => {
    // Migration 105 implemented the four shared-identity steps, so this no
    // longer stops at an absent executor (BDR-002). The remaining two
    // conditions are deliberate re-confirmations and both must hold.
    vi.spyOn(policy,"reviewInventory").mockReturnValue({approved:true});
    const configured={ACCOUNT_DELETION_SUBMISSION_ENABLED:"true",ACCOUNT_DELETION_PROCESSING_ENABLED:"true"};
    const verified={...configured,ACCOUNT_DELETION_IMPLEMENTATION_VERIFIED:DELETION_IMPLEMENTATION_VERSION};

    // Neither re-confirmation given.
    expect(deletionAvailability(env(configured)))
      .toMatchObject({acceptingRequests:false,reason:"implementation_unverified"});
    // A stale or guessed version string is not a confirmation.
    expect(deletionAvailability(env({...configured,ACCOUNT_DELETION_IMPLEMENTATION_VERIFIED:"2026-01-01.1",
      ACCOUNT_DELETION_EXPIRY_ENABLED:"true"})))
      .toMatchObject({acceptingRequests:false,reason:"implementation_unverified"});
    // Version confirmed, but nothing would ever expire the evidence.
    expect(deletionAvailability(env(verified)))
      .toMatchObject({acceptingRequests:false,reason:"implementation_unverified"});

    // All four gates satisfied. Note this is availability only: the worker's
    // own preflight still refuses every request unconditionally while the
    // shared-account scope review is outstanding — see BDR-002 §6.
    expect(deletionAvailability(env({...verified,ACCOUNT_DELETION_EXPIRY_ENABLED:"true"})))
      .toEqual({acceptingRequests:true});
  });

  it("reports the inventory blocker ahead of a paused worker", () => {
    // An operator who paused the worker for an incident should still see the
    // blocker that needs a decision rather than a restart.
    const result = deletionAvailability(env({ ACCOUNT_DELETION_SUBMISSION_ENABLED: "true" }));
    const review = reviewInventory();
    const expected = review.approved ? "processing_disabled" : "retention_inventory_unapproved";
    expect(result).toMatchObject({ acceptingRequests: false, reason: expected });
  });
});
