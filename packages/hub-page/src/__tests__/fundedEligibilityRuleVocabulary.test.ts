/**
 * Static guard over the funded-voucher eligibility rule vocabulary.
 *
 * SIX places independently enumerate which rule types exist, across three
 * packages and two repositories:
 *
 *   MiniMiles migration 110
 *     1. claim_akiba_funded_voucher_atomic             — evaluates them
 *     2. validate_funded_voucher_rule_set_row          — allow-list on INSERT
 *     3. enforce_funded_voucher_claim_eligibility_audit — re-evaluates on INSERT
 *   Akiba-Platform
 *     4. create_voucher_eligibility_rule_set_atomic (152) — allow-list on authoring
 *     5. packages/api/lib/voucherFunding/eligibility.ts   — API preview + claim gate
 *   MiniMiles admin-dashboard
 *     6. ELIGIBILITY_RULE_TYPES (src/lib/voucherFunds.ts) — what an operator can pick
 *
 * The first version of this test only knew about the three in migration 110,
 * which is precisely why adding claim_day_of_week shipped with (4) and (5)
 * missing: the database was correct and both the authoring journey and the
 * customer journey were broken. (4) rejects the rule at creation with
 * UNSUPPORTED_ELIGIBILITY_RULE_TYPE; (5) fails it closed before Postgres is
 * reached, so eligibility previews and claims return
 * ELIGIBILITY_POLICY_UNAVAILABLE.
 *
 * No integration test can cover this. Asserting it requires a rule type that
 * is deliberately absent from one of the six, which is the bug itself — so it
 * is checked against the source text.
 *
 * Akiba-Platform is a sibling checkout (see docs/BDR-005). When it is absent
 * the Platform half is reported as skipped rather than silently passing.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const PLATFORM_ROOT = resolve(REPO_ROOT, "../Akiba-Platform");
const PLATFORM_AVAILABLE = existsSync(PLATFORM_ROOT);

const MIGRATION_110 = resolve(
  REPO_ROOT,
  "supabase/migrations/110_funded_percent_vouchers_weekend_claims.sql",
);
const ADMIN_RULE_TYPES = resolve(
  REPO_ROOT,
  "packages/admin-dashboard/src/lib/voucherFunds.ts",
);
const PLATFORM_AUTHORING_RPC = resolve(
  PLATFORM_ROOT,
  "supabase/migrations/152_claim_day_of_week_rule_authoring.sql",
);
const PLATFORM_API_EVALUATOR = resolve(
  PLATFORM_ROOT,
  "packages/api/lib/voucherFunding/eligibility.ts",
);

/**
 * Rule types an evaluator may handle without being authorable. These are
 * historical configurations kept as explicit fail-closed branches:
 * not_blocked has no trustworthy restriction source, so it must never be
 * creatable, but rows carrying it may still exist.
 */
const LEGACY_EVALUATOR_ONLY = new Set(["not_blocked"]);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** The slice of a SQL file defining one function, up to the next CREATE. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  expect(start, `${name} should be defined`).toBeGreaterThan(-1);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

/** Rule types a `v_allowed text[] := ARRAY[...]` allow-list accepts. */
function sqlAllowList(body: string, label: string): string[] {
  const match = body.match(/v_allowed\s+TEXT\[\]\s*:?=\s*ARRAY\[([\s\S]*?)\]/i);
  expect(match, `${label} should declare v_allowed`).toBeTruthy();
  return [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * Rule types a SQL evaluator branches on. Scoped to the `CASE <discriminant>`
 * block that dispatches on the rule type, so an unrelated CASE in the same
 * function (claim-mode dispatch, for one) is not mistaken for rules.
 */
function sqlHandledTypes(body: string, discriminant: string): string[] {
  const start = body.indexOf(`CASE ${discriminant}`);
  expect(start, `expected a CASE ${discriminant} block`).toBeGreaterThan(-1);
  const end = body.indexOf("END CASE", start);
  expect(end, `expected CASE ${discriminant} to be closed`).toBeGreaterThan(start);
  return [...body.slice(start, end).matchAll(/WHEN\s+'([a-z_]+)'\s+THEN/g)].map((m) => m[1]);
}

/** Rule types the TypeScript evaluator's switch handles. */
function tsSwitchCases(source: string): string[] {
  return [...source.matchAll(/case\s+'([a-z_]+)':/g)].map((m) => m[1]);
}

/** Rule types the admin dashboard offers an operator. */
function adminRuleTypes(source: string): string[] {
  const match = source.match(/ELIGIBILITY_RULE_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  expect(match, "admin-dashboard should declare ELIGIBILITY_RULE_TYPES").toBeTruthy();
  return [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const migration110 = read(MIGRATION_110);

/** (2) — the authoring allow-list that defines what is creatable at all. */
const allowList = sqlAllowList(
  functionBody(migration110, "validate_funded_voucher_rule_set_row"),
  "validate_funded_voucher_rule_set_row",
);

/** The evaluators that must understand everything authorable. */
const evaluators: Array<{ label: string; handled: string[] }> = [
  {
    label: "claim RPC (MiniMiles 110)",
    handled: sqlHandledTypes(
      functionBody(migration110, "claim_akiba_funded_voucher_atomic"),
      "v_rule_type",
    ),
  },
  {
    label: "claim-insert audit trigger (MiniMiles 110)",
    handled: sqlHandledTypes(
      functionBody(migration110, "enforce_funded_voucher_claim_eligibility_audit"),
      "v_type",
    ),
  },
];

if (PLATFORM_AVAILABLE) {
  evaluators.push({
    label: "Platform API evaluator (packages/api/lib/voucherFunding/eligibility.ts)",
    handled: tsSwitchCases(read(PLATFORM_API_EVALUATOR)),
  });
}

describe("funded eligibility rule vocabulary", () => {
  it("extracts a non-trivial set from every definition", () => {
    // Guards the extractors themselves: a regex that silently stopped
    // matching would make every assertion below vacuously true.
    expect(allowList.length).toBeGreaterThan(5);
    for (const { label, handled } of evaluators) {
      expect(handled.length, `${label} yielded too few rule types`).toBeGreaterThan(5);
    }
  });

  it("has no duplicate entries in the allow-list", () => {
    expect(allowList).toEqual([...new Set(allowList)]);
  });

  it.each(evaluators.map((e) => [e.label, e.handled] as const))(
    "every authorable rule type is evaluated by the %s",
    (label, handled) => {
      const missing = allowList.filter((type) => !handled.includes(type));
      expect(
        missing,
        `authorable but unhandled in ${label} — these fail closed and look like "nobody is eligible"`,
      ).toEqual([]);
    },
  );

  it.each(evaluators.map((e) => [e.label, e.handled] as const))(
    "the %s evaluates nothing authorable-looking that is not allow-listed",
    (label, handled) => {
      const extra = handled.filter(
        (type) => !allowList.includes(type) && !LEGACY_EVALUATOR_ONLY.has(type),
      );
      expect(
        extra,
        `${label} evaluates rule types that cannot be authored — allow-list them or drop the branch`,
      ).toEqual([]);
    },
  );

  it("offers the operator exactly what is authorable", () => {
    // The admin list may carry not_blocked for rendering a historical
    // allocation, but isValidEligibilityRule refuses to create one.
    const operatorTypes = adminRuleTypes(read(ADMIN_RULE_TYPES)).filter(
      (type) => !LEGACY_EVALUATOR_ONLY.has(type),
    );
    expect([...operatorTypes].sort()).toEqual([...allowList].sort());
  });

  it("keeps not_blocked unauthorable while still handled", () => {
    expect(allowList).not.toContain("not_blocked");
    expect(evaluators[0].handled).toContain("not_blocked");
  });

  it.runIf(PLATFORM_AVAILABLE)(
    "the Platform authoring RPC accepts exactly the authorable set",
    () => {
      // This is the one an operator actually hits: the Admin Dashboard calls
      // create_voucher_eligibility_rule_set_atomic rather than inserting rows,
      // so a type missing here cannot be created even though the row trigger
      // would have accepted it.
      const platformAllowList = sqlAllowList(
        functionBody(read(PLATFORM_AUTHORING_RPC), "create_voucher_eligibility_rule_set_atomic"),
        "create_voucher_eligibility_rule_set_atomic",
      );
      expect([...platformAllowList].sort()).toEqual([...allowList].sort());
    },
  );

  it("includes claim_day_of_week everywhere", () => {
    expect(allowList).toContain("claim_day_of_week");
    for (const { label, handled } of evaluators) {
      expect(handled, `${label} is missing claim_day_of_week`).toContain("claim_day_of_week");
    }
  });

  it.skipIf(PLATFORM_AVAILABLE)(
    "reports the Akiba-Platform definitions as unverified when that checkout is absent",
    () => {
      // Deliberately visible rather than silent: two of the six definitions
      // live there, and both gate the customer journey.
      console.warn(
        `[vocabulary] Akiba-Platform not found at ${PLATFORM_ROOT} — the authoring RPC and API evaluator were NOT checked.`,
      );
      expect(PLATFORM_AVAILABLE).toBe(false);
    },
  );
});
