/**
 * Integration tests for funded vouchers redeemable across a chosen set of
 * merchants (MiniMiles 113 + Akiba-Platform 154, docs/BDR-006).
 *
 * Covers:
 *   - voucher_allocation_eligible_merchants: the primary merchant plus
 *     voucher_allocation_merchants, as one computed set
 *   - the claim snapshotting that set, including a one-element set for a
 *     single-merchant allocation so behaviour is uniform
 *   - inspect_kes_voucher_presentation accepting a secondary merchant — the
 *     capability itself, through a real function
 *   - snapshot immutability: adding a merchant later does not widen vouchers
 *     already issued, and removing one does not invalidate them
 *   - no_prior_merchant_redemption treating the whole set as "this merchant"
 *
 * NOT covered here: a full redemption through
 * redeem_kes_voucher_and_award_atomic, which needs the Miles award chain
 * (subscriptions, rates, purchase_events, award_purchase_reward_v2) and the
 * Platform migrations behind it. The merchant gate itself is shared — both
 * that function and inspect_kes_voucher_presentation call
 * voucher_redeemable_by_partner — so the gate is exercised here and asserted
 * to be shared, rather than being reimplemented per function.
 *
 * Requires postgres to be running. Creates and tears down
 * "hub_multi_merchant_test" automatically.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID, createHash } from "crypto";

const { Pool } = pg;

const REPO_ROOT = resolve(__dirname, "../../../../..");
const PLATFORM_MIGRATIONS = resolve(REPO_ROOT, "../Akiba-Platform/supabase/migrations");
const PLATFORM_AVAILABLE = existsSync(PLATFORM_MIGRATIONS);

const DB_NAME = "hub_multi_merchant_test";
const ADMIN_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "postgres",
};
const DB_CONFIG = { ...ADMIN_CONFIG, database: DB_NAME };
const FIXTURE = resolve(__dirname, "fixtures/funded-voucher-prerequisites.sql");

const PLATFORM_TOLERANT = ["086_kes_voucher_runtime.sql"];
const PLATFORM_STRICT = [
  "115_voucher_funding_foundation.sql",
  "117_voucher_funding_allocation_lifecycle.sql",
  "120_voucher_funded_redemption.sql",
  "123_voucher_funding_country_normalization.sql",
  "124_spend_voucher_templates_allow_zero_miles_cost.sql",
  "147_funded_voucher_claim_phase1_hardening.sql",
  "148_funded_voucher_claim_corrective_hardening.sql",
  "149_funded_voucher_eligibility_audit_hardening.sql",
  "151_funded_percent_benefit_allocations.sql",
  "152_claim_day_of_week_rule_authoring.sql",
  // 153 must precede MiniMiles 113 — 113's calls a function it
  // creates, so the reverse order cannot even compile.
  "154_multi_merchant_funded_vouchers.sql",
  "155_atomic_allocation_authoring.sql",
  "156_allocation_publication_readiness.sql",
];
const MINIMILES_MIGRATIONS = [
  "supabase/migrations/110_funded_percent_vouchers_weekend_claims.sql",
  "supabase/migrations/112_funded_voucher_redemption_schedule.sql",
  "supabase/migrations/113_multi_merchant_funded_claims.sql",
].map((p) => resolve(REPO_ROOT, p));

let pool: pg.Pool;

const PROGRAM_ID = randomUUID();
const ACTOR_ID = randomUUID();
/** The allocation's primary merchant, plus two market traders and a stranger. */
const PRIMARY_MERCHANT = randomUUID();
const TRADER_A = randomUUID();
const TRADER_B = randomUUID();
const OUTSIDER = randomUUID();

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

async function applySql(sql: string, tolerant: boolean) {
  if (!tolerant) {
    await pool.query(sql);
    return;
  }
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

async function seedMember() {
  const hubUserId = randomUUID();
  const canonicalId = randomUUID();
  await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [hubUserId, `${hubUserId}@example.test`]);
  await pool.query("INSERT INTO hub_user_canonicals(hub_user_id,canonical_id) VALUES($1,$2)", [hubUserId, canonicalId]);
  await pool.query("INSERT INTO hub_user_profiles(user_id,country_code) VALUES($1,'KE')", [hubUserId]);
  await pool.query("INSERT INTO hub_user_passes(user_id) VALUES($1)", [hubUserId]);
  await pool.query("INSERT INTO leaderboard_profiles(canonical_id,username) VALUES($1,$2)", [
    canonicalId,
    `member_${hubUserId.slice(0, 8)}`,
  ]);
  return { hubUserId, canonicalId };
}

let ruleSetVersion = 0;
async function createRuleSet(rules: unknown[]): Promise<string> {
  ruleSetVersion += 1;
  const { rows } = await pool.query(
    `SELECT * FROM create_voucher_eligibility_rule_set_atomic($1,$2,$3::jsonb,NULL,$4)`,
    [PROGRAM_ID, "all", JSON.stringify(rules), ACTOR_ID],
  );
  return rows[0].id as string;
}

/** Creates an allocation, optionally naming extra merchants, and activates it. */
async function createAllocation(
  extraMerchants: string[] = [],
  ruleSetId: string | null = null,
  metadata: Record<string, unknown> = {},
) {
  const { rows } = await pool.query(
    `SELECT * FROM create_voucher_funding_allocation_atomic(
       p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
       p_title => 'Market weekend 10%', p_description => NULL,
       p_discount_kes => NULL, p_minimum_spend_kes => 300,
       p_terms_text => NULL, p_quantity_cap => 20, p_authorized_budget_minor => NULL,
       p_claim_starts_at => now() - interval '1 day',
       p_claim_ends_at => now() + interval '30 days',
       p_voucher_validity_seconds => 172800,
       p_distribution_modes => ARRAY['self_claim']::text[],
       p_recycle_expired_inventory => false,
       p_eligibility_rule_set_id => $4, p_metadata => $5::jsonb,
       p_voucher_type => 'percent_off', p_discount_percent => 10,
       p_maximum_discount_kes => 200
     )`,
    [PROGRAM_ID, PRIMARY_MERCHANT, ACTOR_ID, ruleSetId, JSON.stringify(metadata)],
  );
  const allocation = rows[0];
  for (const partnerId of extraMerchants) {
    await pool.query(
      "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id,created_by) VALUES($1,$2,$3)",
      [allocation.id, partnerId, ACTOR_ID],
    );
  }
  await pool.query("UPDATE voucher_funding_allocations SET state='active' WHERE id=$1", [allocation.id]);
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


/** Draft field + membership update. `merchants === null` preserves the set. */
async function updateDraft(
  allocationId: string,
  expectedVersion: number,
  merchants: string[] | null,
  percent: number,
) {
  const { rows } = await pool.query(
    `SELECT * FROM update_voucher_funding_allocation_draft_with_merchants_atomic(
       p_allocation_id => $1, p_actor_id => $2, p_expected_version => $3,
       p_title => NULL, p_description => NULL, p_terms_text => NULL,
       p_discount_kes => NULL, p_minimum_spend_kes => NULL, p_quantity_cap => NULL,
       p_authorized_budget_minor => NULL, p_claim_starts_at => NULL, p_claim_ends_at => NULL,
       p_voucher_validity_seconds => NULL, p_distribution_modes => NULL,
       p_recycle_expired_inventory => NULL, p_eligibility_rule_set_id => NULL,
       p_metadata => NULL,
       p_discount_percent => $5, p_maximum_discount_kes => NULL,
       p_additional_merchant_ids => $4::uuid[]
     )`,
    [allocationId, ACTOR_ID, expectedVersion, merchants, percent],
  );
  return rows[0];
}

async function eligibleMerchants(allocationId: string): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT em::text AS id FROM voucher_allocation_eligible_merchants($1) AS em ORDER BY 1",
    [allocationId],
  );
  return rows.map((r) => r.id as string);
}

async function snapshotOf(voucherId: string) {
  const { rows } = await pool.query("SELECT rules_snapshot FROM issued_vouchers WHERE id=$1", [voucherId]);
  return rows[0].rules_snapshot as Record<string, unknown>;
}

/** Makes a claimed voucher presentable, as the QR flow would. */
async function presentVoucher(voucherId: string): Promise<string> {
  const token = `AKV1.${randomUUID().replace(/-/g, "")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  await pool.query(
    `UPDATE issued_vouchers
        SET redemption_token_hash=$2,
            redemption_token_expires_at=now() + interval '5 minutes',
            redemption_token_issued_at=now()
      WHERE id=$1`,
    [voucherId, hash],
  );
  // The template must be published for the scan preview to return it.
  await pool.query(
    `UPDATE spend_voucher_templates svt SET lifecycle_state='published', active=true
      WHERE svt.id=(SELECT voucher_template_id FROM issued_vouchers WHERE id=$1)`,
    [voucherId],
  );
  return hash;
}

async function inspectAs(tokenHash: string, partnerId: string) {
  const { rows } = await pool.query("SELECT * FROM inspect_kes_voucher_presentation($1,$2)", [tokenHash, partnerId]);
  return rows[0] ?? null;
}

describe.skipIf(!PLATFORM_AVAILABLE)("funded vouchers across multiple merchants", () => {
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

    for (const [id, slug, name] of [
      [PRIMARY_MERCHANT, "karen-hub", "Karen Market Hub"],
      [TRADER_A, "trader-a", "Trader A"],
      [TRADER_B, "trader-b", "Trader B"],
      [OUTSIDER, "outsider", "Unrelated Shop"],
    ] as const) {
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,$2,$3,'active','KE','merchant')",
        [id, slug, name],
      );
      // Publication readiness (156) requires a subscription the till would
      // accept; 'trialing' is what a newly onboarded merchant gets.
      await pool.query(
        "INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'active')",
        [id],
      );
    }
    await pool.query(
      `INSERT INTO voucher_funding_programs(
         id,name,country_code,authorized_budget_minor,state,starts_at,ends_at,created_by)
       VALUES($1,'Market acquisition','KE',100000000,'active',
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

  describe("publication readiness", () => {
    async function readiness(allocationId: string) {
      const { rows } = await pool.query(
        "SELECT partner_id::text AS id, merchant_name, is_primary, ready, reason FROM voucher_allocation_merchant_readiness($1)",
        [allocationId],
      );
      return rows as Array<{
        id: string; merchant_name: string; is_primary: boolean; ready: boolean; reason: string | null;
      }>;
    }

    async function transition(allocationId: string, action: string) {
      const { rows } = await pool.query(
        "SELECT * FROM transition_voucher_funding_allocation_atomic($1,$2,$3,NULL)",
        [allocationId, action, ACTOR_ID],
      );
      return rows[0];
    }

    /** Draft → submitted → approved, the state publish requires. */
    async function approvedAllocation(extras: string[]) {
      const allocation = await createAllocation(extras);
      await pool.query("UPDATE voucher_funding_allocations SET state='draft' WHERE id=$1", [allocation.id]);
      await transition(allocation.id, "submit");
      await transition(allocation.id, "approve");
      const { rows } = await pool.query(
        "SELECT state, version FROM voucher_funding_allocations WHERE id=$1",
        [allocation.id],
      );
      expect(rows[0].state).toBe("approved");
      return { id: allocation.id as string, version: rows[0].version as number };
    }

    it("reports every participant ready when all are in order", async () => {
      const allocation = await createAllocation([TRADER_A, TRADER_B]);
      const rows = await readiness(allocation.id);

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.ready)).toBe(true);
      expect(rows.every((r) => r.reason === null)).toBe(true);
      // Primary first, so the operator reads the host merchant at the top.
      expect(rows[0].is_primary).toBe(true);
    });

    it("names a suspended merchant and why", async () => {
      const suspended = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'ready-suspended','Shut Shop','suspended','KE','merchant')",
        [suspended],
      );
      await pool.query("INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'active')", [suspended]);
      const allocation = await createAllocation([]);
      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, suspended],
      );

      const row = (await readiness(allocation.id)).find((r) => r.id === suspended)!;
      expect(row.ready).toBe(false);
      expect(row.merchant_name).toBe("Shut Shop");
      expect(row.reason).toMatch(/not active/);
    });

    it("names a merchant with no subscription and why", async () => {
      const unsubscribed = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'ready-nosub','No Sub Stall','active','KE','merchant')",
        [unsubscribed],
      );
      const allocation = await createAllocation([]);
      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, unsubscribed],
      );

      const row = (await readiness(allocation.id)).find((r) => r.id === unsubscribed)!;
      expect(row.ready).toBe(false);
      // This is the one that matters for a market: a trader can be added to a
      // voucher without being onboarded, and their till would refuse it.
      expect(row.reason).toMatch(/subscription/);
    });

    it("treats a cancelled subscription as not ready", async () => {
      const lapsed = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'ready-lapsed','Lapsed Stall','active','KE','merchant')",
        [lapsed],
      );
      await pool.query("INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'canceled')", [lapsed]);
      const allocation = await createAllocation([]);
      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, lapsed],
      );

      const row = (await readiness(allocation.id)).find((r) => r.id === lapsed)!;
      expect(row.ready).toBe(false);
    });

    it("accepts a trialing subscription, matching the till", async () => {
      const trialing = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'ready-trial','Trial Stall','active','KE','merchant')",
        [trialing],
      );
      await pool.query("INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'trialing')", [trialing]);
      const allocation = await createAllocation([]);
      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, trialing],
      );

      // Readiness must not be stricter than the till, or an operator would be
      // blocked from publishing an offer that would in fact redeem.
      expect((await readiness(allocation.id)).find((r) => r.id === trialing)!.ready).toBe(true);
    });

    it("blocks publication and names the merchant", async () => {
      const unsubscribed = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'pub-nosub','Unready Stall','active','KE','merchant')",
        [unsubscribed],
      );
      const allocation = await approvedAllocation([TRADER_A]);
      await pool.query("UPDATE voucher_funding_allocations SET state='draft' WHERE id=$1", [allocation.id]);
      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, unsubscribed],
      );
      await pool.query("UPDATE voucher_funding_allocations SET state='approved' WHERE id=$1", [allocation.id]);

      await expect(transition(allocation.id, "publish")).rejects.toThrow(
        /MERCHANT_NOT_READY[\s\S]*Unready Stall[\s\S]*subscription/,
      );
    });

    it("leaves the allocation and its template untouched when publication is refused", async () => {
      const unsubscribed = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'pub-nosub-2','Unready Two','active','KE','merchant')",
        [unsubscribed],
      );
      const allocation = await approvedAllocation([]);
      await pool.query("UPDATE voucher_funding_allocations SET state='draft' WHERE id=$1", [allocation.id]);
      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, unsubscribed],
      );
      await pool.query("UPDATE voucher_funding_allocations SET state='approved' WHERE id=$1", [allocation.id]);

      const before = await pool.query(
        `SELECT a.state, a.version, t.active, t.lifecycle_state, t.published_at
           FROM voucher_funding_allocations a
           JOIN spend_voucher_templates t ON t.id=a.voucher_template_id
          WHERE a.id=$1`,
        [allocation.id],
      );

      await expect(transition(allocation.id, "publish")).rejects.toThrow(/MERCHANT_NOT_READY/);

      const after = await pool.query(
        `SELECT a.state, a.version, t.active, t.lifecycle_state, t.published_at
           FROM voucher_funding_allocations a
           JOIN spend_voucher_templates t ON t.id=a.voucher_template_id
          WHERE a.id=$1`,
        [allocation.id],
      );
      // No half-published offer: state, version, template visibility and the
      // published_at stamp are all exactly as before.
      expect(after.rows[0]).toEqual(before.rows[0]);

      // And no audit entry claiming it was published.
      const { rows: audits } = await pool.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='allocation.publish'",
        [allocation.id],
      );
      expect(audits[0].n).toBe(0);
    });

    it("publishes once every participant is ready", async () => {
      const allocation = await approvedAllocation([TRADER_A, TRADER_B]);
      const published = await transition(allocation.id, "publish");
      expect(["active", "scheduled"]).toContain(published.state);
    });

    it("also checks readiness on resume, since a subscription can lapse while paused", async () => {
      const allocation = await approvedAllocation([TRADER_A]);
      await transition(allocation.id, "publish");
      await transition(allocation.id, "pause");

      await pool.query("UPDATE partner_subscriptions SET status='canceled' WHERE partner_id=$1", [TRADER_A]);
      await expect(transition(allocation.id, "resume")).rejects.toThrow(/MERCHANT_NOT_READY/);

      await pool.query("UPDATE partner_subscriptions SET status='active' WHERE partner_id=$1", [TRADER_A]);
      const resumed = await transition(allocation.id, "resume");
      expect(["active", "scheduled"]).toContain(resumed.state);
    });

    it("does not block on a missing payout destination", async () => {
      // Reported to the operator, but settlement policy allows a payable
      // before a destination is on file — a finance follow-up, not a reason
      // to withhold the offer.
      const allocation = await approvedAllocation([TRADER_A]);
      const rows = await readiness(allocation.id);
      expect(rows.every((r) => r.ready)).toBe(true);
      const published = await transition(allocation.id, "publish");
      expect(["active", "scheduled"]).toContain(published.state);
    });
  });

  describe("the eligible set", () => {
    it("is the primary merchant plus the named extras", async () => {
      const allocation = await createAllocation([TRADER_A, TRADER_B]);
      expect(await eligibleMerchants(allocation.id)).toEqual(
        [PRIMARY_MERCHANT, TRADER_A, TRADER_B].sort(),
      );
    });

    it("is just the primary when no extras are named", async () => {
      const allocation = await createAllocation();
      expect(await eligibleMerchants(allocation.id)).toEqual([PRIMARY_MERCHANT]);
    });

    it("does not duplicate the primary if it is also named explicitly", async () => {
      // The set is a UNION precisely so an operator naming the primary again
      // cannot produce a doubled entry or a doubled reservation.
      const allocation = await createAllocation([PRIMARY_MERCHANT, TRADER_A]);
      expect(await eligibleMerchants(allocation.id)).toEqual([PRIMARY_MERCHANT, TRADER_A].sort());
    });
  });

  describe("setting the merchant set", () => {
    async function setMerchants(allocationId: string, partnerIds: string[]) {
      const { rows } = await pool.query(
        "SELECT em::text AS id FROM set_voucher_allocation_merchants_atomic($1,$2::uuid[],$3) AS em ORDER BY 1",
        [allocationId, partnerIds, ACTOR_ID],
      );
      return rows.map((r) => r.id as string);
    }

    /** Creates a draft allocation without activating it. */
    async function draftAllocation() {
      const { rows } = await pool.query(
        `SELECT * FROM create_voucher_funding_allocation_atomic(
           p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
           p_title => 'Draft', p_description => NULL,
           p_discount_kes => NULL, p_minimum_spend_kes => 300,
           p_terms_text => NULL, p_quantity_cap => 5, p_authorized_budget_minor => NULL,
           p_claim_starts_at => now(), p_claim_ends_at => now() + interval '7 days',
           p_voucher_validity_seconds => 172800,
           p_distribution_modes => ARRAY['self_claim']::text[],
           p_recycle_expired_inventory => false,
           p_eligibility_rule_set_id => NULL, p_metadata => '{}'::jsonb,
           p_voucher_type => 'percent_off', p_discount_percent => 10,
           p_maximum_discount_kes => 200
         )`,
        [PROGRAM_ID, PRIMARY_MERCHANT, ACTOR_ID],
      );
      return rows[0];
    }

    it("replaces the set and returns the resulting eligible merchants", async () => {
      const allocation = await draftAllocation();
      expect(await setMerchants(allocation.id, [TRADER_A, TRADER_B])).toEqual(
        [PRIMARY_MERCHANT, TRADER_A, TRADER_B].sort(),
      );
      // Replaces rather than appends — the form sends the whole list.
      expect(await setMerchants(allocation.id, [TRADER_A])).toEqual(
        [PRIMARY_MERCHANT, TRADER_A].sort(),
      );
      expect(await setMerchants(allocation.id, [])).toEqual([PRIMARY_MERCHANT]);
    });

    it("ignores the primary merchant and duplicates", async () => {
      const allocation = await draftAllocation();
      expect(await setMerchants(allocation.id, [PRIMARY_MERCHANT, TRADER_A, TRADER_A])).toEqual(
        [PRIMARY_MERCHANT, TRADER_A].sort(),
      );
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM voucher_allocation_merchants WHERE allocation_id=$1",
        [allocation.id],
      );
      expect(rows[0].n).toBe(1);
    });

    it("refuses a merchant that is not active", async () => {
      const suspended = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'suspended','Suspended','suspended','KE','merchant')",
        [suspended],
      );
      const allocation = await draftAllocation();
      await expect(setMerchants(allocation.id, [suspended])).rejects.toThrow(/MERCHANT_NOT_ELIGIBLE/);
    });

    it("refuses a merchant in another country", async () => {
      const foreign = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'foreign','Foreign','active','UG','merchant')",
        [foreign],
      );
      const allocation = await draftAllocation();
      await expect(setMerchants(allocation.id, [foreign])).rejects.toThrow(/MERCHANT_COUNTRY_MISMATCH/);
    });

    it("refuses to change a live allocation's merchants", async () => {
      // The merchant set is part of what an approver signed off; widening a
      // published offer would change that after the fact.
      const allocation = await draftAllocation();
      await pool.query("UPDATE voucher_funding_allocations SET state='active' WHERE id=$1", [allocation.id]);
      await expect(setMerchants(allocation.id, [TRADER_A])).rejects.toThrow(/ALLOCATION_NOT_EDITABLE/);
    });

    it("leaves nothing behind when a merchant in the list is rejected", async () => {
      // The whole call is one transaction, so a bad id cannot half-apply.
      const foreign = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'foreign2','Foreign 2','active','TZ','merchant')",
        [foreign],
      );
      const allocation = await draftAllocation();
      await setMerchants(allocation.id, [TRADER_A]);
      await expect(setMerchants(allocation.id, [TRADER_B, foreign])).rejects.toThrow(/MERCHANT_COUNTRY_MISMATCH/);

      // The earlier set survives: the DELETE never committed.
      expect(await eligibleMerchants(allocation.id)).toEqual([PRIMARY_MERCHANT, TRADER_A].sort());
    });
  });

  describe("atomic authoring", () => {
    async function createWithMerchants(extras: string[], title = "Atomic offer") {
      const { rows } = await pool.query(
        `SELECT * FROM create_voucher_funding_allocation_with_merchants_atomic(
           p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
           p_title => $5, p_description => NULL,
           p_discount_kes => NULL, p_minimum_spend_kes => 300,
           p_terms_text => NULL, p_quantity_cap => 5, p_authorized_budget_minor => NULL,
           p_claim_starts_at => now(), p_claim_ends_at => now() + interval '7 days',
           p_voucher_validity_seconds => 172800,
           p_distribution_modes => ARRAY['self_claim']::text[],
           p_recycle_expired_inventory => false,
           p_eligibility_rule_set_id => NULL, p_metadata => '{}'::jsonb,
           p_voucher_type => 'percent_off', p_discount_percent => 10,
           p_maximum_discount_kes => 200,
           p_additional_merchant_ids => $4::uuid[]
         )`,
        [PROGRAM_ID, PRIMARY_MERCHANT, ACTOR_ID, extras, title],
      );
      return rows[0];
    }

    async function counts(title: string) {
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM spend_voucher_templates WHERE title=$1) AS templates,
           (SELECT count(*)::int FROM voucher_funding_allocations a
              JOIN spend_voucher_templates t ON t.id=a.voucher_template_id
             WHERE t.title=$1) AS allocations,
           (SELECT count(*)::int FROM audit_logs
             WHERE action='allocation.created'
               AND entity_id IN (SELECT a.id FROM voucher_funding_allocations a
                                   JOIN spend_voucher_templates t ON t.id=a.voucher_template_id
                                  WHERE t.title=$1)) AS audits`,
        [title],
      );
      return rows[0];
    }

    it("creates allocation, template and membership together", async () => {
      const allocation = await createWithMerchants([TRADER_A, TRADER_B]);
      expect(await eligibleMerchants(allocation.id)).toEqual(
        [PRIMARY_MERCHANT, TRADER_A, TRADER_B].sort(),
      );
      // Version reflects the membership write, so the edit form's expected
      // version is not stale the moment it loads.
      expect(allocation.version).toBeGreaterThan(1);
    });

    it("leaves no allocation, template or audit row when a merchant is rejected", async () => {
      const foreign = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'atomic-foreign','Foreign','active','UG','merchant')",
        [foreign],
      );
      const title = "Rolled back offer";

      await expect(createWithMerchants([TRADER_A, foreign], title)).rejects.toThrow(
        /MERCHANT_COUNTRY_MISMATCH/,
      );

      // The whole point of the wrapper: a rejected merchant must not leave a
      // publishable draft behind that names only its primary merchant.
      expect(await counts(title)).toEqual({ templates: 0, allocations: 0, audits: 0 });
    });

    it("rolls back a draft edit whose merchant list is rejected", async () => {
      const foreign = randomUUID();
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,'atomic-foreign-2','Foreign 2','active','TZ','merchant')",
        [foreign],
      );
      const allocation = await createWithMerchants([TRADER_A], "Edit rollback");
      const before = await eligibleMerchants(allocation.id);

      await expect(
        updateDraft(allocation.id, allocation.version, [TRADER_B, foreign], 11),
      ).rejects.toThrow(/MERCHANT_COUNTRY_MISMATCH/);

      // Neither the field change nor the membership change survives.
      expect(await eligibleMerchants(allocation.id)).toEqual(before);
      const { rows } = await pool.query(
        `SELECT t.discount_percent FROM spend_voucher_templates t
           JOIN voucher_funding_allocations a ON a.voucher_template_id=t.id
          WHERE a.id=$1`,
        [allocation.id],
      );
      expect(Number(rows[0].discount_percent)).toBe(10);
    });

    it("rejects a stale edit without touching membership or fields", async () => {
      const allocation = await createWithMerchants([TRADER_A], "Stale edit");
      const staleVersion = allocation.version - 1;

      await expect(
        updateDraft(allocation.id, staleVersion, [TRADER_B], 12),
      ).rejects.toThrow(/ALLOCATION_VERSION_CONFLICT/);

      expect(await eligibleMerchants(allocation.id)).toEqual(
        [PRIMARY_MERCHANT, TRADER_A].sort(),
      );
    });

    it("preserves membership when the edit says nothing about it", async () => {
      const allocation = await createWithMerchants([TRADER_A, TRADER_B], "Preserve");
      await updateDraft(allocation.id, allocation.version, null, 12);
      expect(await eligibleMerchants(allocation.id)).toEqual(
        [PRIMARY_MERCHANT, TRADER_A, TRADER_B].sort(),
      );
    });

    it("clears membership on an explicit empty list", async () => {
      const allocation = await createWithMerchants([TRADER_A, TRADER_B], "Clear");
      await updateDraft(allocation.id, allocation.version, [], 12);
      expect(await eligibleMerchants(allocation.id)).toEqual([PRIMARY_MERCHANT]);
    });
  });

  describe("claim-time snapshot", () => {
    it("records the whole set on the issued voucher", async () => {
      const allocation = await createAllocation([TRADER_A, TRADER_B]);
      const result = await claim(allocation.id, await seedMember());
      expect(result.ok).toBe(true);

      const snapshot = await snapshotOf(result.voucher_id);
      expect((snapshot.eligible_merchant_ids as string[]).slice().sort()).toEqual(
        [PRIMARY_MERCHANT, TRADER_A, TRADER_B].sort(),
      );
    });

    it("composes with the redemption schedule from 112", async () => {
      // Both features enrich rules_snapshot from a BEFORE INSERT trigger on
      // issued_vouchers. They merge with `||` and each touches only its own
      // key, so neither can drop the other — but that is worth asserting,
      // because a trigger that rebuilt the snapshot would silently win.
      // Set at creation: 112 makes the schedule immutable once the
      // allocation leaves draft, which is also how an operator configures it.
      const allocation = await createAllocation([TRADER_A, TRADER_B], null, {
        redemption_schedule: { days: [6, 0], timezone: "Africa/Nairobi" },
      });

      const result = await claim(allocation.id, await seedMember());
      expect(result.ok).toBe(true);

      const snapshot = await snapshotOf(result.voucher_id);
      expect((snapshot.eligible_merchant_ids as string[]).slice().sort()).toEqual(
        [PRIMARY_MERCHANT, TRADER_A, TRADER_B].sort(),
      );
      expect(snapshot.redemption_schedule).toMatchObject({
        days: [6, 0],
        timezone: "Africa/Nairobi",
      });
    });

    it("records a one-element set for a single-merchant allocation", async () => {
      // Uniform shape: the till takes the same path for both, so there is no
      // single-merchant special case to drift.
      const allocation = await createAllocation();
      const result = await claim(allocation.id, await seedMember());
      expect(await snapshotOf(result.voucher_id)).toMatchObject({
        eligible_merchant_ids: [PRIMARY_MERCHANT],
      });
    });
  });

  describe("the scan preview", () => {
    it("returns the voucher for a secondary merchant", async () => {
      // The capability itself: trader B never appears on the allocation's
      // merchant_id, and before 154 this returned nothing.
      const allocation = await createAllocation([TRADER_A, TRADER_B]);
      const result = await claim(allocation.id, await seedMember());
      const hash = await presentVoucher(result.voucher_id);

      const seen = await inspectAs(hash, TRADER_B);
      expect(seen?.valid).toBe(true);
      expect(seen?.voucher_id).toBe(result.voucher_id);
      expect(Number(seen?.discount_percent)).toBe(10);
      expect(Number(seen?.maximum_discount_kes)).toBe(200);
    });

    it("still returns it for the primary merchant", async () => {
      const allocation = await createAllocation([TRADER_A]);
      const result = await claim(allocation.id, await seedMember());
      const hash = await presentVoucher(result.voucher_id);

      expect((await inspectAs(hash, PRIMARY_MERCHANT))?.valid).toBe(true);
    });

    it("refuses a merchant outside the set", async () => {
      const allocation = await createAllocation([TRADER_A]);
      const result = await claim(allocation.id, await seedMember());
      const hash = await presentVoucher(result.voucher_id);

      expect(await inspectAs(hash, OUTSIDER)).toBeNull();
    });

    it("keeps a single-merchant voucher single-merchant", async () => {
      const allocation = await createAllocation();
      const result = await claim(allocation.id, await seedMember());
      const hash = await presentVoucher(result.voucher_id);

      expect((await inspectAs(hash, PRIMARY_MERCHANT))?.valid).toBe(true);
      expect(await inspectAs(hash, TRADER_A)).toBeNull();
    });
  });

  describe("the snapshot is fixed at claim time", () => {
    it("adding a merchant later does not widen vouchers already issued", async () => {
      const allocation = await createAllocation([TRADER_A]);
      const result = await claim(allocation.id, await seedMember());
      const hash = await presentVoucher(result.voucher_id);

      await pool.query(
        "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id) VALUES($1,$2)",
        [allocation.id, TRADER_B],
      );

      // The allocation now names B, but this voucher was claimed before that.
      expect(await eligibleMerchants(allocation.id)).toContain(TRADER_B);
      expect(await inspectAs(hash, TRADER_B)).toBeNull();
      expect((await inspectAs(hash, TRADER_A))?.valid).toBe(true);
    });

    it("removing a merchant later does not invalidate vouchers already issued", async () => {
      // A member holding a voucher a trader agreed to honour must not be
      // stranded by an edit to the allocation.
      const allocation = await createAllocation([TRADER_A]);
      const result = await claim(allocation.id, await seedMember());
      const hash = await presentVoucher(result.voucher_id);

      await pool.query(
        "DELETE FROM voucher_allocation_merchants WHERE allocation_id=$1 AND partner_id=$2",
        [allocation.id, TRADER_A],
      );

      expect(await eligibleMerchants(allocation.id)).toEqual([PRIMARY_MERCHANT]);
      expect((await inspectAs(hash, TRADER_A))?.valid).toBe(true);
    });
  });

  describe("no_prior_merchant_redemption across the set", () => {
    it("disqualifies a member who redeemed at any merchant in the set", async () => {
      const ruleSetId = await createRuleSet([
        { type: "country_in", countries: ["KE"] },
        { type: "profile_country_set" },
        { type: "no_prior_merchant_redemption" },
      ]);
      const allocation = await createAllocation([TRADER_A, TRADER_B], ruleSetId);
      const member = await seedMember();

      // A prior redemption at a SECONDARY merchant, not the primary.
      await pool.query("INSERT INTO voucher_redemptions(hub_user_id,merchant_id) VALUES($1,$2)", [
        member.hubUserId,
        TRADER_B,
      ]);

      const result = await claim(allocation.id, member);
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("ELIGIBILITY_REQUIREMENTS_NOT_MET");
    });

    it("allows a member whose only prior redemption is outside the set", async () => {
      const ruleSetId = await createRuleSet([
        { type: "country_in", countries: ["KE"] },
        { type: "profile_country_set" },
        { type: "no_prior_merchant_redemption" },
      ]);
      const allocation = await createAllocation([TRADER_A], ruleSetId);
      const member = await seedMember();

      await pool.query("INSERT INTO voucher_redemptions(hub_user_id,merchant_id) VALUES($1,$2)", [
        member.hubUserId,
        OUTSIDER,
      ]);

      const result = await claim(allocation.id, member);
      expect(result.error_code).toBe("");
      expect(result.ok).toBe(true);
    });
  });

  describe("the merchant gate is shared, not reimplemented", () => {
    it("both live functions call voucher_redeemable_by_partner", async () => {
      // Redemption is not exercised end to end here (it needs the Miles award
      // chain), so this asserts the gate it uses is the one tested above
      // rather than a second copy that could drift.
      const { rows } = await pool.query(
        `SELECT p.proname
           FROM pg_proc p
          WHERE p.proname IN ('inspect_kes_voucher_presentation','redeem_kes_voucher_and_award_atomic')
            AND pg_get_functiondef(p.oid) LIKE '%voucher_redeemable_by_partner%'
          ORDER BY p.proname`,
      );
      expect(rows.map((r) => r.proname)).toEqual([
        "inspect_kes_voucher_presentation",
        "redeem_kes_voucher_and_award_atomic",
      ]);
    });
  });
});
