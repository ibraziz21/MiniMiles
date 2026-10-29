/**
 * Secondary-merchant redemption and its financial records, against the real
 * Miles award chain.
 *
 * This suite replays the actual Platform + MiniMiles migration history rather
 * than a prerequisite fixture (see helpers/platformReplay.ts). Stubbed awards
 * would prove only that the stubs agree with each other; the whole question
 * here is whether money lands on the merchant that served the member.
 *
 * Asserted:
 *   - purchase, redemption, Miles and the reimbursement payable all attach to
 *     the merchant that redeemed (B), with nothing attributed to the
 *     allocation's primary (A)
 *   - the claim's reservation is released and the realised reimbursement
 *     follows the benefit and its cap
 *   - replaying a checkout creates no second redemption, purchase, award,
 *     ledger entry or payable
 *   - two merchants attempting the same voucher yield exactly one redemption
 *   - a redemption on a disallowed day rolls back the purchase, the Miles and
 *     the funding effects together
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID, createHash } from "crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PLATFORM_AVAILABLE,
  PLATFORM_ROOT,
  assertAwardChainPresent,
  replayAll,
} from "./helpers/platformReplay";

const { Pool } = pg;

const DB_NAME = "hub_secondary_accounting_test";
const ADMIN_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "postgres",
};

let pool: pg.Pool;

const PROGRAM_ID = randomUUID();
const ACTOR_ID = randomUUID();
const MERCHANT_A = randomUUID(); // allocation primary — must receive nothing
const MERCHANT_B = randomUUID(); // the trader who actually serves the member
const MERCHANT_C = randomUUID(); // not a participant
const MERCHANT_USER_B = randomUUID();
const MERCHANT_USER_A = randomUUID();

/** 10% capped at KES 200, minimum spend 300 — the Arabica-shaped benefit. */
const PERCENT = 10;
const CAP_KES = 200;
const MIN_SPEND = 300;

async function seedPartner(id: string, slug: string, name: string) {
  await pool.query(
    `INSERT INTO partners(id,slug,name,status,country,type)
     VALUES($1,$2,$3,'active','KE','merchant')
     ON CONFLICT (id) DO NOTHING`,
    [id, slug, name],
  );
  await pool.query(
    "INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'active')",
    [id],
  );

  // Akiba-Platform 153 gates publishing merchant content on accepted terms.
  // Recorded the way the real flow does — against the current version and its
  // text hash, read from the table rather than hardcoded — rather than
  // disabling the gate, which would mean testing a database nobody runs.
  const { rows: terms } = await pool.query(
    "SELECT version, text_hash FROM merchant_terms_versions ORDER BY version DESC LIMIT 1",
  );
  if (terms.length > 0) {
    await pool.query(
      `INSERT INTO merchant_terms_acceptances(partner_id,accepting_user_id,terms_version,text_hash,source)
       VALUES($1,$2,$3,$4,'merchant_terms_review')`,
      [id, ACTOR_ID, terms[0].version, terms[0].text_hash],
    );
  }
}

async function seedMember() {
  const hubUserId = randomUUID();
  const canonicalId = randomUUID();
  await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [hubUserId, `${hubUserId}@example.test`]);
  // The replayed history wires up identity itself — inserting auth.users
  // already produces a canonical mapping — so these are upserts, and the
  // canonical id is read back rather than assumed. Forcing our own value
  // would be testing a database shape the triggers do not produce.
  await pool.query(
    `INSERT INTO hub_user_canonicals(hub_user_id,canonical_id) VALUES($1,$2)
     ON CONFLICT (hub_user_id) DO NOTHING`,
    [hubUserId, canonicalId],
  );
  const { rows: canonicalRows } = await pool.query(
    "SELECT canonical_id::text AS id FROM hub_user_canonicals WHERE hub_user_id=$1",
    [hubUserId],
  );
  const resolvedCanonicalId = canonicalRows[0].id as string;

  await pool.query(
    // Both columns: 049 created `country`, later migrations added
    // `country_code`, and the claim RPC reads the latter.
    `INSERT INTO hub_user_profiles(user_id,country,country_code) VALUES($1,'KE','KE')
     ON CONFLICT (user_id) DO UPDATE SET country='KE', country_code='KE'`,
    [hubUserId],
  );
  await pool.query(
    "INSERT INTO hub_user_passes(user_id,email) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [hubUserId, `${hubUserId}@example.test`],
  );
  await pool.query(
    `INSERT INTO leaderboard_profiles(canonical_id,username) VALUES($1,$2)
     ON CONFLICT (canonical_id) DO NOTHING`,
    [resolvedCanonicalId, `m${hubUserId.replace(/-/g, "").slice(0, 10)}`],
  );
  return { hubUserId, canonicalId: resolvedCanonicalId };
}

async function createAllocation(extras: string[], metadata: Record<string, unknown> = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM create_voucher_funding_allocation_with_merchants_atomic(
       p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
       p_title => 'Market 10%', p_description => NULL,
       p_discount_kes => NULL, p_minimum_spend_kes => $4,
       p_terms_text => NULL, p_quantity_cap => 50, p_authorized_budget_minor => NULL,
       p_claim_starts_at => now() - interval '1 hour',
       p_claim_ends_at => now() + interval '30 days',
       p_voucher_validity_seconds => 604800,
       p_distribution_modes => ARRAY['self_claim']::text[],
       p_recycle_expired_inventory => false,
       p_eligibility_rule_set_id => NULL, p_metadata => $6::jsonb,
       p_voucher_type => 'percent_off', p_discount_percent => $5,
       p_maximum_discount_kes => $7,
       p_additional_merchant_ids => $8::uuid[]
     )`,
    [PROGRAM_ID, MERCHANT_A, ACTOR_ID, MIN_SPEND, PERCENT, JSON.stringify(metadata), CAP_KES, extras],
  );
  const allocation = rows[0];
  await pool.query("UPDATE voucher_funding_allocations SET state='active' WHERE id=$1", [allocation.id]);
  await pool.query(
    "UPDATE spend_voucher_templates SET lifecycle_state='published', active=true WHERE id=$1",
    [allocation.voucher_template_id],
  );
  return allocation;
}

async function claimVoucher(allocationId: string, member: { hubUserId: string; canonicalId: string }) {
  const { rows } = await pool.query(
    `SELECT * FROM claim_akiba_funded_voucher_atomic(
       $1,$2,'self_claim',$3,$4,NULL,NULL,NULL,'{}'::jsonb,'{}'::jsonb,'KE','self_declared_profile','member',$5)`,
    [allocationId, member.canonicalId, `acct:${randomUUID()}`, member.hubUserId, member.hubUserId],
  );
  return rows[0];
}

/** Puts a live presentation token on a claimed voucher, as the QR flow does. */
async function present(voucherId: string): Promise<string> {
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
  return hash;
}

type RedeemArgs = {
  tokenHash: string;
  partnerId: string;
  merchantUserId?: string;
  gross?: number;
  attemptId?: string;
  occurredAt?: string;
};

async function redeem(args: RedeemArgs) {
  const attemptId = args.attemptId ?? randomUUID();
  const payloadHash = createHash("sha256").update(`${attemptId}:${args.gross ?? 1000}`).digest("hex");
  const { rows } = await pool.query(
    `SELECT * FROM redeem_kes_voucher_and_award_atomic(
       $1,$2,$3,$4,$5,$6,$7,true,$8)`,
    [
      args.tokenHash,
      args.partnerId,
      args.merchantUserId ?? MERCHANT_USER_B,
      attemptId,
      payloadHash,
      args.gross ?? 1000,
      `receipt-${attemptId.slice(0, 8)}`,
      args.occurredAt ?? new Date().toISOString(),
    ],
  );
  return { ...rows[0], attemptId, payloadHash };
}

/** Every financial record for a voucher, by merchant. */
async function financials(voucherId: string) {
  const [redemptions, purchases, payables, ledger, rewards] = await Promise.all([
    pool.query(
      "SELECT merchant_id::text AS merchant, discount_applied, gross_amount_kes, discount_amount_kes, net_amount_kes FROM voucher_redemptions WHERE issued_voucher_id=$1",
      [voucherId],
    ),
    pool.query(
      `SELECT pe.merchant_id::text AS merchant, pe.amount, pe.currency
         FROM purchase_events pe
         JOIN voucher_redemptions vr ON vr.purchase_event_id=pe.id
        WHERE vr.issued_voucher_id=$1`,
      [voucherId],
    ),
    pool.query(
      "SELECT merchant_id::text AS merchant, gross_amount_minor, discount_amount_minor, payable_amount_minor, entry_type FROM voucher_funding_payables WHERE issued_voucher_id=$1",
      [voucherId],
    ),
    pool.query(
      "SELECT entry_type, amount_minor FROM voucher_funding_ledger_entries WHERE issued_voucher_id=$1 ORDER BY entry_type",
      [voucherId],
    ),
    // Miles land in miles_ledger, credited to the redeeming partner. rewards
    // links by campaign/verification rather than purchase, so the ledger is
    // the attributable record here.
    pool.query(
      `SELECT ml.partner_id::text AS merchant, ml.canonical_id::text AS canonical_id, ml.amount, ml.direction
         FROM miles_ledger ml
        WHERE ml.source_id IN (
          SELECT vr.purchase_event_id FROM voucher_redemptions vr WHERE vr.issued_voucher_id=$1
        )`,
      [voucherId],
    ),
  ]);
  return {
    redemptions: redemptions.rows,
    purchases: purchases.rows,
    payables: payables.rows,
    ledger: ledger.rows,
    milesLedger: rewards.rows,
  };
}

describe.skipIf(!PLATFORM_AVAILABLE)("secondary-merchant redemption and accounting", () => {
  beforeAll(async () => {
    const replayed = await replayAll(DB_NAME, ADMIN_CONFIG);
    pool = replayed.pool;

    // The replay must be clean, not merely mostly clean. Collecting failures
    // and never asserting on them would let a migration that matters fail
    // silently while the suite went green.
    expect(
      replayed.report.failures,
      `unexpected migration failures:\n${replayed.report.failures
        .map((f) => `  ${f.file}: ${f.error}`)
        .join("\n")}`,
    ).toEqual([]);

    // A migration appearing on disk without being placed in the reviewed
    // order would otherwise apply at an arbitrary position.
    expect(
      replayed.report.manifestDrift,
      `migration-order.json is out of date:\n${replayed.report.manifestDrift.join("\n")}`,
    ).toEqual([]);

    // An allowance that no longer fires should be deleted rather than left to
    // excuse a future failure of the same file.
    expect(
      replayed.report.staleSkips,
      `expected-skip entries that now apply cleanly: ${replayed.report.staleSkips.join(", ")}`,
    ).toEqual([]);

    // Names alone prove nothing: a failed replacement leaves the older
    // definition in place under the same name.
    const problems = await assertAwardChainPresent(pool);
    expect(problems, `award chain problems after replay:\n${problems.join("\n")}`).toEqual([]);

    // merchant_terms_acceptances.accepting_user_id references auth.users.
    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,'ops@example.test')", [ACTOR_ID]);

    await seedPartner(MERCHANT_A, "merchant-a", "Primary Host");
    await seedPartner(MERCHANT_B, "merchant-b", "Trader B");
    await seedPartner(MERCHANT_C, "merchant-c", "Unrelated Shop");

    // Till operators. The redemption writes merchant_audit_log, whose
    // merchant_user_id is a real foreign key — a random UUID is not a
    // substitute for a staff account.
    for (const [userId, partnerId, email] of [
      [MERCHANT_USER_A, MERCHANT_A, "till-a@example.test"],
      [MERCHANT_USER_B, MERCHANT_B, "till-b@example.test"],
    ] as const) {
      await pool.query(
        `INSERT INTO merchant_users(id,email,password_hash,partner_id,role,is_active)
         VALUES($1,$2,'x',$3,'owner',true)`,
        [userId, email, partnerId],
      );
    }

    // No rate is inserted: the migration history already seeds an active KES
    // rate, and enforce_platform_miles_rate_window() rejects an overlapping
    // one. Asserting the seeded value keeps the Miles expectations below
    // honest if that seed ever changes.
    const { rows: rates } = await pool.query(
      `SELECT spend_amount, reward_miles FROM platform_miles_rate_versions
        WHERE currency='KES' AND status IN('scheduled','active')
          AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now())`,
    );
    expect(rates, "an active KES Miles rate must exist after replay").toHaveLength(1);
    expect(Number(rates[0].spend_amount)).toBe(100);
    expect(Number(rates[0].reward_miles)).toBe(1);

    await pool.query(
      `INSERT INTO voucher_funding_programs(
         id,name,country_code,authorized_budget_minor,state,starts_at,ends_at,created_by)
       VALUES($1,'Market acquisition','KE',100000000,'active',
              now() - interval '1 day', now() + interval '90 days',$2)`,
      [PROGRAM_ID, ACTOR_ID],
    );
  }, 240_000);

  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Pool(ADMIN_CONFIG);
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    } finally {
      await admin.end();
    }
  });

  it.each(["pause", "end", "claim_window_closed"])("preserves issued redemption when acquisition is %s", async (closure) => {
    const allocation = await createAllocation([MERCHANT_B]);
    const claim = await claimVoucher(allocation.id, await seedMember());
    expect(claim.ok).toBe(true);
    const tokenHash = await present(claim.voucher_id);
    if (closure === "claim_window_closed") {
      await pool.query("UPDATE voucher_funding_allocations SET claim_starts_at=now()-interval '2 days',claim_ends_at=now()-interval '1 hour' WHERE id=$1", [allocation.id]);
      await pool.query("UPDATE spend_voucher_templates SET start_at=now()-interval '2 days',end_at=now()-interval '1 hour' WHERE id=$1", [allocation.voucher_template_id]);
    } else {
      const client = await pool.connect();
      try {
        await client.query("SET ROLE service_role");
        await client.query("SELECT transition_voucher_funding_allocation_atomic($1,$2,$3,'Lifecycle regression test')", [allocation.id, closure, ACTOR_ID]);
      } finally { await client.query("RESET ROLE"); client.release(); }
    }
    const refused = await claimVoucher(allocation.id, await seedMember());
    expect(refused.ok).toBe(false);
    expect(refused.error_code).toBe("ALLOCATION_NOT_CLAIMABLE");
    expect((await pool.query("SELECT * FROM inspect_kes_voucher_presentation($1,$2)", [tokenHash, MERCHANT_B])).rows[0]?.valid).toBe(true);
    const result = await redeem({ tokenHash, partnerId: MERCHANT_B });
    expect(result.ok).toBe(true);
    const books = await financials(claim.voucher_id);
    expect(books.payables).toHaveLength(1);
    expect(books.payables[0].merchant).toBe(MERCHANT_B);
    expect(Number(books.payables[0].payable_amount_minor)).toBe(10000);
    expect(Number(result.miles_awarded)).toBe(9);
  });

  it("explicit revocation still blocks inspection and redemption and releases only once", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const claim = await claimVoucher(allocation.id, await seedMember());
    const tokenHash = await present(claim.voucher_id);
    const revoke = () => pool.query("SELECT * FROM revoke_akiba_funded_voucher_atomic($1,$2,'Explicit safety revocation')", [claim.voucher_id, ACTOR_ID]);
    expect((await revoke()).rows[0].ok).toBe(true);
    expect((await revoke()).rows[0].ok).toBe(false);
    const before = await financials(claim.voucher_id);
    expect((await pool.query("SELECT * FROM inspect_kes_voucher_presentation($1,$2)", [tokenHash, MERCHANT_B])).rows).toEqual([]);
    expect((await redeem({ tokenHash, partnerId: MERCHANT_B })).error_code).toBe("INVALID");
    expect(await financials(claim.voucher_id)).toEqual(before);
    expect(before.redemptions).toEqual([]);
    expect(before.payables).toEqual([]);
    expect(before.purchases).toEqual([]);
    expect(before.milesLedger).toEqual([]);
    expect(before.ledger.filter(r => r.entry_type === "reservation_released")).toHaveLength(1);
  });

  it.each(["expired", "token_expired", "merchant_template_inactive"])("retains validity guard: %s", async (reason) => {
    const allocation = await createAllocation([MERCHANT_B]);
    const claim = await claimVoucher(allocation.id, await seedMember());
    const tokenHash = await present(claim.voucher_id);
    if (reason === "expired") await pool.query("UPDATE issued_vouchers SET expires_at=now()-interval '1 second' WHERE id=$1", [claim.voucher_id]);
    if (reason === "token_expired") await pool.query("UPDATE issued_vouchers SET redemption_token_expires_at=now()-interval '1 second' WHERE id=$1", [claim.voucher_id]);
    if (reason === "merchant_template_inactive") {
      await pool.query("UPDATE issued_vouchers SET funding_mode='merchant_discount' WHERE id=$1", [claim.voucher_id]);
      await pool.query("UPDATE spend_voucher_templates SET active=false WHERE id=$1", [allocation.voucher_template_id]);
    }
    const before = await financials(claim.voucher_id);
    expect((await pool.query("SELECT * FROM inspect_kes_voucher_presentation($1,$2)", [tokenHash, MERCHANT_B])).rows).toEqual([]);
    expect((await redeem({ tokenHash, partnerId: MERCHANT_B })).error_code).toBe("INVALID");
    expect(await financials(claim.voucher_id)).toEqual(before);
  });

  it.each(["benefit", "deactivate", "reclassify", "delete", "publish"])("blocks direct service-role managed-template mutation: %s", async (action) => {
    const allocation = await createAllocation([MERCHANT_B]);
    const before = (await pool.query("SELECT * FROM spend_voucher_templates WHERE id=$1", [allocation.voucher_template_id])).rows[0];
    const queries: Record<string, string> = {
      benefit: "UPDATE spend_voucher_templates SET discount_percent=25 WHERE id=$1",
      deactivate: "UPDATE spend_voucher_templates SET active=false WHERE id=$1",
      reclassify: "UPDATE spend_voucher_templates SET managed_by='merchant',funding_allocation_id=NULL,funding_mode='merchant_discount' WHERE id=$1",
      delete: "DELETE FROM spend_voucher_templates WHERE id=$1",
      publish: "SELECT * FROM publish_kes_voucher_atomic($1,$2,$3)",
    };
    const client = await pool.connect();
    try {
      await client.query("SET ROLE service_role");
      await expect(client.query(queries[action], action === "publish" ? [allocation.voucher_template_id, MERCHANT_A, MERCHANT_USER_A] : [allocation.voucher_template_id])).rejects.toThrow("MANAGED_TEMPLATE_READ_ONLY");
    } finally { await client.query("RESET ROLE"); client.release(); }
    expect((await pool.query("SELECT * FROM spend_voucher_templates WHERE id=$1", [allocation.voucher_template_id])).rows[0]).toEqual(before);
  });

  it("blocks direct service-role changes to managed template locations", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const location = (await pool.query("INSERT INTO merchant_locations(partner_id,name,address_line_1,city) VALUES($1,'Till','Test road','Nairobi') RETURNING id", [MERCHANT_A])).rows[0].id;
    await pool.query("INSERT INTO voucher_template_locations(template_id,location_id) VALUES($1,$2)", [allocation.voucher_template_id, location]);
    const client = await pool.connect();
    try {
      await client.query("SET ROLE service_role");
      await expect(client.query("DELETE FROM voucher_template_locations WHERE template_id=$1", [allocation.voucher_template_id])).rejects.toThrow("MANAGED_TEMPLATE_READ_ONLY");
      await expect(client.query("UPDATE voucher_template_locations SET location_id=location_id WHERE template_id=$1", [allocation.voucher_template_id])).rejects.toThrow("MANAGED_TEMPLATE_READ_ONLY");
      await expect(client.query("INSERT INTO voucher_template_locations(template_id,location_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [allocation.voucher_template_id, location])).rejects.toThrow("MANAGED_TEMPLATE_READ_ONLY");
    } finally { await client.query("RESET ROLE"); client.release(); }
    expect((await pool.query("SELECT * FROM voucher_template_locations WHERE template_id=$1", [allocation.voucher_template_id])).rows).toHaveLength(1);
  });

  it("keeps ordinary merchant template edits available to the server role", async () => {
    const allocation = await createAllocation([]);
    await pool.query("UPDATE spend_voucher_templates SET managed_by='merchant',funding_allocation_id=NULL,funding_mode='merchant_discount' WHERE id=$1", [allocation.voucher_template_id]);
    const client = await pool.connect();
    try {
      await client.query("SET ROLE service_role");
      expect((await client.query("UPDATE spend_voucher_templates SET title='Merchant edit' WHERE id=$1 RETURNING title", [allocation.voucher_template_id])).rows[0].title).toBe("Merchant edit");
    } finally { await client.query("RESET ROLE"); client.release(); }
  });

  it("redeems at a secondary merchant and attributes everything to it", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    expect(claim.error_code, "claim should succeed").toBe("");

    const tokenHash = await present(claim.voucher_id);
    const result = await redeem({ tokenHash, partnerId: MERCHANT_B, gross: 1000 });

    expect(result.error_code, `redemption refused: ${result.error_code}`).toBe("");
    expect(result.ok).toBe(true);

    // 10% of 1000 = 100, under the 200 cap.
    expect(Number(result.discount_amount_kes)).toBe(100);
    expect(Number(result.net_amount_kes)).toBe(900);
    expect(result.funding_mode).toBe("akiba_reimbursement");
    expect(Number(result.reimbursement_amount_kes)).toBe(100);

    const books = await financials(claim.voucher_id);

    // Everything on B, nothing on A.
    expect(books.redemptions.map((r) => r.merchant)).toEqual([MERCHANT_B]);
    expect(books.purchases.map((r) => r.merchant)).toEqual([MERCHANT_B]);
    expect(books.payables.map((r) => r.merchant)).toEqual([MERCHANT_B]);
    for (const row of [...books.redemptions, ...books.purchases, ...books.payables, ...books.milesLedger]) {
      expect(row.merchant).not.toBe(MERCHANT_A);
    }

    // Miles awarded on the net spend, to B.
    expect(books.milesLedger.length).toBeGreaterThan(0);
    for (const reward of books.milesLedger) {
      expect(reward.merchant).toBe(MERCHANT_B);
      expect(reward.canonical_id).toBe(member.canonicalId);
    }
    expect(Number(result.miles_awarded)).toBe(9); // 900 net at 1 Mile per 100
  });

  it("releases the reservation and books the realised reimbursement", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const tokenHash = await present(claim.voucher_id);

    const beforeLedger = await financials(claim.voucher_id);
    // The claim reserves the worst case — the cap, not the eventual discount.
    expect(beforeLedger.ledger.map((l) => l.entry_type)).toEqual(["reservation_created"]);
    expect(Number(beforeLedger.ledger[0].amount_minor)).toBe(CAP_KES * 100);

    await redeem({ tokenHash, partnerId: MERCHANT_B, gross: 1000 });
    const books = await financials(claim.voucher_id);

    const byType = new Map(books.ledger.map((l) => [l.entry_type, Number(l.amount_minor)]));
    // Reservation released in full, then only what the till actually gave.
    expect(byType.get("reservation_released")).toBe(-(CAP_KES * 100));
    expect(byType.get("redemption_realized")).toBe(100 * 100);

    expect(books.payables).toHaveLength(1);
    expect(Number(books.payables[0].payable_amount_minor)).toBe(100 * 100);
    expect(Number(books.payables[0].gross_amount_minor)).toBe(1000 * 100);
  });

  it("honours the cap when the percentage would exceed it", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const tokenHash = await present(claim.voucher_id);

    // 10% of 5000 is 500, above the 200 cap.
    const result = await redeem({ tokenHash, partnerId: MERCHANT_B, gross: 5000 });
    expect(result.error_code).toBe("");
    expect(Number(result.discount_amount_kes)).toBe(CAP_KES);

    const books = await financials(claim.voucher_id);
    // Reimbursement never exceeds what was reserved.
    expect(Number(books.payables[0].payable_amount_minor)).toBe(CAP_KES * 100);
  });

  it("creates no duplicate financial records when a checkout is replayed", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const tokenHash = await present(claim.voucher_id);

    const first = await redeem({ tokenHash, partnerId: MERCHANT_B, gross: 1000 });
    expect(first.ok).toBe(true);

    const replay = await redeem({
      tokenHash,
      partnerId: MERCHANT_B,
      gross: 1000,
      attemptId: first.attemptId,
    });
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(replay.redemption_id).toBe(first.redemption_id);

    const books = await financials(claim.voucher_id);
    expect(books.redemptions).toHaveLength(1);
    expect(books.purchases).toHaveLength(1);
    expect(books.payables).toHaveLength(1);
    expect(books.milesLedger).toHaveLength(1);
    expect(books.ledger.filter((l) => l.entry_type === "redemption_realized")).toHaveLength(1);
  });

  it("allows exactly one redemption when two eligible merchants both try", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const tokenHash = await present(claim.voucher_id);

    // Distinct attempt ids, so this is two real checkouts rather than a replay.
    const [atA, atB] = await Promise.all([
      redeem({ tokenHash, partnerId: MERCHANT_A, merchantUserId: MERCHANT_USER_A, gross: 1000 }),
      redeem({ tokenHash, partnerId: MERCHANT_B, merchantUserId: MERCHANT_USER_B, gross: 1000 }),
    ]);

    const succeeded = [atA, atB].filter((r) => r.ok === true);
    expect(succeeded).toHaveLength(1);

    const books = await financials(claim.voucher_id);

    // Exactly one of every financial record, not just one redemption: a
    // second purchase or a second realised reimbursement would be real money
    // even if the voucher itself were only consumed once.
    expect(books.redemptions).toHaveLength(1);
    expect(books.purchases).toHaveLength(1);
    expect(books.payables).toHaveLength(1);
    expect(books.milesLedger).toHaveLength(1);

    const byType = books.ledger.filter((l) => l.entry_type === "reservation_released");
    expect(byType).toHaveLength(1);
    expect(books.ledger.filter((l) => l.entry_type === "redemption_realized")).toHaveLength(1);
    expect(books.ledger.filter((l) => l.entry_type === "reservation_created")).toHaveLength(1);

    // And every one of them belongs to the merchant that actually won.
    const winner = books.redemptions[0].merchant as string;
    expect([MERCHANT_A, MERCHANT_B]).toContain(winner);
    expect(books.purchases[0].merchant).toBe(winner);
    expect(books.payables[0].merchant).toBe(winner);
    expect(books.milesLedger[0].merchant).toBe(winner);

    // The loser gets nothing at all.
    const loser = winner === MERCHANT_A ? MERCHANT_B : MERCHANT_A;
    for (const row of [...books.redemptions, ...books.purchases, ...books.payables, ...books.milesLedger]) {
      expect(row.merchant).not.toBe(loser);
    }
  });

  it("refuses a merchant outside the set, with no financial trace", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const tokenHash = await present(claim.voucher_id);

    const result = await redeem({ tokenHash, partnerId: MERCHANT_C, gross: 1000 });
    expect(result.ok).toBe(false);

    const books = await financials(claim.voucher_id);
    expect(books.redemptions).toHaveLength(0);
    expect(books.payables).toHaveLength(0);
    expect(books.ledger.map((l) => l.entry_type)).toEqual(["reservation_created"]);
  });

  it("rolls back purchase, Miles and funding effects on a disallowed day", async () => {
    // Weekend-only, then redeemed on whichever day is not allowed.
    const today = (
      await pool.query("SELECT EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Nairobi'))::int AS d")
    ).rows[0].d as number;
    const disallowedForToday = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today);

    const allocation = await createAllocation([MERCHANT_B], {
      redemption_schedule: { days: disallowedForToday, timezone: "Africa/Nairobi" },
    });
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const tokenHash = await present(claim.voucher_id);

    await expect(redeem({ tokenHash, partnerId: MERCHANT_B, gross: 1000 })).rejects.toThrow(
      /REDEMPTION_DAY_NOT_ALLOWED/,
    );

    const books = await financials(claim.voucher_id);
    // The whole transaction unwound: no redemption, no purchase, no award, no
    // payable, and the reservation still standing.
    expect(books.redemptions).toHaveLength(0);
    expect(books.purchases).toHaveLength(0);
    expect(books.payables).toHaveLength(0);
    expect(books.milesLedger).toHaveLength(0);
    expect(books.ledger.map((l) => l.entry_type)).toEqual(["reservation_created"]);

    const { rows } = await pool.query("SELECT status FROM issued_vouchers WHERE id=$1", [claim.voucher_id]);
    expect(rows[0].status).toBe("issued");
  });
  it("inspects and redeems against the legacy TEXT linked_product_id schema", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    expect(claim.ok).toBe(true);
    await pool.query("ALTER TABLE spend_voucher_templates ALTER COLUMN linked_product_id TYPE text USING linked_product_id::text");
    try {
      const tokenHash = await present(claim.voucher_id);
      const { rows } = await pool.query(
        "SELECT * FROM inspect_kes_voucher_presentation($1,$2)", [tokenHash, MERCHANT_B],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].valid).toBe(true);
      expect(rows[0].linked_product_id).toBeNull();
      const result = await redeem({ tokenHash, partnerId: MERCHANT_B, gross: 1000 });
      expect(result.ok).toBe(true);
      const books = await financials(claim.voucher_id);
      expect(books.redemptions.map((row) => row.merchant)).toEqual([MERCHANT_B]);
      expect(books.payables.map((row) => row.merchant)).toEqual([MERCHANT_B]);
    } finally {
      await pool.query("ALTER TABLE spend_voucher_templates ALTER COLUMN linked_product_id TYPE uuid USING linked_product_id::uuid");
      // Runtime DDL changes PL/pgSQL composite-record cached parameter types.
      // Later tests must not inherit sessions compiled against the TEXT shape.
      await pool.end();
      pool = new Pool({ ...ADMIN_CONFIG, database: DB_NAME });
    }
  });

  it("enforces inclusive event dates in Nairobi, including UTC boundaries and later weekends", async () => {
    const schedule = { days: [6,0], timezone: "Africa/Nairobi", startDate: "2026-10-31", endDate: "2026-11-01" };
    for (const [at, expected] of [["2026-10-30T20:59:59Z", false], ["2026-10-30T21:00:00Z", true], ["2026-11-01T20:59:59Z", true], ["2026-11-01T21:00:00Z", false], ["2026-11-07T09:00:00Z", false]] as const) {
      expect((await pool.query("SELECT funded_redemption_day_allowed($1,$2) AS allowed", [JSON.stringify(schedule), at])).rows[0].allowed).toBe(expected);
    }
    for (const invalid of [{ ...schedule, endDate: "2026-10-30" }, { ...schedule, startDate: "2026-02-30" }, { ...schedule, endDate: null }]) {
      await expect(pool.query("SELECT validate_funded_redemption_schedule($1)", [JSON.stringify(invalid)])).rejects.toThrow("INVALID_REDEMPTION_SCHEDULE");
    }
  });
  it("allows early claims, snapshots the event window and caps expiry without allowing early redemption", async () => {
    const dates = (await pool.query("SELECT to_char((now() AT TIME ZONE 'Africa/Nairobi')::date+1,'YYYY-MM-DD') AS start, to_char((now() AT TIME ZONE 'Africa/Nairobi')::date+2,'YYYY-MM-DD') AS end")).rows[0];
    const schedule = { days: [0,1,2,3,4,5,6], timezone: "Africa/Nairobi", startDate: dates.start, endDate: dates.end };
    const allocation = await createAllocation([MERCHANT_B], { redemption_schedule: schedule });
    const member = await seedMember(); const claim = await claimVoucher(allocation.id, member); expect(claim.ok).toBe(true);
    const voucher = (await pool.query("SELECT rules_snapshot, expires_at, (((($2::date+1)::timestamp AT TIME ZONE 'Africa/Nairobi')-interval '1 millisecond')=expires_at) AS capped FROM issued_vouchers WHERE id=$1", [claim.voucher_id, dates.end])).rows[0];
    expect(voucher.rules_snapshot.redemption_schedule).toEqual(schedule); expect(voucher.capped).toBe(true);
    await expect(redeem({ tokenHash: await present(claim.voucher_id), partnerId: MERCHANT_B })).rejects.toThrow("REDEMPTION_DAY_NOT_ALLOWED");
    const books = await financials(claim.voucher_id); expect(books.redemptions).toHaveLength(0); expect(books.payables).toHaveLength(0);
    await expect(pool.query("UPDATE voucher_funding_allocations SET metadata='{}'::jsonb WHERE id=$1", [allocation.id])).rejects.toThrow("REDEMPTION_SCHEDULE_IMMUTABLE");
  });

  it("keeps one merchant statement row through cancelled batches, re-batching, payment and reversal", async () => {
    const allocation = await createAllocation([MERCHANT_B]);
    const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    const result = await redeem({ tokenHash: await present(claim.voucher_id), partnerId: MERCHANT_B, gross: 1000 });
    expect(result.ok).toBe(true);
    const redemption = (await pool.query("SELECT id FROM voucher_redemptions WHERE issued_voucher_id=$1", [claim.voucher_id])).rows[0].id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const statement = async () => {
        const rows = (await client.query("SELECT jsonb_build_object('rows', merchant_voucher_reimbursement_page($1)) AS statement", [MERCHANT_B])).rows[0].statement.rows;
        return rows.filter((row: { voucher_redemption_id: string }) => row.voucher_redemption_id === redemption);
      };
      expect(await statement()).toMatchObject([{ status: "pending", net_payable_minor: 10000 }]);
      const otherMerchant = (await client.query("SELECT jsonb_build_object('rows', merchant_voucher_reimbursement_page($1)) AS statement", [MERCHANT_A])).rows[0].statement.rows;
      expect(otherMerchant.some((row: { voucher_redemption_id: string }) => row.voucher_redemption_id === redemption)).toBe(false);
      for (let i = 0; i < 2; i++) {
        const batch = (await client.query("INSERT INTO voucher_funding_reimbursement_batches(merchant_id,created_by,total_amount_minor) VALUES($1,$2,10000) RETURNING id", [MERCHANT_B, ACTOR_ID])).rows[0].id;
        await client.query("INSERT INTO voucher_funding_batch_items(batch_id,voucher_redemption_id,amount_minor) VALUES($1,$2,10000)", [batch, redemption]);
        await client.query("UPDATE voucher_funding_reimbursement_batches SET state='cancelled' WHERE id=$1", [batch]);
      }
      expect(await statement()).toHaveLength(1);
      expect((await statement())[0]).toMatchObject({ status: "pending", batch_id: null, payment_reference: null });
      const batch = (await client.query("INSERT INTO voucher_funding_reimbursement_batches(merchant_id,created_by,total_amount_minor) VALUES($1,$2,10000) RETURNING id", [MERCHANT_B, ACTOR_ID])).rows[0].id;
      await client.query("INSERT INTO voucher_funding_batch_items(batch_id,voucher_redemption_id,amount_minor) VALUES($1,$2,10000)", [batch, redemption]);
      await client.query("UPDATE voucher_funding_reimbursement_batches SET state='submitted' WHERE id=$1", [batch]);
      expect(await statement()).toHaveLength(1);
      expect((await statement())[0]).toMatchObject({ status: "batched", net_payable_minor: 10000 });
      await client.query("UPDATE voucher_funding_reimbursement_batches SET state='paid',payment_reference='TEST-PAID',payment_evidence_ref='TEST-EVIDENCE',paid_at=now() WHERE id=$1", [batch]);
      expect((await statement())[0]).toMatchObject({ status: "paid", payment_reference: "TEST-PAID" });
      expect((await client.query("SELECT merchant_voucher_reimbursement_summary($1) AS s", [MERCHANT_B])).rows[0].s.paidMinor).toBe(10000);
      await client.query("SELECT * FROM reverse_akiba_funded_redemption_atomic($1,$2,'Test reversal',true,NULL)", [redemption, ACTOR_ID]);
      expect(await statement()).toHaveLength(1);
      expect((await statement())[0]).toMatchObject({ status: "reversed", net_payable_minor: 0 });
      expect((await client.query("SELECT merchant_voucher_reimbursement_summary($1) AS s", [MERCHANT_B])).rows[0].s.paidMinor).toBe(10000);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("paginates 10,001 tied-timestamp ledger rows without duplicates or truncated totals", async () => {
    const client = await pool.connect(); const merchant = randomUUID();
    const allocation = await createAllocation([MERCHANT_B]); const member = await seedMember();
    const claim = await claimVoucher(allocation.id, member);
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,$2,'Statement benchmark','active','KE','merchant')", [merchant, `bench-${merchant}`]);
      await client.query("CREATE TEMP TABLE statement_bench AS SELECT gen_random_uuid() AS voucher_id,gen_random_uuid() AS redemption_id,n FROM generate_series(1,10001) n");
      await client.query(`INSERT INTO issued_vouchers(id,code,status,hub_user_id,voucher_template_id,acquisition_source,funding_type,rules_snapshot)
        SELECT v.voucher_id,v.voucher_id::text,'redeemed',iv.hub_user_id,iv.voucher_template_id,iv.acquisition_source,iv.funding_type,iv.rules_snapshot
        FROM statement_bench v CROSS JOIN issued_vouchers iv WHERE iv.id=$1`, [claim.voucher_id]);
      await client.query(`INSERT INTO voucher_redemptions(id,issued_voucher_id,merchant_id,discount_applied,discount_amount_kes,redeemed_at,funding_mode,external_reference)
        SELECT redemption_id,voucher_id,$1,100,100,'2026-10-01T12:00:00Z','akiba_reimbursement','BENCH-'||n FROM statement_bench`, [merchant]);
      await client.query(`INSERT INTO voucher_funding_payables(allocation_id,issued_voucher_id,voucher_redemption_id,merchant_id,gross_amount_minor,discount_amount_minor,payable_amount_minor,entry_type,idempotency_key)
        SELECT $1,voucher_id,redemption_id,$2,100000,10000,10000,'payable_created',redemption_id::text FROM statement_bench`, [allocation.id, merchant]);
      const started = performance.now();
      const summary = (await client.query("SELECT merchant_voucher_reimbursement_summary($1) AS s", [merchant])).rows[0].s;
      const summaryMs = performance.now() - started;
      expect(summary).toEqual({ outstandingMinor: 100010000, inPaymentMinor: 0, paidMinor: 0 });
      const ids = new Set<string>(); let at: string | null = null, id: string | null = null, pages = 0, maxPageBytes = 0;
      const pageStarted = performance.now();
      for (;;) {
        const rows: Array<{ voucher_redemption_id: string; redeemed_at: string }> = (await client.query("SELECT merchant_voucher_reimbursement_page($1,200,$2,$3) AS p", [merchant, at, id])).rows[0].p;
        expect(rows.length).toBeLessThanOrEqual(200); maxPageBytes = Math.max(maxPageBytes, Buffer.byteLength(JSON.stringify(rows)));
        for (const row of rows) { expect(ids.has(row.voucher_redemption_id)).toBe(false); ids.add(row.voucher_redemption_id); }
        pages++; if (rows.length < 200) break;
        const last = rows.at(-1)!; at = last.redeemed_at; id = last.voucher_redemption_id;
      }
      expect(ids.size).toBe(10001); expect(pages).toBe(51);
      console.info(JSON.stringify({ benchmark: "merchant_statement", ledgerRows: ids.size, summaryMs, allPagesMs: performance.now() - pageStarted, maxPageBytes }));
      await expect(client.query("SELECT merchant_voucher_reimbursement_page($1,201)", [merchant])).rejects.toThrow("INVALID_STATEMENT_PAGE");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("keeps bounded financial functions private and refuses the old unbounded contract", async () => {
    for (const signature of ["merchant_voucher_reimbursement_summary(uuid)", "merchant_voucher_reimbursement_page(uuid,integer,timestamp with time zone,uuid)"]) {
      const result = await pool.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service_role", [signature]);
      expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service_role: true });
    }
    await expect(pool.query("SELECT merchant_voucher_reimbursement_statement($1)", [MERCHANT_B])).rejects.toThrow("STATEMENT_CLIENT_UPGRADE_REQUIRED");
  });

  it("restricts merchant reimbursement statement RPC access to the server role", async () => {
    const { rows } = await pool.query(`SELECT
      has_function_privilege('anon','merchant_voucher_reimbursement_statement(uuid)','EXECUTE') AS anon,
      has_function_privilege('authenticated','merchant_voucher_reimbursement_statement(uuid)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','merchant_voucher_reimbursement_statement(uuid)','EXECUTE') AS service_role`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service_role: true });
  });

  it("denies anon and authenticated SQL reads across the entire private financial view dependency chain", async () => {
    const { rows: views } = await pool.query(`WITH RECURSIVE finance(oid) AS (
      SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace
        AND relname IN ('voucher_funding_programs','voucher_funding_allocations',
          'voucher_funding_ledger_entries','voucher_funding_payables',
          'voucher_funding_reimbursement_batches','voucher_funding_reconciliation_incidents')
      UNION SELECT r.ev_class FROM finance f JOIN pg_depend d ON d.refobjid=f.oid
        JOIN pg_rewrite r ON r.oid=d.objid AND d.classid='pg_rewrite'::regclass
    ) SELECT DISTINCT c.relname,c.reloptions,
        has_table_privilege('anon',c.oid,'SELECT') AS anon_read,
        has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,
        has_table_privilege('service_role',c.oid,'SELECT') AS service_read
      FROM finance f JOIN pg_class c ON c.oid=f.oid
      WHERE c.relkind='v' AND c.relnamespace='public'::regnamespace ORDER BY c.relname`);
    expect(views).toHaveLength(9);
    for (const view of views) {
      expect(view, view.relname).toMatchObject({ anon_read: false, authenticated_read: false, service_read: true });
      expect(view.reloptions, view.relname).toContain("security_invoker=true");
      // Names come from the catalog; quote them rather than trusting SQL text.
      const name = '"' + String(view.relname).replaceAll('"', '""') + '"';
      for (const role of ["anon", "authenticated"]) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL ROLE ${role}`);
          await expect(client.query(`SELECT * FROM public.${name} LIMIT 1`)).rejects.toMatchObject({ code: "42501" });
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE service_role");
        await expect(client.query(`SELECT * FROM public.${name} LIMIT 1`)).resolves.toHaveProperty("rows");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
  });

  it("retains merchant-scoped statement RPC results for the service role after hardening views", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE service_role");
      const { rows } = await client.query("SELECT jsonb_build_object('rows', merchant_voucher_reimbursement_page($1)) AS statement", [MERCHANT_B]);
      expect(rows[0].statement.rows.length).toBeGreaterThan(0);
      expect(rows[0].statement.rows.every((row: { merchant_id: string }) => row.merchant_id === MERCHANT_B)).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  async function freshPayable() {
    const allocation = await createAllocation([MERCHANT_B]);
    const claim = await claimVoucher(allocation.id, await seedMember());
    const result = await redeem({ tokenHash: await present(claim.voucher_id), partnerId: MERCHANT_B, gross: 1000 });
    expect(result.ok).toBe(true);
    return (await pool.query("SELECT id FROM voucher_redemptions WHERE issued_voucher_id=$1", [claim.voucher_id])).rows[0].id as string;
  }

  async function competeForBatches(ids: string[], options: { direct?: boolean; isolation?: string; rollbackWinner?: boolean } = {}) {
    const a = await pool.connect();
    const b = await pool.connect();
    let secondSettled = false;
    let observedWait = false;
    try {
      const isolation = options.isolation === "REPEATABLE READ" ? "REPEATABLE READ" : "READ COMMITTED";
      await a.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await b.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await a.query("SET LOCAL statement_timeout='8s'");
      await b.query("SET LOCAL statement_timeout='8s'");
      const pid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const batches: string[] = [];
      if (options.direct) {
        for (const client of [a,b]) {
          const row = (await client.query("INSERT INTO voucher_funding_reimbursement_batches(merchant_id,created_by,total_amount_minor) VALUES($1,$2,10000) RETURNING id", [MERCHANT_B, ACTOR_ID])).rows[0];
          batches.push(row.id);
        }
      }
      const run = async (client: pg.PoolClient, index: number) => {
        if (options.direct) {
          await client.query("INSERT INTO voucher_funding_batch_items(batch_id,voucher_redemption_id,amount_minor) VALUES($1,$2,10000)", [batches[index], ids[0]]);
          return batches[index];
        }
        const list = index === 0 ? ids : [...ids].reverse();
        return (await client.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B, ACTOR_ID, list])).rows[0].id;
      };
      const firstId = await run(a,0);
      const second = run(b,1).then(id => { secondSettled = true; return { ok: true, id, message: "" }; }, error => {
        secondSettled = true;
        return { ok: false, id: "", message: String(error.message) };
      });
      // Observe an actual lock wait rather than relying on arbitrary timing.
      const deadline = Date.now()+3000;
      while (!secondSettled && Date.now()<deadline) {
        const { rows } = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
        if (rows[0]?.wait_event_type === "Lock") { observedWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await a.query(options.rollbackWinner ? "ROLLBACK" : "COMMIT");
      const result = await second;
      // Attempt to commit both successful calls. A SQL error leaves its
      // transaction aborted; roll it back explicitly rather than hiding it.
      await b.query(result.ok ? "COMMIT" : "ROLLBACK");
      return { firstId, second: result, observedWait };
    } finally {
      await Promise.all([a.query("ROLLBACK").catch(()=>{}),b.query("ROLLBACK").catch(()=>{})]);
      a.release(); b.release();
    }
  }

  it.each(["READ COMMITTED", "REPEATABLE READ"])("commits exactly one live batch for competing RPC calls at %s", async isolation => {
    const redemption = await freshPayable();
    const before = Number((await pool.query("SELECT count(*) AS n FROM voucher_funding_reimbursement_batches")).rows[0].n);
    const result = await competeForBatches([redemption], { isolation });
    expect(result.observedWait).toBe(true);
    expect(result.second.ok).toBe(false);
    expect(result.second.message).toMatch(/SOME_PAYABLES_NOT_ELIGIBLE_FOR_BATCHING|PAYABLE_ALREADY_IN_LIVE_BATCH|could not serialize/i);
    expect((await pool.query(`SELECT count(*)::int AS n FROM voucher_funding_batch_items i JOIN voucher_funding_reimbursement_batches b ON b.id=i.batch_id WHERE i.voucher_redemption_id=$1 AND b.state<>'cancelled'`, [redemption])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=$1", [redemption])).rows[0].n).toBe(1);
    expect(Number((await pool.query("SELECT count(*) AS n FROM voucher_funding_reimbursement_batches")).rows[0].n)).toBe(before+1);
  });

  it("protects direct item inserts, independently of the create RPC", async () => {
    const redemption = await freshPayable();
    const result = await competeForBatches([redemption], { direct: true });
    expect(result.observedWait).toBe(true);
    expect(result.second).toMatchObject({ ok: false, message: "PAYABLE_ALREADY_IN_LIVE_BATCH" });
    expect((await pool.query("SELECT count(*)::int AS n FROM voucher_funding_batch_items WHERE voucher_redemption_id=$1", [redemption])).rows[0].n).toBe(1);
  });

  it("lets the waiting transaction commit if the first reservation rolls back", async () => {
    const redemption = await freshPayable();
    const result = await competeForBatches([redemption], { rollbackWinner: true });
    expect(result.observedWait).toBe(true);
    expect(result.second.ok).toBe(true);
    expect((await pool.query("SELECT batch_id FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=$1", [redemption])).rows).toEqual([{ batch_id: result.second.id }]);
  });

  it("locks overlapping redemption sets deterministically when callers send opposite orders", async () => {
    const ids = [await freshPayable(), await freshPayable()];
    const result = await competeForBatches(ids);
    expect(result.observedWait).toBe(true);
    expect(result.second.ok).toBe(false);
    expect(result.second.message).not.toMatch(/deadlock/i);
    expect((await pool.query("SELECT count(*)::int AS n FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=ANY($1)", [ids])).rows[0].n).toBe(2);
  });

  it("releases cancelled membership without permitting cancelled history to reactivate", async () => {
    const redemption = await freshPayable();
    const batch = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B, ACTOR_ID, [redemption]])).rows[0];
    await pool.query("SELECT * FROM transition_voucher_reimbursement_batch_atomic($1,'cancel',$2,NULL,NULL,'Test cancellation')", [batch.id,ACTOR_ID]);
    expect((await pool.query("SELECT count(*)::int AS n FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=$1", [redemption])).rows[0].n).toBe(0);
    const replacement = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B, ACTOR_ID, [redemption]])).rows[0];
    expect(replacement.id).not.toBe(batch.id);
    await expect(pool.query("UPDATE voucher_funding_reimbursement_batches SET state='draft' WHERE id=$1", [batch.id])).rejects.toThrow(/CANCELLED_BATCH_IS_TERMINAL/);
    expect((await pool.query("SELECT batch_id FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=$1", [redemption])).rows).toEqual([{ batch_id: replacement.id }]);
  });

  it("keeps paid reservations and refuses to release them through a direct state write", async () => {
    const redemption = await freshPayable();
    const batch = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B, ACTOR_ID, [redemption]])).rows[0];
    await pool.query("SELECT * FROM transition_voucher_reimbursement_batch_atomic($1,'submit',$2,NULL,NULL,NULL)", [batch.id,ACTOR_ID]);
    await pool.query("SELECT * FROM transition_voucher_reimbursement_batch_atomic($1,'pay',$2,'TEST-PAID','TEST-EVIDENCE',NULL)", [batch.id,ACTOR_ID]);
    await expect(pool.query("UPDATE voucher_funding_reimbursement_batches SET state='cancelled' WHERE id=$1", [batch.id])).rejects.toThrow(/PAID_BATCH_IS_TERMINAL/);
    await expect(pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B,ACTOR_ID,[redemption]])).rejects.toThrow(/SOME_PAYABLES_NOT_ELIGIBLE_FOR_BATCHING/);
    expect((await pool.query("SELECT batch_id FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=$1", [redemption])).rows).toEqual([{ batch_id: batch.id }]);
  });

  it("does not expose the reservation table or grant direct reservation mutation to server clients", async () => {
    const { rows } = await pool.query(`SELECT
      has_table_privilege('anon','voucher_funding_live_batch_memberships','SELECT') AS anon_read,
      has_table_privilege('authenticated','voucher_funding_live_batch_memberships','SELECT') AS authenticated_read,
      has_table_privilege('service_role','voucher_funding_live_batch_memberships','SELECT') AS service_read,
      has_table_privilege('service_role','voucher_funding_live_batch_memberships','INSERT') AS service_insert,
      has_table_privilege('service_role','voucher_funding_live_batch_memberships','UPDATE') AS service_update,
      has_table_privilege('service_role','voucher_funding_live_batch_memberships','DELETE') AS service_delete,
      (SELECT relrowsecurity FROM pg_class WHERE oid='voucher_funding_live_batch_memberships'::regclass) AS rls`);
    expect(rows[0]).toEqual({ anon_read: false, authenticated_read: false, service_read: true, service_insert: false, service_update: false, service_delete: false, rls: true });
  });

  it("backfills existing non-cancelled items when upgrading an older settlement schema", async () => {
    const redemption = await freshPayable();
    const batch = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B,ACTOR_ID,[redemption]])).rows[0];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Recreate the pre-161 schema in this rolled-back transaction; this
      // exercises the actual forward migration against populated history.
      await client.query("DROP TRIGGER trg_vfrb_live_memberships ON voucher_funding_reimbursement_batches");
      await client.query("DROP TABLE voucher_funding_live_batch_memberships");
      await client.query(readFileSync(resolve(PLATFORM_ROOT,"supabase/migrations/161_unique_live_voucher_batch_membership.sql"),"utf8"));
      expect((await client.query("SELECT batch_id FROM voucher_funding_live_batch_memberships WHERE voucher_redemption_id=$1", [redemption])).rows).toEqual([{ batch_id: batch.id }]);
      const { rows } = await client.query(`SELECT
        (SELECT count(*)::int FROM voucher_funding_live_batch_memberships) AS reservations,
        (SELECT count(*)::int FROM voucher_funding_batch_items i JOIN voucher_funding_reimbursement_batches b ON b.id=i.batch_id WHERE b.state<>'cancelled') AS live_items,
        (SELECT count(*)::int FROM voucher_funding_live_batch_memberships r JOIN voucher_funding_reimbursement_batches b ON b.id=r.batch_id WHERE b.state='cancelled') AS cancelled`);
      expect(rows[0].reservations).toBe(rows[0].live_items);
      expect(rows[0].cancelled).toBe(0);
    } finally {
      await client.query("ROLLBACK");client.release();
    }
  });

  it("aborts the upgrade rather than silently choosing between existing duplicate live batches", async () => {
    const redemption = await freshPayable();
    await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B,ACTOR_ID,[redemption]]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP TRIGGER trg_vfrb_live_memberships ON voucher_funding_reimbursement_batches");
      await client.query("DROP TABLE voucher_funding_live_batch_memberships");
      await client.query("ALTER TABLE voucher_funding_batch_items DISABLE TRIGGER trg_vfbi_single_live_batch");
      const batch = (await client.query("INSERT INTO voucher_funding_reimbursement_batches(merchant_id,created_by,total_amount_minor) VALUES($1,$2,10000) RETURNING id", [MERCHANT_B,ACTOR_ID])).rows[0];
      await client.query("INSERT INTO voucher_funding_batch_items(batch_id,voucher_redemption_id,amount_minor) VALUES($1,$2,10000)", [batch.id,redemption]);
      await client.query("ALTER TABLE voucher_funding_batch_items ENABLE TRIGGER trg_vfbi_single_live_batch");
      await expect(client.query(readFileSync(resolve(PLATFORM_ROOT,"supabase/migrations/161_unique_live_voucher_batch_membership.sql"),"utf8"))).rejects.toThrow(/EXISTING_DUPLICATE_LIVE_BATCH_MEMBERSHIP/);
    } finally {
      await client.query("ROLLBACK");client.release();
    }
  });

  async function newSettlementBatch() {
    const redemption = await freshPayable();
    const batch = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B,ACTOR_ID,[redemption]])).rows[0];
    return { redemption, batch };
  }
  const settle = (client: pg.Pool | pg.PoolClient, id: string, action: string) => client.query(
    "SELECT * FROM transition_voucher_reimbursement_batch_atomic($1,$2,$3,'TEST-PAYMENT','TEST-EVIDENCE','Test settlement')", [id,action,ACTOR_ID]);
  const reversePart = (client: pg.Pool | pg.PoolClient, id: string, amount = 60) => client.query(
    "SELECT * FROM reverse_akiba_funded_redemption_atomic($1,$2,'Test partial reversal',false,$3)", [id,ACTOR_ID,amount]);

  it.each(["submit","pay"])("rejects a stale %s without changing state, evidence or audit history", async action => {
    const { redemption,batch } = await newSettlementBatch();
    if (action === "pay") await settle(pool,batch.id,"submit");
    await reversePart(pool,redemption);
    const before = (await pool.query("SELECT * FROM voucher_funding_reimbursement_batches WHERE id=$1", [batch.id])).rows[0];
    const auditBefore = (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1",[batch.id])).rows[0].n;
    await expect(settle(pool,batch.id,action)).rejects.toThrow(/BATCH_PAYABLES_CHANGED/);
    expect((await pool.query("SELECT * FROM voucher_funding_reimbursement_batches WHERE id=$1", [batch.id])).rows[0]).toEqual(before);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1",[batch.id])).rows[0].n).toBe(auditBefore);
    expect(Number((await pool.query("SELECT net_payable_minor FROM v_voucher_payable_net_amounts WHERE voucher_redemption_id=$1",[redemption])).rows[0].net_payable_minor)).toBe(4000);
    await settle(pool,batch.id,"cancel");
    const replacement = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)", [MERCHANT_B,ACTOR_ID,[redemption]])).rows[0];
    expect(Number(replacement.total_amount_minor)).toBe(4000);
    await settle(pool,replacement.id,"submit");await settle(pool,replacement.id,"pay");
  });

  it("rejects direct state writes, total tampering and net-neutral per-item changes", async () => {
    const first = await freshPayable(), second = await freshPayable();
    const batch = (await pool.query("SELECT * FROM create_voucher_reimbursement_batch_atomic($1,$2,$3)",[MERCHANT_B,ACTOR_ID,[first,second]])).rows[0];
    // The total is still KES200, but one entitlement falls and the other
    // rises: checking only the sum would miss both mismatched item amounts.
    for (const [id,amount] of [[first,-6000],[second,6000]] as const) {
      await pool.query(`INSERT INTO voucher_funding_payables(allocation_id,issued_voucher_id,voucher_redemption_id,merchant_id,gross_amount_minor,discount_amount_minor,payable_amount_minor,entry_type,idempotency_key)
        SELECT allocation_id,issued_voucher_id,voucher_redemption_id,merchant_id,0,0,$2,'adjustment',$3 FROM voucher_funding_payables WHERE voucher_redemption_id=$1 AND entry_type='payable_created'`,[id,amount,randomUUID()]);
    }
    await expect(pool.query("UPDATE voucher_funding_reimbursement_batches SET state='submitted' WHERE id=$1",[batch.id])).rejects.toThrow(/BATCH_PAYABLES_CHANGED/);
    const clean = await newSettlementBatch();
    await pool.query("UPDATE voucher_funding_reimbursement_batches SET total_amount_minor=9999 WHERE id=$1",[clean.batch.id]);
    await expect(settle(pool,clean.batch.id,"submit")).rejects.toThrow(/BATCH_PAYABLES_CHANGED/);
  });

  it("rejects a fully reversed batch while preserving the cancellation recovery path", async () => {
    const { redemption,batch } = await newSettlementBatch();
    await pool.query("SELECT * FROM reverse_akiba_funded_redemption_atomic($1,$2,'Full test reversal',true,NULL)",[redemption,ACTOR_ID]);
    await expect(settle(pool,batch.id,"submit")).rejects.toThrow(/BATCH_PAYABLES_CHANGED/);
    await settle(pool,batch.id,"cancel");
    expect((await pool.query("SELECT count(*)::int AS n FROM voucher_funding_live_batch_memberships WHERE batch_id=$1",[batch.id])).rows[0].n).toBe(0);
  });

  async function settlementRace(reverseFirst: boolean, isolation: string) {
    const { redemption,batch } = await newSettlementBatch();
    await settle(pool,batch.id,"submit");
    const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query("BEGIN");
      await b.query(isolation === "REPEATABLE READ" ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN");
      await a.query("SET LOCAL statement_timeout='8s'");await b.query("SET LOCAL statement_timeout='8s'");
      // Establish a snapshot before the winning operation changes anything.
      await b.query("SELECT count(*) FROM voucher_funding_batch_items WHERE batch_id=$1",[batch.id]);
      const pid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await (reverseFirst ? reversePart(a,redemption) : settle(a,batch.id,"pay"));
      let done = false, waited = false;
      const pending = (reverseFirst ? settle(b,batch.id,"pay") : reversePart(b,redemption)).then(
        result=>{ done=true;return { ok:true,code:"",message:"",row:result.rows[0] }; },
        error=>{ done=true;return { ok:false,code:String(error.code),message:String(error.message),row:null }; });
      const deadline = Date.now()+3000;
      while (!done && Date.now()<deadline) {
        if ((await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.wait_event_type === "Lock") { waited=true;break; }
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await a.query("COMMIT");
      const result = await pending;
      await b.query(result.ok ? "COMMIT" : "ROLLBACK");
      expect(waited).toBe(true);
      if (reverseFirst) {
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/BATCH_PAYABLES_CHANGED|could not serialize/i);
        expect((await pool.query("SELECT state FROM voucher_funding_reimbursement_batches WHERE id=$1",[batch.id])).rows[0].state).toBe("submitted");
      } else {
        if (isolation === "REPEATABLE READ") {
          expect(result.code).toBe("40001");
          await reversePart(pool,redemption); // fresh-snapshot retry
        } else expect(result.ok).toBe(true);
        expect((await pool.query("SELECT count(*)::int AS n FROM voucher_funding_reconciliation_incidents WHERE entity_id=$1 AND incident_type='reversal_after_payment'",[redemption])).rows[0].n).toBe(1);
        expect(Number((await pool.query("SELECT total_amount_minor FROM voucher_funding_reimbursement_batches WHERE id=$1",[batch.id])).rows[0].total_amount_minor)).toBe(10000);
      }
    } finally {
      await Promise.all([a.query("ROLLBACK").catch(()=>{}),b.query("ROLLBACK").catch(()=>{})]);a.release();b.release();
    }
  }
  it.each(["READ COMMITTED","REPEATABLE READ"])("blocks stale payment when a reversal commits first at %s", async isolation=>{
    await settlementRace(true,isolation);
  });
  it.each(["READ COMMITTED","REPEATABLE READ"])("preserves paid history and reconciliation when payment commits first at %s", async isolation=>{
    await settlementRace(false,isolation);
  });

});
