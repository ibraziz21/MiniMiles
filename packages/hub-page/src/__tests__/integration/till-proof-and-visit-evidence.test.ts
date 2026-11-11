/**
 * Till proof, notification ownership and verified-visit evidence — on the
 * real award chain (Akiba-Platform migration 172).
 *
 * Replays the full Akiba-Platform history plus MiniMiles (helpers/
 * platformReplay.ts), so every call below goes through the real
 * award_purchase_reward_v2, the real Miles-earned outbox trigger and the real
 * voucher redemption function — not stand-ins.
 *
 * Covers:
 *   - a signed till award: purchase, Miles, outbox row and proof commit together;
 *   - an exact retry: original outcome, no second purchase, Miles, outbox row or proof;
 *   - a historical purchase (old till label + caller metadata) never gaining
 *     proof, through a conflicting retry or an exact one;
 *   - a failed award leaving nothing behind;
 *   - two concurrent requests with the same reference: one purchase, one proof;
 *   - the notification recipient bound to the purchase's own identities;
 *   - purchase_visit_evidence for every ownership outcome;
 *   - regressions: a real till purchase and a real voucher redemption still
 *     count as in-store visits for their member.
 *
 * Requires a local PostgreSQL and the Akiba-Platform checkout beside this repo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "crypto";

import { PLATFORM_AVAILABLE, assertAwardChainPresent, replayAll } from "./helpers/platformReplay";

const DB_NAME = "hub_till_proof_evidence_test";
const ADMIN_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "postgres",
};

let pool: pg.Pool;

const ACTOR_ID = randomUUID();
const PROGRAM_ID = randomUUID();
const MERCHANT = randomUUID();
const OTHER_MERCHANT = randomUUID();
const MERCHANT_USER = randomUUID();

type Member = { hubUserId: string; canonicalId: string; email: string };

async function seedPartner(id: string, slug: string) {
  await pool.query(
    "INSERT INTO partners(id,slug,name,status,country,type) VALUES($1,$2,$3,'active','KE','merchant')",
    [id, slug, `Shop ${slug}`],
  );
  await pool.query("INSERT INTO partner_subscriptions(partner_id,status) VALUES($1,'active')", [id]);
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

async function seedMember(): Promise<Member> {
  const hubUserId = randomUUID();
  const email = `${hubUserId}@example.test`;
  await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [hubUserId, email]);
  await pool.query(
    "INSERT INTO hub_user_canonicals(hub_user_id,canonical_id) VALUES($1,$2) ON CONFLICT (hub_user_id) DO NOTHING",
    [hubUserId, randomUUID()],
  );
  const { rows } = await pool.query("SELECT canonical_id::text AS id FROM hub_user_canonicals WHERE hub_user_id=$1", [hubUserId]);
  await pool.query(
    `INSERT INTO hub_user_profiles(user_id,country,country_code) VALUES($1,'KE','KE')
     ON CONFLICT (user_id) DO UPDATE SET country='KE', country_code='KE'`,
    [hubUserId],
  );
  await pool.query("INSERT INTO hub_user_passes(user_id,email) VALUES($1,$2) ON CONFLICT DO NOTHING", [hubUserId, email]);
  await pool.query(
    "INSERT INTO leaderboard_profiles(canonical_id,username) VALUES($1,$2) ON CONFLICT (canonical_id) DO NOTHING",
    [rows[0].id, `m${hubUserId.replace(/-/g, "").slice(0, 10)}`],
  );
  return { hubUserId, canonicalId: rows[0].id as string, email };
}

type AwardInput = {
  externalId?: string;
  member: Member;
  amount?: number;
  source?: string;
  metadata?: Record<string, unknown>;
  merchant?: string;
  occurredAt?: string;
  extraEmails?: string[];
  wallet?: string;
};

function awardArgs(input: AwardInput) {
  const externalId = input.externalId ?? `scan-award-${randomUUID()}`;
  const amount = input.amount ?? 1000;
  const source = input.source ?? "scan_award";
  const occurredAt = input.occurredAt ?? "2026-11-11T09:00:00.000Z";
  const identities = input.wallet
    ? [{ type: "wallet", value: input.wallet }]
    : [input.member.email, ...(input.extraEmails ?? [])].map((value) => ({ type: "email", value }));
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ externalId, amount, source, occurredAt, identities }))
    .digest("hex");
  return [
    input.merchant ?? MERCHANT, externalId, externalId, JSON.stringify(identities), amount, "KES", null,
    source, occurredAt, JSON.stringify(input.metadata ?? { channel: "in_store" }), payloadHash,
  ];
}

const AWARD_SQL = (fn: string) => `SELECT ${fn}($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::timestamptz,$10::jsonb,$11) AS r`;

async function tillAward(input: AwardInput, client: pg.Pool | pg.PoolClient = pool) {
  return (await client.query(AWARD_SQL("award_till_purchase_atomic"), awardArgs(input))).rows[0].r as Record<string, unknown>;
}
async function plainAward(input: AwardInput) {
  return (await pool.query(AWARD_SQL("award_purchase_reward_v2"), awardArgs(input))).rows[0].r as Record<string, unknown>;
}

async function evidence(purchaseId: string, member: string, merchant: string | null = MERCHANT) {
  return (await pool.query("SELECT purchase_visit_evidence($1,$2,$3) AS e", [purchaseId, member, merchant])).rows[0].e as {
    found: boolean; owned: boolean; ownership: string; channel: string;
  };
}

async function counts(externalId: string) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM purchase_events WHERE merchant_id=$1 AND external_purchase_id=$2) AS purchases,
       (SELECT count(*) FROM purchase_till_proofs p JOIN purchase_events pe ON pe.id=p.purchase_event_id
          WHERE pe.merchant_id=$1 AND pe.external_purchase_id=$2) AS proofs,
       (SELECT count(*) FROM miles_earned_notification_outbox o JOIN purchase_events pe ON pe.id=o.purchase_event_id
          WHERE pe.merchant_id=$1 AND pe.external_purchase_id=$2) AS outbox,
       (SELECT COALESCE(sum(ml.amount),0) FROM miles_ledger ml JOIN purchase_events pe ON pe.reward_id::text=ml.source_id::text OR pe.id::text=ml.source_id::text
          WHERE pe.merchant_id=$1 AND pe.external_purchase_id=$2) AS miles`,
    [MERCHANT, externalId],
  );
  const row = rows[0];
  return { purchases: Number(row.purchases), proofs: Number(row.proofs), outbox: Number(row.outbox), miles: Number(row.miles) };
}

describe.skipIf(!PLATFORM_AVAILABLE)("till proof and visit evidence on the real award chain", () => {
  beforeAll(async () => {
    const replayed = await replayAll(DB_NAME, ADMIN_CONFIG);
    pool = replayed.pool;
    expect(replayed.report.failures, replayed.report.failures.map((f) => `${f.file}: ${f.error}`).join("\n")).toEqual([]);
    expect(await assertAwardChainPresent(pool)).toEqual([]);
    const { rows: fns } = await pool.query(
      "SELECT proname FROM pg_proc WHERE proname IN ('award_till_purchase_atomic','purchase_visit_evidence')",
    );
    expect(fns.map((f) => f.proname).sort()).toEqual(["award_till_purchase_atomic", "purchase_visit_evidence"]);

    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,'ops@example.test')", [ACTOR_ID]);
    await seedPartner(MERCHANT, "kahawa");
    await seedPartner(OTHER_MERCHANT, "zuri");
    await pool.query(
      "INSERT INTO merchant_users(id,email,password_hash,partner_id,role,is_active) VALUES($1,'till@example.test','x',$2,'owner',true)",
      [MERCHANT_USER, MERCHANT],
    );
    await pool.query(
      `INSERT INTO voucher_funding_programs(id,name,country_code,authorized_budget_minor,state,starts_at,ends_at,created_by)
       VALUES($1,'Acquisition','KE',100000000,'active',now()-interval '1 day',now()+interval '90 days',$2)`,
      [PROGRAM_ID, ACTOR_ID],
    );
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Pool(ADMIN_CONFIG);
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    } finally {
      await admin.end();
    }
  });

  describe("award_till_purchase_atomic", () => {
    it("commits the purchase, its Miles, its outbox row and its proof together", async () => {
      const member = await seedMember();
      const externalId = `scan-award-${randomUUID()}`;

      const result = await tillAward({ externalId, member });

      expect(result).toMatchObject({ status: "rewarded", idempotent: false, tillProof: true });
      expect(await counts(externalId)).toMatchObject({ purchases: 1, proofs: 1, outbox: 1 });
      const { rows: proof } = await pool.query("SELECT purchase_event_id::text AS id, source_app FROM purchase_till_proofs WHERE purchase_event_id=$1", [result.purchaseEventId]);
      expect(proof).toEqual([{ id: result.purchaseEventId, source_app: "scan_award" }]);
      const { rows: outbox } = await pool.query("SELECT hub_user_id::text AS member, source FROM miles_earned_notification_outbox WHERE purchase_event_id=$1", [result.purchaseEventId]);
      expect(outbox).toEqual([{ member: member.hubUserId, source: "merchant_scan" }]);
      expect(await evidence(result.purchaseEventId as string, member.hubUserId)).toEqual({
        found: true, owned: true, ownership: "owned_canonical", channel: "in_store",
      });
    });

    it("returns the original outcome on an exact retry without duplicating anything", async () => {
      const member = await seedMember();
      const externalId = `scan-award-${randomUUID()}`;
      const first = await tillAward({ externalId, member });
      const before = await counts(externalId);

      const retry = await tillAward({ externalId, member });

      expect(retry).toMatchObject({ purchaseEventId: first.purchaseEventId, idempotent: true, tillProof: true, milesAwarded: first.milesAwarded });
      expect(await counts(externalId)).toEqual(before);
    });

    it("never gives a historical purchase proof — not by a conflicting retry, not by an exact one", async () => {
      const member = await seedMember();
      const externalId = `scan-award-${randomUUID()}`;
      // As the old API allowed: a till label and caller metadata claiming
      // verification, written without any till signature.
      const historical = await plainAward({ externalId, member, metadata: { channel: "in_store", akiba_till_verified: true } });
      expect(await evidence(historical.purchaseEventId as string, member.hubUserId)).toMatchObject({ owned: true, channel: "unknown" });

      await expect(tillAward({ externalId, member, amount: 5000 })).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
      expect(await counts(externalId)).toMatchObject({ purchases: 1, proofs: 0 });

      const replay = await tillAward({ externalId, member, metadata: { channel: "in_store", akiba_till_verified: true } });
      expect(replay).toMatchObject({ purchaseEventId: historical.purchaseEventId, idempotent: true, tillProof: false });
      expect(await counts(externalId)).toMatchObject({ purchases: 1, proofs: 0, outbox: 1 });
      expect(await evidence(historical.purchaseEventId as string, member.hubUserId)).toMatchObject({ channel: "unknown" });
    });

    it("leaves nothing behind when the award fails", async () => {
      const member = await seedMember();
      const externalId = `scan-award-${randomUUID()}`;
      // Before the purchase row: invalid amount, non-till source.
      await expect(tillAward({ externalId, member, amount: 0 })).rejects.toThrow(/VALIDATION_ERROR/);
      await expect(tillAward({ externalId, member, source: "partner_pos" })).rejects.toMatchObject({
        message: "VALIDATION_ERROR",
        detail: expect.stringMatching(/till sources only/),
      });
      // After the purchase row is inserted: identities that belong to two
      // different members raise at identity resolution, rolling back the row.
      const other = await seedMember();
      await expect(tillAward({ externalId, member, extraEmails: [other.email] })).rejects.toThrow(/IDENTITY_CONFLICT/);
      expect(await counts(externalId)).toEqual({ purchases: 0, proofs: 0, outbox: 0, miles: 0 });
    });

    it("gives two concurrent requests with one reference a single purchase and a single proof", async () => {
      const member = await seedMember();
      const externalId = `scan-award-${randomUUID()}`;
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query("BEGIN");
        await b.query("BEGIN");
        const first = await tillAward({ externalId, member }, a);
        let secondDone = false;
        const second = tillAward({ externalId, member }, b).then((r) => {
          secondDone = true;
          return r;
        });
        await new Promise((settle) => setTimeout(settle, 300));
        expect(secondDone).toBe(false); // waiting on the first insert
        await a.query("COMMIT");
        const replay = await second;
        await b.query("COMMIT");
        expect(first).toMatchObject({ idempotent: false, tillProof: true });
        expect(replay).toMatchObject({ purchaseEventId: first.purchaseEventId, idempotent: true, tillProof: true });
      } finally {
        a.release();
        b.release();
      }
      expect(await counts(externalId)).toMatchObject({ purchases: 1, proofs: 1, outbox: 1 });
    });

    it("leaves an ordinary (unsigned) award exactly as before: rewarded, notified, never proof", async () => {
      const member = await seedMember();
      const externalId = `instore-${randomUUID()}`;
      const result = await plainAward({ externalId, member, source: "merchant_dashboard_unsigned" });
      expect(result).toMatchObject({ status: "rewarded", idempotent: false });
      expect(await counts(externalId)).toMatchObject({ purchases: 1, proofs: 0, outbox: 1 });
      expect(await evidence(result.purchaseEventId as string, member.hubUserId)).toMatchObject({ owned: true, channel: "unknown" });
    });
  });

  describe("notification recipient", () => {
    it("ignores a metadata hubUserId that isn't the purchase's recipient", async () => {
      const buyer = await seedMember();
      const stranger = await seedMember();
      const result = await tillAward({ member: buyer, metadata: { hubUserId: stranger.hubUserId } });
      const { rows } = await pool.query("SELECT hub_user_id::text AS member FROM miles_earned_notification_outbox WHERE purchase_event_id=$1", [result.purchaseEventId]);
      expect(rows).toEqual([{ member: buyer.hubUserId }]);
    });

    it("uses the hint when it is the recipient", async () => {
      const buyer = await seedMember();
      const result = await tillAward({ member: buyer, metadata: { hubUserId: buyer.hubUserId } });
      const { rows } = await pool.query("SELECT hub_user_id::text AS member FROM miles_earned_notification_outbox WHERE purchase_event_id=$1", [result.purchaseEventId]);
      expect(rows).toEqual([{ member: buyer.hubUserId }]);
    });
  });

  describe("purchase_visit_evidence ownership", () => {
    it("refuses another member, another merchant, a missing purchase and a member with no identity", async () => {
      const buyer = await seedMember();
      const stranger = await seedMember();
      const result = await tillAward({ member: buyer });
      const id = result.purchaseEventId as string;

      expect(await evidence(id, stranger.hubUserId)).toMatchObject({ found: true, owned: false, ownership: "recipient_mismatch", channel: "unknown" });
      expect(await evidence(id, buyer.hubUserId, OTHER_MERCHANT)).toMatchObject({ owned: false, ownership: "merchant_mismatch" });
      expect(await evidence(randomUUID(), buyer.hubUserId)).toMatchObject({ found: false, owned: false, ownership: "purchase_not_found" });

      const ghost = randomUUID();
      await pool.query("INSERT INTO auth.users(id) VALUES($1)", [ghost]);
      await pool.query("DELETE FROM hub_user_canonicals WHERE hub_user_id=$1", [ghost]);
      expect(await evidence(id, ghost)).toMatchObject({ owned: false, ownership: "member_identity_unavailable" });
    });

    it("recognises the buyer by email when their canonical mapping differs", async () => {
      const buyer = await seedMember();
      const result = await tillAward({ member: buyer });
      await pool.query("UPDATE hub_user_canonicals SET canonical_id=$2 WHERE hub_user_id=$1", [buyer.hubUserId, randomUUID()]);
      expect(await evidence(result.purchaseEventId as string, buyer.hubUserId)).toMatchObject({ owned: true, ownership: "owned_identity", channel: "in_store" });
    });

    it("accepts a verified wallet recipient and rejects the link after revocation", async () => {
      const buyer = await seedMember();
      const address = `0x${randomUUID().replace(/-/g, "")}01234567`;
      // The replay excludes the original wallet schema, which was installed
      // outside this migration chain. Restore the columns the evidence uses.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hub_user_wallets (
          user_id uuid NOT NULL REFERENCES auth.users(id),
          ecosystem text NOT NULL,
          address text NOT NULL,
          verification_status text NOT NULL,
          verification_method text,
          UNIQUE (ecosystem, address)
        )
      `);
      await pool.query(
        `INSERT INTO hub_user_wallets(user_id,ecosystem,address,verification_status,verification_method)
         VALUES($1,'base',$2,'verified','admin')`,
        [buyer.hubUserId, address],
      );
      await pool.query("DELETE FROM hub_user_canonicals WHERE hub_user_id=$1", [buyer.hubUserId]);

      const result = await tillAward({ member: buyer, wallet: address });
      const purchaseId = result.purchaseEventId as string;
      expect(await evidence(purchaseId, buyer.hubUserId)).toMatchObject({
        owned: true, ownership: "owned_identity", channel: "in_store",
      });
      const { rows } = await pool.query(
        "SELECT hub_user_id FROM miles_earned_notification_outbox WHERE purchase_event_id=$1",
        [purchaseId],
      );
      expect(rows).toEqual([{ hub_user_id: buyer.hubUserId }]);

      await pool.query("UPDATE hub_user_wallets SET verification_status='revoked' WHERE user_id=$1", [buyer.hubUserId]);
      expect(await evidence(purchaseId, buyer.hubUserId)).toMatchObject({ owned: false, channel: "unknown" });
    });

    it("never counts a till label tagged online", async () => {
      const member = await seedMember();
      const result = await tillAward({ member, metadata: { channel: "online" } });
      expect(await evidence(result.purchaseEventId as string, member.hubUserId)).toMatchObject({ owned: true, channel: "unknown" });
    });
  });

  describe("regression: a real voucher redemption", () => {
    it("is an in-store visit for its member through the redemption row, and nobody else's", async () => {
      const member = await seedMember();
      const { rows: alloc } = await pool.query(
        `SELECT * FROM create_voucher_funding_allocation_with_merchants_atomic(
           p_program_id => $1, p_merchant_id => $2, p_actor_id => $3,
           p_title => 'Welcome 10%', p_description => NULL,
           p_discount_kes => NULL, p_minimum_spend_kes => 300,
           p_terms_text => NULL, p_quantity_cap => 50, p_authorized_budget_minor => NULL,
           p_claim_starts_at => now() - interval '1 hour', p_claim_ends_at => now() + interval '30 days',
           p_voucher_validity_seconds => 604800, p_distribution_modes => ARRAY['self_claim']::text[],
           p_recycle_expired_inventory => false, p_eligibility_rule_set_id => NULL, p_metadata => '{}'::jsonb,
           p_voucher_type => 'percent_off', p_discount_percent => 10, p_maximum_discount_kes => 200,
           p_additional_merchant_ids => ARRAY[]::uuid[])`,
        [PROGRAM_ID, MERCHANT, ACTOR_ID],
      );
      await pool.query("UPDATE voucher_funding_allocations SET state='active' WHERE id=$1", [alloc[0].id]);
      await pool.query("UPDATE spend_voucher_templates SET lifecycle_state='published', active=true WHERE id=$1", [alloc[0].voucher_template_id]);
      const { rows: claim } = await pool.query(
        `SELECT * FROM claim_akiba_funded_voucher_atomic($1,$2,'self_claim',$3,$4,NULL,NULL,NULL,'{}'::jsonb,'{}'::jsonb,'KE','self_declared_profile','member',$5)`,
        [alloc[0].id, member.canonicalId, `claim:${randomUUID()}`, member.hubUserId, member.hubUserId],
      );
      expect(claim[0].ok).toBe(true);
      const token = `AKV1.${randomUUID().replace(/-/g, "")}`;
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await pool.query(
        "UPDATE issued_vouchers SET redemption_token_hash=$2, redemption_token_expires_at=now()+interval '5 minutes', redemption_token_issued_at=now() WHERE id=$1",
        [claim[0].voucher_id, tokenHash],
      );
      const attempt = randomUUID();
      const { rows: redeemed } = await pool.query(
        "SELECT * FROM redeem_kes_voucher_and_award_atomic($1,$2,$3,$4,$5,$6,$7,true,$8)",
        [tokenHash, MERCHANT, MERCHANT_USER, attempt, createHash("sha256").update(attempt).digest("hex"), 1000, "r-1", new Date().toISOString()],
      );
      expect(redeemed[0]).toMatchObject({ ok: true });
      const purchaseId = redeemed[0].purchase_event_id as string;

      expect(await evidence(purchaseId, member.hubUserId)).toMatchObject({ owned: true, channel: "in_store" });
      expect(await evidence(purchaseId, (await seedMember()).hubUserId)).toMatchObject({ owned: false, channel: "unknown" });
      // Its own source label alone isn't the evidence: without the redemption
      // row for this purchase, it is unknown.
      await pool.query("UPDATE voucher_redemptions SET purchase_event_id=NULL WHERE purchase_event_id=$1", [purchaseId]);
      expect(await evidence(purchaseId, member.hubUserId)).toMatchObject({ owned: true, channel: "unknown" });
    });
  });
});
