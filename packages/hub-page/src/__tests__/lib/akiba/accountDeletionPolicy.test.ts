import { describe, expect, it } from "vitest";

import {
  DELETION_INVENTORY,
  DELETION_POLICY_VERSION,
  InventoryNotApprovedError,
  PROCESSING_TARGET_DAYS,
  assertInventoryApproved,
  executableInventoryRows,
  reviewInventory,
  unapprovedInventoryRows,
} from "@/lib/akiba/accountDeletionPolicy";

describe("deletion policy constants", () => {
  it("publishes the 14-day processing target the member copy promises", () => {
    expect(PROCESSING_TARGET_DAYS).toBe(14);
  });

  it("has a non-empty policy version for the acknowledgement contract", () => {
    expect(DELETION_POLICY_VERSION).toMatch(/\S/);
  });
});

describe("retention inventory", () => {
  it("covers every data class with a unique id and at least one target", () => {
    const ids = DELETION_INVENTORY.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of DELETION_INVENTORY) {
      expect(row.targets.length).toBeGreaterThan(0);
      expect(row.dataClass).toMatch(/\S/);
    }
  });

  it("names a complete retention contract for every approved row", () => {
    // §9 requires purpose, basis, period, fields, method, roles, processor,
    // region, cadence and end-of-period action — an approved row missing any
    // of them is not actually approved.
    for (const row of DELETION_INVENTORY) {
      if (!row.retention) continue;
      expect(row.retention.purpose).toMatch(/\S/);
      expect(row.retention.lawfulBasis).toMatch(/\S/);
      expect(typeof row.retention.periodDays).toBe("number");
      expect(row.retention.pseudonymizationMethod).toMatch(/\S/);
      expect(row.retention.processor).toMatch(/\S/);
      expect(row.retention.storageRegion).toMatch(/\S/);
      expect(row.retention.reviewCadence).toMatch(/\S/);
      expect(row.retention.endOfPeriodAction).toMatch(/\S/);
    }
  });

  it("records Celo data as immutable, never as deleted", () => {
    const onchain = DELETION_INVENTORY.find((row) => row.id === "onchain");
    expect(onchain?.action).toBe("immutable");
  });

  it("records the proven schema conflict on published member content", () => {
    // §9 says delete by default, but discovery_moderation_audit_events.photo_id
    // is NOT NULL against an append-only table, so a moderated photo's row
    // cannot be deleted. Both remaining options are forms of retention, and
    // choosing between them is the approval — so the row must be unapproved
    // rather than claiming a delete the database will refuse.
    const published = DELETION_INVENTORY.find((row) => row.id === "published_photos");
    expect(published?.action).toBe("pseudonymize");
    expect(published?.retention).toBeNull();
    expect(published?.notes).toMatch(/discovery_moderation_audit_events/);

    // The image bytes still go unconditionally, whichever way it resolves.
    const objects = DELETION_INVENTORY.find((row) => row.id === "member_photo_objects");
    expect(objects?.action).toBe("delete");
    expect(objects?.retention).not.toBeNull();
  });

  it("names the foreign key blocking each schema-contingent row", () => {
    // These are not missing retention periods — they are dependencies the
    // database will enforce, so the note has to say which one.
    const pass = DELETION_INVENTORY.find((row) => row.id === "pass_credentials");
    expect(pass?.retention).toBeNull();
    expect(pass?.notes).toMatch(/hub_referrals\.referred_pass_id/);

    const unpublished = DELETION_INVENTORY.find((row) => row.id === "unpublished_contributions");
    expect(unpublished?.retention).toBeNull();
    expect(unpublished?.notes).toMatch(/merchant_visit_photos\.contribution_id/);
  });

  it("leaves immutable and processor-owned classes out of what the worker executes", () => {
    const executable = executableInventoryRows().map((row) => row.id);
    expect(executable).not.toContain("onchain");
    expect(executable).not.toContain("analytics");
    expect(executable).toContain("auth_identity");
  });

  it("blocks processing while any row is unapproved, naming the rows", () => {
    // This is the §9 gate, asserted against the inventory as it actually
    // ships: rows awaiting the data-protection owner must stop the worker.
    const review = reviewInventory();
    const pending = unapprovedInventoryRows();

    if (pending.length === 0) {
      expect(review.approved).toBe(true);
      expect(() => assertInventoryApproved()).not.toThrow();
      return;
    }

    expect(review.approved).toBe(false);
    expect(() => assertInventoryApproved()).toThrow(InventoryNotApprovedError);
    try {
      assertInventoryApproved();
    } catch (error) {
      expect((error as InventoryNotApprovedError).unapprovedRowIds).toEqual(
        pending.map((row) => row.id),
      );
    }
  });

  it("gives every unapproved row a note saying what decision is missing", () => {
    for (const row of unapprovedInventoryRows()) {
      expect(row.notes).toMatch(/TBD/);
    }
  });
});
