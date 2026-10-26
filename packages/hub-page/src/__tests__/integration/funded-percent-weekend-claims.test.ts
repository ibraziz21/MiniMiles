/**
 * Integration tests for percentage-benefit Akiba-funded vouchers and the
 * claim_day_of_week eligibility rule.
 *
 * Covers:
 *   - MiniMiles 110: discount_percent/maximum_discount_kes reach the claim-time
 *     rules snapshot (the till reads the benefit from there, not the template);
 *     a percent template missing either field is refused at claim time;
 *     claim_day_of_week is accepted by the authoring allow-list, validated,
 *     and enforced on the local calendar day.
 *   - Akiba-Platform 151: the allocation authoring RPC can produce a
 *     percent_off template, derives the per-voucher reimbursement ceiling from
 *     the cap, and refuses an uncapped percentage.
 *
 * The funded-voucher schema comes from the real Akiba-Platform migrations
 * rather than a hand-written copy, so the constraints exercised here are the
 * live ones. Akiba-Platform is expected to sit beside MiniMiles; if it does
 * not, the suite skips rather than failing, since the Platform half of this
 * change cannot be verified without it.
 *
 * Requires postgres to be running:
 *   pg_isready → should report "accepting connections"
 * The test creates and tears down "hub_funded_percent_test" automatically.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

const { Pool } = pg;

const REPO_ROOT = resolve(__dirname, "../../../../..");
const PLATFORM_MIGRATIONS = resolve(REPO_ROOT, "../Akiba-Platform/supabase/migrations");
const PLATFORM_AVAILABLE = existsSync(PLATFORM_MIGRATIONS);

const DB_NAME = "hub_funded_percent_test";
const ADMIN_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "postgres",
};
const DB_CONFIG = { ...ADMIN_CONFIG, database: DB_NAME };

const FIXTURE = resolve(__dirname, "fixtures/funded-voucher-prerequisites.sql");

/**
 * 086 creates the KES voucher runtime; it also builds merchant tables that
 * reach further back into Platform history than this test needs, so it is
 * applied statement-tolerantly. Everything after it must apply cleanly.
 */
const PLATFORM_TOLERANT = ["086_kes_voucher_runtime.sql"];
const PLATFORM_STRICT = [
  "115_voucher_funding_foundation.sql",
  "117_voucher_funding_allocation_lifecycle.sql",
  "123_voucher_funding_country_normalization.sql",
  "124_spend_voucher_templates_allow_zero_miles_cost.sql",
  // 147-149 are the funded-claim hardening chain: they add hub_user_id and
  // username_at_claim, and define the claim RPC and the two eligibility
  // triggers that MiniMiles 110 then supersedes. Applied in that order so the
  // test replays the real production sequence, 110 last.
  "147_funded_voucher_claim_phase1_hardening.sql",
  "148_funded_voucher_claim_corrective_hardening.sql",
  "149_funded_voucher_eligibility_audit_hardening.sql",
  "151_funded_percent_benefit_allocations.sql",
  // 152 teaches the rule-set AUTHORING rpc about claim_day_of_week. Without
  // it an operator cannot create a weekend rule at all, which is invisible to
  // any test that inserts rule-set rows directly — see createRuleSet.
  "152_claim_day_of_week_rule_authoring.sql",
];
const MINIMILES_MIGRATIONS = [
  "supabase/migrations/110_funded_percent_vouchers_weekend_claims.sql",
].map((p) => resolve(REPO_ROOT, p));

let pool: pg.Pool;

/** Seeded identities, reused across tests. */
const MERCHANT_ID = randomUUID();
const PROGRAM_ID = randomUUID();
const ACTOR_ID = randomUUID();

/** Applies a file, optionally ignoring per-statement failures. */
async function applySql(sql: string, tolerant: boolean) {
  if (!tolerant) {
    await pool.query(sql);
    return;
  }
  // Statement-at-a-time so a prerequisite we deliberately did not stub does
  // not abort the statements after it.
  const client = await pool.connect();
  try {
    for (const statement of splitStatements(sql)) {
      try {
        await client.query(statement);
      } catch {
        /* expected for out-of-scope prerequisites */
      }
    }
  } finally {
    client.release();
  }
}

/** Minimal splitter: handles the $$-quoted bodies these migrations use. */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    const dollarCount = (line.match(/\$\$/g) ?? []).length;
    buffer += line + "\n";
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trimEnd().endsWith(";")) {
      if (buffer.trim()) out.push(buffer);
      buffer = "";
    }
  }
  if (buffer.trim()) out.push(buffer);
  return out;
}

/** A fresh member with everything the claim path requires of an identity. */
async function seedMember(): Promise<{ hubUserId: string; canonicalId: string }> {
  const hubUserId = randomUUID();
  const canonicalId = randomUUID();
  await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
    hubUserId,
    `${hubUserId}@example.test`,
  ]);
  await pool.query(
    "INSERT INTO hub_user_canonicals(hub_user_id,canonical_id) VALUES($1,$2)",
    [hubUserId, canonicalId],
  );
  await pool.query(
    "INSERT INTO hub_user_profiles(user_id,country_code) VALUES($1,'KE')",
    [hubUserId],
  );
  await pool.query("INSERT INTO hub_user_passes(user_id) VALUES($1)", [hubUserId]);
  await pool.query(
    "INSERT INTO leaderboard_profiles(canonical_id,username) VALUES($1,$2)",
    [canonicalId, `member_${hubUserId.slice(0, 8)}`],
  );
  return { hubUserId, canonicalId };
}

/**
 * Creates a rule set the way the Admin Dashboard does — through
 * create_voucher_eligibility_rule_set_atomic — returning its id, or throwing
 * the DB error verbatim.
 *
 * Going through the RPC rather than INSERTing the row directly is deliberate:
 * the RPC keeps its own allow-list (Akiba-Platform 152), separate from the
 * row trigger's, and an earlier version of this suite inserted rows directly
 * and so passed while the operator-facing journey was broken. The INSERT the
 * RPC performs still fires the row trigger, so this exercises both layers.
 */
async function createRuleSet(rules: unknown[], mode = "all"): Promise<string> {
  const { rows } = await pool.query(
    `SELECT * FROM create_voucher_eligibility_rule_set_atomic($1,$2,$3::jsonb,NULL,$4)`,
    [PROGRAM_ID, mode, JSON.stringify(rules), ACTOR_ID],
  );
  return rows[0].id as string;
}

type AllocationArgs = {
  voucherType?: "fixed_off" | "percent_off";
  discountKes?: number | null;
  discountPercent?: number | null;
  maximumDiscountKes?: number | null;
  minimumSpendKes?: number;
  quantityCap?: number;
  ruleSetId?: string | null;
};

async function createAllocation(args: AllocationArgs = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM create_voucher_funding_allocation_atomic(
       p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
       p_title => $4, p_description => NULL,
       p_discount_kes => $5, p_minimum_spend_kes => $6,
       p_terms_text => NULL, p_quantity_cap => $7, p_authorized_budget_minor => NULL,
       p_claim_starts_at => now() - interval '1 day',
       p_claim_ends_at => now() + interval '30 days',
       p_voucher_validity_seconds => 172800,
       p_distribution_modes => ARRAY['self_claim']::text[],
       p_recycle_expired_inventory => false,
       p_eligibility_rule_set_id => $8, p_metadata => '{}'::jsonb,
       p_voucher_type => $9, p_discount_percent => $10, p_maximum_discount_kes => $11
     )`,
    [
      PROGRAM_ID,
      MERCHANT_ID,
      ACTOR_ID,
      "Weekend 10% off",
      // `in` rather than ?? so a test can pass an explicit null to assert the
      // RPC rejects a missing value.
      "discountKes" in args ? args.discountKes : null,
      args.minimumSpendKes ?? 300,
      args.quantityCap ?? 20,
      args.ruleSetId ?? null,
      args.voucherType ?? "percent_off",
      "discountPercent" in args ? args.discountPercent : 10,
      "maximumDiscountKes" in args ? args.maximumDiscountKes : 200,
    ],
  );
  const allocation = rows[0];
  // Authoring leaves the allocation in 'draft'; the claim path needs it live.
  await pool.query(
    "UPDATE voucher_funding_allocations SET state='active' WHERE id=$1",
    [allocation.id],
  );
  return allocation;
}

async function claim(allocationId: string, member: { hubUserId: string; canonicalId: string }) {
  const { rows } = await pool.query(
    `SELECT * FROM claim_akiba_funded_voucher_atomic(
       $1,$2,'self_claim',$3,$4,NULL,NULL,NULL,'{}'::jsonb,'{}'::jsonb,'KE','self_declared_profile','member',$5)`,
    [allocationId, member.canonicalId, `test:${randomUUID()}`, member.hubUserId, member.hubUserId],
  );
  return rows[0];
}

/** The local weekday the rule will be evaluated against, 0=Sun … 6=Sat. */
async function nairobiDayOfWeek(): Promise<number> {
  const { rows } = await pool.query(
    "SELECT EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Nairobi'))::int AS dow",
  );
  return rows[0].dow as number;
}

describe.skipIf(!PLATFORM_AVAILABLE)("funded percent vouchers + weekend claims", () => {
  beforeAll(async () => {
    const admin = new Pool(ADMIN_CONFIG);
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await admin.query(`CREATE DATABASE ${DB_NAME}`);
    } finally {
      await admin.end();
    }

    pool = new Pool(DB_CONFIG);
    await applySql(readFileSync(FIXTURE, "utf8"), false);
    for (const file of PLATFORM_TOLERANT) {
      await applySql(readFileSync(resolve(PLATFORM_MIGRATIONS, file), "utf8"), true);
    }
    for (const file of PLATFORM_STRICT) {
      await applySql(readFileSync(resolve(PLATFORM_MIGRATIONS, file), "utf8"), false);
    }
    for (const file of MINIMILES_MIGRATIONS) {
      await applySql(readFileSync(file, "utf8"), false);
    }

    await pool.query(
      "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'arabica','Arabica Coffee House','active','KE','merchant')",
      [MERCHANT_ID],
    );
    await pool.query(
      `INSERT INTO voucher_funding_programs(
         id,name,country_code,authorized_budget_minor,state,starts_at,ends_at,created_by)
       VALUES($1,'Acquisition pilot','KE',100000000,'active',
              now() - interval '1 day', now() + interval '90 days',$2)`,
      [PROGRAM_ID, ACTOR_ID],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Pool(ADMIN_CONFIG);
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    } finally {
      await admin.end();
    }
  });

  describe("claim_day_of_week authoring", () => {
    it("accepts a Saturday+Sunday rule", async () => {
      await expect(
        createRuleSet([{ type: "claim_day_of_week", days: [6, 0] }]),
      ).resolves.toBeTruthy();
    });

    it("accepts an explicit valid timezone", async () => {
      await expect(
        createRuleSet([
          { type: "claim_day_of_week", days: [6, 0], timezone: "Africa/Nairobi" },
        ]),
      ).resolves.toBeTruthy();
    });

    it("rejects a non-array day list", async () => {
      await expect(
        createRuleSet([{ type: "claim_day_of_week", days: 6 }]),
      ).rejects.toThrow(/INVALID_CLAIM_DAY_OF_WEEK_DAYS/);
    });

    it("rejects an empty day list", async () => {
      await expect(
        createRuleSet([{ type: "claim_day_of_week", days: [] }]),
      ).rejects.toThrow(/INVALID_CLAIM_DAY_OF_WEEK_DAYS/);
    });

    it("rejects an out-of-range weekday", async () => {
      await expect(
        createRuleSet([{ type: "claim_day_of_week", days: [6, 7] }]),
      ).rejects.toThrow(/INVALID_CLAIM_DAY_OF_WEEK_DAYS/);
    });

    it("rejects a non-integer weekday", async () => {
      await expect(
        createRuleSet([{ type: "claim_day_of_week", days: [6.5] }]),
      ).rejects.toThrow(/INVALID_CLAIM_DAY_OF_WEEK_DAYS/);
    });

    it("rejects an unrecognised timezone", async () => {
      await expect(
        createRuleSet([
          { type: "claim_day_of_week", days: [6, 0], timezone: "Mars/Olympus" },
        ]),
      ).rejects.toThrow(/INVALID_CLAIM_DAY_OF_WEEK_TIMEZONE/);
    });

    it("still rejects a genuinely unknown rule type", async () => {
      await expect(
        createRuleSet([{ type: "claim_day_of_month", days: [1] }]),
      ).rejects.toThrow(/UNSUPPORTED_ELIGIBILITY_RULE_TYPE/);
    });
  });

  describe("percent allocation authoring", () => {
    it("creates a percent_off template and derives the ceiling from the cap", async () => {
      const allocation = await createAllocation({
        discountPercent: 10,
        maximumDiscountKes: 200,
        quantityCap: 20,
      });

      // KES 200 cap → 20000 minor units reserved per voucher.
      expect(Number(allocation.max_reimbursement_minor)).toBe(20000);
      // Budget floor is quantity × worst case, not quantity × expected spend.
      expect(Number(allocation.authorized_budget_minor)).toBe(20 * 20000);

      const { rows } = await pool.query(
        `SELECT voucher_type,discount_percent,maximum_discount_kes,discount_kes,
                minimum_spend_kes,funding_mode,managed_by
         FROM spend_voucher_templates WHERE id=$1`,
        [allocation.voucher_template_id],
      );
      expect(rows[0].voucher_type).toBe("percent_off");
      expect(Number(rows[0].discount_percent)).toBe(10);
      expect(Number(rows[0].maximum_discount_kes)).toBe(200);
      // No contradictory flat amount left beside the percentage.
      expect(rows[0].discount_kes).toBeNull();
      expect(rows[0].funding_mode).toBe("akiba_reimbursement");
      expect(rows[0].managed_by).toBe("akiba");
    });

    it("refuses an uncapped percentage", async () => {
      await expect(
        createAllocation({ discountPercent: 10, maximumDiscountKes: null }),
      ).rejects.toThrow(/INVALID_MAXIMUM_DISCOUNT_KES/);
    });

    it("refuses a percentage over 100", async () => {
      await expect(createAllocation({ discountPercent: 101 })).rejects.toThrow(
        /INVALID_DISCOUNT_PERCENT/,
      );
    });

    it("refuses a minimum spend that does not exceed the cap", async () => {
      // Otherwise a basket at exactly the minimum could net to zero and the
      // till would reject the redemption.
      await expect(
        createAllocation({ maximumDiscountKes: 200, minimumSpendKes: 200 }),
      ).rejects.toThrow(/INVALID_MINIMUM_SPEND_KES/);
    });

    it("still creates fixed_off allocations unchanged", async () => {
      const allocation = await createAllocation({
        voucherType: "fixed_off",
        discountKes: 100,
        discountPercent: null,
        maximumDiscountKes: null,
        minimumSpendKes: 1000,
        quantityCap: 5,
      });
      expect(Number(allocation.max_reimbursement_minor)).toBe(10000);
      const { rows } = await pool.query(
        "SELECT voucher_type,discount_kes,discount_percent FROM spend_voucher_templates WHERE id=$1",
        [allocation.voucher_template_id],
      );
      expect(rows[0].voucher_type).toBe("fixed_off");
      expect(Number(rows[0].discount_kes)).toBe(100);
      expect(rows[0].discount_percent).toBeNull();
    });
  });

  describe("claim-time rules snapshot", () => {
    it("carries discount_percent and maximum_discount_kes", async () => {
      const allocation = await createAllocation({
        discountPercent: 10,
        maximumDiscountKes: 200,
      });
      const member = await seedMember();

      const result = await claim(allocation.id, member);
      expect(result.error_code).toBe("");
      expect(result.ok).toBe(true);

      const { rows } = await pool.query(
        "SELECT rules_snapshot FROM issued_vouchers WHERE id=$1",
        [result.voucher_id],
      );
      const snapshot = rows[0].rules_snapshot;
      // These two are exactly what redeem_kes_voucher_and_award_atomic reads;
      // without them it RAISEs INVALID_PERCENT_VOUCHER_SNAPSHOT at the till.
      expect(Number(snapshot.discount_percent)).toBe(10);
      expect(Number(snapshot.maximum_discount_kes)).toBe(200);
      expect(snapshot.voucher_type).toBe("percent_off");
      expect(Number(snapshot.minimum_spend_kes)).toBe(300);
    });

    it("keeps the snapshot shape for fixed_off benefits", async () => {
      const allocation = await createAllocation({
        voucherType: "fixed_off",
        discountKes: 100,
        minimumSpendKes: 1000,
      });
      const member = await seedMember();

      const result = await claim(allocation.id, member);
      expect(result.ok).toBe(true);

      const { rows } = await pool.query(
        "SELECT rules_snapshot FROM issued_vouchers WHERE id=$1",
        [result.voucher_id],
      );
      const snapshot = rows[0].rules_snapshot;
      expect(snapshot).toHaveProperty("discount_percent");
      expect(snapshot.discount_percent).toBeNull();
      expect(snapshot.maximum_discount_kes).toBeNull();
      expect(Number(snapshot.discount_kes)).toBe(100);
    });

    it("refuses a percent template whose cap has gone missing", async () => {
      const allocation = await createAllocation({
        discountPercent: 10,
        maximumDiscountKes: 200,
      });
      // Simulates a template edited outside the authoring RPC. The claim must
      // not hand out a voucher no till can compute.
      await pool.query(
        "UPDATE spend_voucher_templates SET maximum_discount_kes=NULL WHERE id=$1",
        [allocation.voucher_template_id],
      );
      const member = await seedMember();

      const result = await claim(allocation.id, member);
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("BENEFIT_CONFIGURATION_INVALID");

      // No entitlement, no claim, and critically no budget reservation.
      const { rows: vouchers } = await pool.query(
        "SELECT count(*)::int AS n FROM issued_vouchers WHERE funding_allocation_id=$1",
        [allocation.id],
      );
      expect(vouchers[0].n).toBe(0);
      const { rows: claims } = await pool.query(
        "SELECT count(*)::int AS n FROM voucher_claims WHERE allocation_id=$1",
        [allocation.id],
      );
      expect(claims[0].n).toBe(0);
      const { rows: ledger } = await pool.query(
        "SELECT count(*)::int AS n FROM voucher_funding_ledger_entries WHERE allocation_id=$1",
        [allocation.id],
      );
      expect(ledger[0].n).toBe(0);
    });
  });

  describe("claim_day_of_week enforcement", () => {
    it("allows a claim when today is in the day list", async () => {
      const today = await nairobiDayOfWeek();
      const ruleSetId = await createRuleSet([
        { type: "claim_day_of_week", days: [today] },
      ]);
      const allocation = await createAllocation({ ruleSetId });
      const member = await seedMember();

      const result = await claim(allocation.id, member);
      expect(result.error_code).toBe("");
      expect(result.ok).toBe(true);
    });

    it("refuses a claim when today is excluded", async () => {
      const today = await nairobiDayOfWeek();
      const otherDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today);
      const ruleSetId = await createRuleSet([
        { type: "claim_day_of_week", days: otherDays },
      ]);
      const allocation = await createAllocation({ ruleSetId });
      const member = await seedMember();

      const result = await claim(allocation.id, member);
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("ELIGIBILITY_REQUIREMENTS_NOT_MET");
    });

    it("records the evaluated local day on the claim's eligibility snapshot", async () => {
      const today = await nairobiDayOfWeek();
      const ruleSetId = await createRuleSet([
        { type: "claim_day_of_week", days: [today], timezone: "Africa/Nairobi" },
      ]);
      const allocation = await createAllocation({ ruleSetId });
      const member = await seedMember();

      const result = await claim(allocation.id, member);
      expect(result.ok).toBe(true);

      const { rows } = await pool.query(
        "SELECT eligibility_snapshot FROM voucher_claims WHERE id=$1",
        [result.claim_id],
      );
      const ruleResults = rows[0].eligibility_snapshot.ruleResults;
      const dayRule = ruleResults.find(
        (r: { type: string }) => r.type === "claim_day_of_week",
      );
      expect(dayRule.satisfied).toBe(true);
      expect(dayRule.evidence.dayOfWeek).toBe(today);
      expect(dayRule.evidence.timezone).toBe("Africa/Nairobi");
    });

    it("combines with no_prior_merchant_redemption", async () => {
      const today = await nairobiDayOfWeek();
      const ruleSetId = await createRuleSet([
        { type: "claim_day_of_week", days: [today] },
        { type: "no_prior_merchant_redemption" },
      ]);
      const allocation = await createAllocation({ ruleSetId });
      const member = await seedMember();

      // A prior redemption at this merchant disqualifies the member even on an
      // allowed day — this is the pairing that makes the spend acquisition.
      await pool.query(
        "INSERT INTO voucher_redemptions(hub_user_id,merchant_id) VALUES($1,$2)",
        [member.hubUserId, MERCHANT_ID],
      );

      const result = await claim(allocation.id, member);
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("ELIGIBILITY_REQUIREMENTS_NOT_MET");
    });

    it("enforces one claim per member on an allowed day", async () => {
      const today = await nairobiDayOfWeek();
      const ruleSetId = await createRuleSet([
        { type: "claim_day_of_week", days: [today] },
      ]);
      const allocation = await createAllocation({ ruleSetId });
      const member = await seedMember();

      const first = await claim(allocation.id, member);
      expect(first.ok).toBe(true);
      const second = await claim(allocation.id, member);
      expect(second.ok).toBe(false);
      expect(second.error_code).toBe("ALREADY_CLAIMED");
    });
  });
});
