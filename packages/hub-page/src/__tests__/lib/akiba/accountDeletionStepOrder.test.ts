import { readFileSync, readdirSync } from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { DELETION_INVENTORY } from "@/lib/akiba/accountDeletionPolicy";
import { IMPLEMENTED_DELETION_STEPS } from "@/lib/akiba/accountDeletionRetention";
import { STEP_ORDER, hasStepExecutor } from "@/lib/akiba/accountDeletionWorker";

/**
 * Static verification of the deletion worker against the *real* schema.
 *
 * The mocked worker tests cannot catch an ordering mistake: a fake query
 * builder has no foreign keys, so deleting a parent before its children
 * passes there and fails in production. None of the relevant constraints
 * cascade, so these checks read the actual migration SQL and compare it with
 * the order the worker declares.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "../../supabase/migrations");

type ForeignKey = { child: string; parent: string };

/**
 * Child → parent pairs from every `CREATE TABLE` block in the migrations.
 * Deliberately crude: it only needs to find `REFERENCES <table>` inside a
 * table body, which is how every FK in this schema is declared.
 */
function readForeignKeys(): ForeignKey[] {
  const keys: ForeignKey[] = [];
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const blocks = sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\s*\);/gi,
    );
    for (const block of blocks) {
      const child = block[1];
      const body = block[2];
      for (const reference of body.matchAll(/references\s+(?:public\.)?([a-z_.]+)\s*\(/gi)) {
        const parent = reference[1];
        // Self-references (merged_into_item_id and friends) say nothing about
        // cross-table ordering.
        if (parent !== child) keys.push({ child, parent });
      }
    }
  }
  return keys;
}

const FOREIGN_KEYS = readForeignKeys();

/** Step index for a table, from the inventory's declared targets. */
function stepIndexForTable(table: string): number | null {
  for (let index = 0; index < STEP_ORDER.length; index += 1) {
    const row = DELETION_INVENTORY.find((candidate) => candidate.id === STEP_ORDER[index]);
    if (row?.targets.includes(table)) return index;
  }
  return null;
}

describe("deletion worker schema compatibility", () => {
  it("reads a non-trivial foreign-key graph from the migrations", () => {
    // Guards the parser itself: if the regex stops matching, every check
    // below would pass vacuously.
    expect(FOREIGN_KEYS.length).toBeGreaterThan(50);
    expect(FOREIGN_KEYS).toEqual(
      expect.arrayContaining([
        { child: "photo_processing_jobs", parent: "merchant_visit_photos" },
        { child: "merchant_visit_photos", parent: "merchant_discovery_contributions" },
        { child: "merchant_discovery_contributions", parent: "discovery_contribution_requests" },
        { child: "web_push_deliveries", parent: "web_push_subscriptions" },
        { child: "hub_referrals", parent: "hub_user_passes" },
        { child: "discovery_moderation_audit_events", parent: "merchant_visit_photos" },
      ]),
    );
  });

  it("gives every executable inventory row a position in the order", () => {
    const positioned = new Set(STEP_ORDER);
    const executable = DELETION_INVENTORY.filter(
      (row) => row.action !== "immutable" && row.action !== "processor",
    );
    for (const row of executable) {
      expect(positioned.has(row.id)).toBe(true);
    }
  });

  it("never deletes a parent table before its children", () => {
    // The original implementation deleted discovery_contribution_requests
    // before merchant_discovery_contributions, which is a NOT NULL reference
    // with no ON DELETE action — a guaranteed constraint violation.
    const violations: string[] = [];

    for (const { child, parent } of FOREIGN_KEYS) {
      const parentStep = stepIndexForTable(parent);
      if (parentStep === null) continue;

      const childStep = stepIndexForTable(child);
      if (childStep === null) {
        // A table referencing something the worker deletes, which the worker
        // never touches, blocks that delete. It is only acceptable when the
        // inventory has recorded it as an unresolved conflict.
        const parentRow = DELETION_INVENTORY.find(
          (row) => row.id === STEP_ORDER[parentStep],
        );
        if (parentRow?.retention !== null) {
          violations.push(
            `${child} references ${parent}, but ${parent}'s step (${parentRow?.id}) claims an approved delete and nothing removes ${child}`,
          );
        }
        continue;
      }

      if (childStep > parentStep) {
        violations.push(
          `${child} (step ${STEP_ORDER[childStep]}) is deleted after its parent ${parent} (step ${STEP_ORDER[parentStep]})`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("only claims an approved delete for a table nothing else depends on", () => {
    // Every row that still asserts an approved action must have no unhandled
    // dependents, or the worker would fail on a constraint the first time it
    // runs for real.
    const unresolved: string[] = [];

    for (const row of DELETION_INVENTORY) {
      if (row.retention === null) continue;
      for (const target of row.targets) {
        if (target.startsWith("storage:") || target.startsWith("processor:") || target.startsWith("chain:")) {
          continue;
        }
        const dependents = FOREIGN_KEYS.filter((key) => key.parent === target).map((key) => key.child);
        for (const dependent of dependents) {
          if (stepIndexForTable(dependent) === null) {
            unresolved.push(`${row.id}: ${dependent} still references ${target}`);
          }
        }
      }
    }

    expect(unresolved).toEqual([]);
  });

  it("has an executor for every table an approved row promises to clear", () => {
    // Catches the inventory promising more than the code does — the original
    // `unpublished_contributions` row listed photo_processing_jobs while its
    // executor only touched discovery_contribution_requests.
    const workerSource = readFileSync(
      path.resolve(process.cwd(), "src/lib/akiba/accountDeletionWorker.ts"),
      "utf8",
    );
    const missing: string[] = [];

    for (const row of DELETION_INVENTORY) {
      if (row.retention === null || !hasStepExecutor(row.id)) continue;
      for (const target of row.targets) {
        const table = target.startsWith("storage:") ? target.slice("storage:".length) : target;
        if (!workerSource.includes(table)) missing.push(`${row.id}: ${target}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("deletes Storage objects before any step that removes the rows holding their keys", () => {
    expect(STEP_ORDER.indexOf("member_photo_objects")).toBeLessThan(
      STEP_ORDER.indexOf("published_photos"),
    );
    expect(STEP_ORDER.indexOf("member_photo_objects")).toBeGreaterThanOrEqual(0);
  });

  it("deletes the Auth identity last", () => {
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe("auth_identity");
  });

  it("releases every auth.users reference before deleting the Auth identity", () => {
    // The irreversible step. `never deletes a parent before its children`
    // cannot cover this one: it skips a child with no step whenever the
    // parent's row is still unapproved, and auth_identity's row is. So a
    // table referencing auth.users that nothing clears would pass there and
    // fail in production on a constraint — after every earlier step has
    // already destroyed the member's data and with no way back.
    const authStep = STEP_ORDER.indexOf("auth_identity");
    expect(authStep).toBeGreaterThan(0);

    const dependents = [...new Set(
      FOREIGN_KEYS.filter((key) => key.parent === "auth.users").map((key) => key.child),
    )];
    // Guards the filter: a parser change that stops matching `auth.users`
    // would empty this list and make the assertion vacuous.
    expect(dependents.length).toBeGreaterThan(20);

    const stranded = dependents.filter((table) => {
      const step = stepIndexForTable(table);
      return step === null || step >= authStep;
    });

    expect(stranded).toEqual([]);
  });

  it("clears the canonical mapping before the Auth identity it references", () => {
    // hub_user_canonicals.hub_user_id references auth.users, and the mapping
    // is what resolves a member to the canonical id the shared projections
    // are keyed by. Both reasons put it strictly earlier.
    expect(STEP_ORDER.indexOf("canonical_identity")).toBeLessThan(
      STEP_ORDER.indexOf("auth_identity"),
    );
    expect(STEP_ORDER.indexOf("shared_profile_projection")).toBeLessThan(
      STEP_ORDER.indexOf("canonical_identity"),
    );
  });

  it("does not pretend to have checked the shared Platform tables", () => {
    // identity_links and miles_ledger are Akiba-Platform's, defined in no
    // migration here, so the foreign-key graph above says nothing about
    // them and the ordering checks silently skip them. That is a real limit
    // of this test, recorded rather than left to be assumed away.
    //
    // If this fails, the tables are now defined in this repo: drop the
    // exemption and let the ordering checks cover them for real.
    const shared = ["identity_links", "miles_ledger"];
    const seen = FOREIGN_KEYS.filter(
      (key) => shared.includes(key.child) || shared.includes(key.parent),
    );
    expect(seen).toEqual([]);

    // They are still the canonical_identity step's declared targets, so the
    // inventory and the migration must not drift apart unnoticed.
    const row = DELETION_INVENTORY.find((candidate) => candidate.id === "canonical_identity");
    expect(row?.targets).toEqual(shared);
  });
});

/**
 * `IMPLEMENTED_DELETION_STEPS` is a hand-maintained claim, and guard 2 trusts
 * it: a step listed there runs instead of failing visibly. Nothing otherwise
 * checks the SQL agrees. `canonical_identity` shipped in 103 registered in
 * the executor map while its only body was `RAISE EXCEPTION`, which is the
 * shape of bug these checks exist to catch.
 */
describe("database deletion steps match the latest migration", () => {
  /** The newest migration that (re)defines the step function. */
  function latestStepFunctionSql(): string {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    let found: string | null = null;
    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      if (/function\s+public\.execute_account_deletion_step\s*\(/i.test(sql)) found = sql;
    }
    if (!found) throw new Error("no migration defines execute_account_deletion_step");
    return found;
  }

  const STEP_SQL = latestStepFunctionSql();

  /** Step ids the worker delegates to the database function. */
  function databaseStepIds(): string[] {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/lib/akiba/accountDeletionWorker.ts"),
      "utf8",
    );
    return [...source.matchAll(/databaseStep\("([a-z_]+)"\)/g)].map((match) => match[1]);
  }

  it("delegates a non-trivial number of steps to the database", () => {
    expect(databaseStepIds().length).toBeGreaterThan(10);
  });

  it("has a CASE branch for every step the worker delegates", () => {
    const missing = databaseStepIds().filter(
      (step) => !new RegExp(`WHEN\\s+'${step}'\\s+THEN`).test(STEP_SQL),
    );
    expect(missing).toEqual([]);
  });

  it("never registers a step whose only body raises out of scope", () => {
    // A branch that just raises is a placeholder. It is legitimate while the
    // step is unregistered, and a lie once it is in the implemented set.
    const offenders: string[] = [];

    for (const step of databaseStepIds()) {
      if (!IMPLEMENTED_DELETION_STEPS.has(step)) continue;
      const branch = new RegExp(
        `WHEN\\s+'${step}'\\s+THEN([\\s\\S]*?)(?=\\n  WHEN\\s+'|\\n  ELSE\\s)`,
      ).exec(STEP_SQL)?.[1];
      if (branch === undefined) continue;
      const statements = branch
        .split("\n")
        .map((line) => line.replace(/--.*$/, "").trim())
        .filter(Boolean);
      const onlyRaises =
        statements.length > 0 && statements.every((line) => /^RAISE\b|^USING\b/i.test(line));
      if (onlyRaises) offenders.push(step);
    }

    expect(offenders).toEqual([]);
  });
});
