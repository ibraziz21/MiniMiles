/**
 * Integration tests for migration 126 (new-member welcome offer, BDR-008).
 *
 * Runs against the real funded-voucher engine — Akiba-Platform's funding
 * migrations plus MiniMiles 110/112/113, the same set the multi-merchant
 * suite uses — so the award goes through the actual claim RPC, budget
 * reservation, merchant snapshot and eligibility audit trigger rather than a
 * stand-in that would only agree with itself.
 *
 * Covers: who gets the offer and who doesn't, that a retry never issues a
 * second voucher, the enrolment cap, that a refused award leaves nothing
 * behind, that auto_award stays closed to every other caller, and that a
 * campaign can't point at an allocation the flow can't honour.
 *
 * Requires postgres to be running. Creates and tears down
 * "hub_welcome_offer_test" automatically.
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

const DB_NAME = "hub_welcome_offer_test";
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
  "154_multi_merchant_funded_vouchers.sql",
  "155_atomic_allocation_authoring.sql",
  "156_allocation_publication_readiness.sql",
];
const MINIMILES_MIGRATIONS = [
  "supabase/migrations/110_funded_percent_vouchers_weekend_claims.sql",
  "supabase/migrations/112_funded_voucher_redemption_schedule.sql",
  "supabase/migrations/113_multi_merchant_funded_claims.sql",
  "supabase/migrations/126_welcome_offer_enrolment.sql",
].map((p) => resolve(REPO_ROOT, p));

let pool: pg.Pool;

const PROGRAM_ID = randomUUID();
const ACTOR_ID = randomUUID();
const PRIMARY_MERCHANT = randomUUID();
const SECOND_MERCHANT = randomUUID();

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

type Member = { hubUserId: string; canonicalId: string };

async function seedMember(opts: { createdAt?: string; username?: boolean } = {}): Promise<Member> {
  const hubUserId = randomUUID();
  const canonicalId = randomUUID();
  await pool.query("INSERT INTO auth.users(id,email,created_at) VALUES($1,$2,$3)", [
    hubUserId,
    `${hubUserId}@example.test`,
    opts.createdAt ?? new Date().toISOString(),
  ]);
  await pool.query("INSERT INTO hub_user_canonicals(hub_user_id,canonical_id) VALUES($1,$2)", [hubUserId, canonicalId]);
  await pool.query("INSERT INTO hub_user_profiles(user_id,country_code) VALUES($1,'KE')", [hubUserId]);
  await pool.query("INSERT INTO hub_user_passes(user_id) VALUES($1)", [hubUserId]);
  if (opts.username !== false) {
    await pool.query("INSERT INTO leaderboard_profiles(canonical_id,username) VALUES($1,$2)", [
      canonicalId,
      `member_${hubUserId.slice(0, 8)}`,
    ]);
  }
  return { hubUserId, canonicalId };
}

async function createWelcomeAllocation(opts: {
  modes?: string[];
  voucherType?: "percent_off" | "fixed_off";
  quantity?: number;
} = {}) {
  const percent = (opts.voucherType ?? "percent_off") === "percent_off";
  const { rows } = await pool.query(
    `SELECT * FROM create_voucher_funding_allocation_atomic(
       p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
       p_title => 'Welcome to Akiba', p_description => NULL,
       p_discount_kes => $6, p_minimum_spend_kes => 1000,
       p_terms_text => NULL, p_quantity_cap => $5, p_authorized_budget_minor => NULL,
       p_claim_starts_at => now() - interval '1 day',
       p_claim_ends_at => now() + interval '90 days',
       p_voucher_validity_seconds => 604800,
       p_distribution_modes => $4::text[],
       p_recycle_expired_inventory => false,
       p_eligibility_rule_set_id => NULL, p_metadata => '{}'::jsonb,
       p_voucher_type => $7, p_discount_percent => $8,
       p_maximum_discount_kes => $9
     )`,
    [
      PROGRAM_ID, PRIMARY_MERCHANT, ACTOR_ID, opts.modes ?? ["auto_award"], opts.quantity ?? 100,
      percent ? null : 100, opts.voucherType ?? "percent_off", percent ? 25 : null, percent ? 250 : null,
    ],
  );
  const allocation = rows[0];
  await pool.query(
    "INSERT INTO voucher_allocation_merchants(allocation_id,partner_id,created_by) VALUES($1,$2,$3)",
    [allocation.id, SECOND_MERCHANT, ACTOR_ID],
  );
  await pool.query("UPDATE voucher_funding_allocations SET state='active' WHERE id=$1", [allocation.id]);
  return allocation as { id: string };
}

/** Closes every other campaign and starts a fresh one. */
async function startCampaign(opts: { cap?: number; startsAt?: string; quantity?: number } = {}) {
  await pool.query("UPDATE welcome_offer_campaigns SET state='closed' WHERE state<>'closed'");
  const allocation = await createWelcomeAllocation({ quantity: opts.quantity });
  const { rows } = await pool.query(
    `INSERT INTO welcome_offer_campaigns(key,allocation_id,state,enrolment_cap,enrolment_starts_at)
     VALUES($1,$2,'enrolling',$3,$4) RETURNING *`,
    [`welcome-${randomUUID()}`, allocation.id, opts.cap ?? 1000, opts.startsAt ?? new Date(Date.now() - 60_000).toISOString()],
  );
  return { campaign: rows[0] as { id: string }, allocationId: allocation.id };
}

async function enrol(member: Member) {
  const { rows } = await pool.query("SELECT enrol_welcome_offer($1) AS r", [member.hubUserId]);
  return rows[0].r as Record<string, unknown>;
}

async function count(sql: string, params: unknown[]) {
  const { rows } = await pool.query(sql, params);
  return Number(rows[0].n);
}

describe.skipIf(!PLATFORM_AVAILABLE)("migration 126 — welcome offer enrolment", () => {
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
      [PRIMARY_MERCHANT, "kahawa-corner", "Kahawa Corner"],
      [SECOND_MERCHANT, "zuri-spa", "Zuri Spa"],
    ] as const) {
      await pool.query(
        "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,$2,$3,'active','KE','merchant')",
        [id, slug, name],
      );
      await pool.query("INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'active')", [id]);
    }
    await pool.query(
      `INSERT INTO voucher_funding_programs(
         id,name,country_code,authorized_budget_minor,state,starts_at,ends_at,created_by)
       VALUES($1,'Welcome offer','KE',100000000,'active',
              now() - interval '1 day', now() + interval '90 days',$2)`,
      [PROGRAM_ID, ACTOR_ID],
    );
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Pool(ADMIN_CONFIG);
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    } finally {
      await admin.end();
    }
  });

  it("applies a second time without error", async () => {
    await applySql(readFileSync(MINIMILES_MIGRATIONS[3], "utf8"), false);
  });

  it("issues a new member the offer: 25% up to KSh 250, 7 days, every participating place", async () => {
    const { allocationId } = await startCampaign();
    const member = await seedMember();

    const result = await enrol(member);

    expect(result).toMatchObject({ state: "awarded", discountPercent: 25, maximumDiscountKes: 250, minimumSpendKes: 1000 });
    const days = (Date.parse(result.expiresAt as string) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);

    const { rows } = await pool.query(
      "SELECT acquisition_source, hub_user_id, funding_allocation_id, rules_snapshot FROM issued_vouchers WHERE id=$1",
      [result.voucherId],
    );
    expect(rows[0]).toMatchObject({
      acquisition_source: "akiba_funded_auto_award",
      hub_user_id: member.hubUserId,
      funding_allocation_id: allocationId,
    });
    expect([...rows[0].rules_snapshot.eligible_merchant_ids].sort()).toEqual([PRIMARY_MERCHANT, SECOND_MERCHANT].sort());

    // The budget is reserved through the ordinary funding ledger, by the system.
    const ledger = await pool.query(
      "SELECT amount_minor, actor_type, actor_id FROM voucher_funding_ledger_entries WHERE issued_voucher_id=$1",
      [result.voucherId],
    );
    expect(ledger.rows).toEqual([{ amount_minor: "25000", actor_type: "system", actor_id: "welcome_enrolment" }]);
    const claim = await pool.query("SELECT claim_mode FROM voucher_claims WHERE issued_voucher_id=$1", [result.voucherId]);
    expect(claim.rows[0].claim_mode).toBe("auto_award");
  });

  it("returns the same voucher on retry, never a second one", async () => {
    await startCampaign();
    const member = await seedMember();

    const first = await enrol(member);
    const second = await enrol(member);

    expect(second).toEqual(first);
    expect(await count("SELECT count(*) n FROM issued_vouchers WHERE hub_user_id=$1", [member.hubUserId])).toBe(1);
  });

  it("keeps a member's offer even after the campaign that issued it closes", async () => {
    await startCampaign();
    const member = await seedMember();
    const first = await enrol(member);

    await startCampaign();
    expect(await enrol(member)).toEqual(first);
  });

  it("doesn't give it to a member whose account predates the campaign", async () => {
    await startCampaign();
    const member = await seedMember({ createdAt: "2026-01-01T00:00:00Z" });

    expect(await enrol(member)).toEqual({ state: "unavailable", reason: "existing_member" });
    expect(await count("SELECT count(*) n FROM issued_vouchers WHERE hub_user_id=$1", [member.hubUserId])).toBe(0);
  });

  it("stops at the enrolment cap", async () => {
    await startCampaign({ cap: 2 });
    const [a, b, c] = [await seedMember(), await seedMember(), await seedMember()];

    expect((await enrol(a)).state).toBe("awarded");
    expect((await enrol(b)).state).toBe("awarded");
    expect(await enrol(c)).toEqual({ state: "unavailable", reason: "campaign_full" });
  });

  it("reports full when the allocation runs out before the cap", async () => {
    await startCampaign({ cap: 10, quantity: 1 });
    const [a, b] = [await seedMember(), await seedMember()];

    expect((await enrol(a)).state).toBe("awarded");
    expect(await enrol(b)).toMatchObject({ state: "unavailable", reason: "campaign_full" });
  });

  it("issues nothing while no campaign is enrolling", async () => {
    const { campaign } = await startCampaign();
    await pool.query("UPDATE welcome_offer_campaigns SET state='paused' WHERE id=$1", [campaign.id]);
    const member = await seedMember();

    expect(await enrol(member)).toEqual({ state: "unavailable", reason: "campaign_unavailable" });
  });

  it("leaves nothing behind when the claim is refused", async () => {
    const { allocationId } = await startCampaign();
    const member = await seedMember({ username: false });
    const reservedBefore = await count(
      "SELECT count(*) n FROM voucher_funding_ledger_entries WHERE allocation_id=$1", [allocationId],
    );

    expect(await enrol(member)).toMatchObject({ state: "unavailable", reason: "not_eligible", detail: "USERNAME_REQUIRED" });
    expect(await count("SELECT count(*) n FROM welcome_offer_enrolments WHERE canonical_id=$1", [member.canonicalId])).toBe(0);
    expect(await count("SELECT count(*) n FROM issued_vouchers WHERE hub_user_id=$1", [member.hubUserId])).toBe(0);
    expect(
      await count("SELECT count(*) n FROM voucher_funding_ledger_entries WHERE allocation_id=$1", [allocationId]),
    ).toBe(reservedBefore);

    // Fixing the profile makes the next attempt succeed.
    await pool.query("INSERT INTO leaderboard_profiles(canonical_id,username) VALUES($1,'late_username')", [member.canonicalId]);
    expect((await enrol(member)).state).toBe("awarded");
  });

  it("keeps auto_award closed to any caller but the enrolment", async () => {
    const { allocationId } = await startCampaign();
    const member = await seedMember();

    const { rows } = await pool.query(
      `SELECT * FROM claim_akiba_funded_voucher_atomic(
         $1,$2,'auto_award',$3,$4,NULL,NULL,NULL,'{}'::jsonb,'{}'::jsonb,NULL,NULL,'system','someone_else')`,
      [allocationId, member.canonicalId, `direct:${randomUUID()}`, member.hubUserId],
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "CLAIM_MODE_NOT_ENABLED" });

    // Nor can a member self-claim the welcome allocation.
    const self = await pool.query(
      `SELECT * FROM claim_akiba_funded_voucher_atomic(
         $1,$2,'self_claim',$3,$4::uuid,NULL,NULL,NULL,'{}'::jsonb,'{}'::jsonb,'KE','self_declared_profile','member',$4::text)`,
      [allocationId, member.canonicalId, `self:${randomUUID()}`, member.hubUserId],
    );
    expect(self.rows[0]).toMatchObject({ ok: false, error_code: "DISTRIBUTION_MODE_NOT_SUPPORTED" });
  });

  it("refuses a campaign on an allocation the flow can't honour", async () => {
    const selfClaimable = await createWelcomeAllocation({ modes: ["auto_award", "self_claim"] });
    const fixed = await createWelcomeAllocation({ voucherType: "fixed_off" });
    const manual = await createWelcomeAllocation({ modes: ["self_claim"] });
    const insert = (allocationId: string) =>
      pool.query(
        `INSERT INTO welcome_offer_campaigns(key,allocation_id,enrolment_cap,enrolment_starts_at)
         VALUES($1,$2,10,now())`,
        [`bad-${randomUUID()}`, allocationId],
      );

    await expect(insert(selfClaimable.id)).rejects.toThrow(/WELCOME_ALLOCATION_SELF_CLAIMABLE/);
    await expect(insert(fixed.id)).rejects.toThrow(/WELCOME_ALLOCATION_BENEFIT_INVALID/);
    await expect(insert(manual.id)).rejects.toThrow(/WELCOME_ALLOCATION_NOT_AUTO_AWARD/);
  });

  it("allows only one enrolling campaign at a time", async () => {
    await startCampaign();
    const allocation = await createWelcomeAllocation();
    await expect(
      pool.query(
        `INSERT INTO welcome_offer_campaigns(key,allocation_id,state,enrolment_cap,enrolment_starts_at)
         VALUES($1,$2,'enrolling',10,now())`,
        [`second-${randomUUID()}`, allocation.id],
      ),
    ).rejects.toThrow(/uq_welcome_offer_campaigns_enrolling/);
  });

  it("reads an existing offer without ever enrolling", async () => {
    await startCampaign();
    const member = await seedMember();
    const read = async () =>
      (await pool.query("SELECT get_welcome_offer($1) AS r", [member.hubUserId])).rows[0].r;

    expect(await read()).toEqual({ state: "none" });
    expect(await count("SELECT count(*) n FROM welcome_offer_enrolments WHERE canonical_id=$1", [member.canonicalId])).toBe(0);

    const awarded = await enrol(member);
    expect(await read()).toEqual(awarded);

    await pool.query("UPDATE issued_vouchers SET status='redeemed', redeemed_at=now() WHERE id=$1", [awarded.voucherId]);
    expect((await read()).state).toBe("redeemed");
  });

  it("is reachable by service_role only", async () => {
    const { rows } = await pool.query(
      `SELECT p.proname,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed
         FROM pg_proc p WHERE p.proname IN ('enrol_welcome_offer', 'get_welcome_offer')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect([row.service, row.anon, row.authed]).toEqual([true, false, false]);
  });
});
