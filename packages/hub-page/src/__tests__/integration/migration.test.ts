/**
 * Integration tests for Phase 1 migration.
 *
 * Covers audit corrections #1, #2, #5, #6, #7, #8:
 *   - Migration applies cleanly against a disposable PostgreSQL schema
 *   - Tables, indexes, RPCs and triggers are created correctly
 *   - RLS denies anon/authenticated access to sensitive tables
 *   - voucher_events is append-only
 *   - claim_voucher_atomic is truly atomic (concurrent cap enforcement)
 *   - reserve_voucher_atomic_hub uses partner_id (not merchant_id)
 *   - place_hub_order_and_redeem_voucher rolls back order on voucher error
 *   - Expiry set at issuance; enforced at claim
 *   - Secondary linked-wallet ownership
 *
 * Requires postgres to be running:
 *   pg_isready → should report "accepting connections"
 *   The test creates and tears down "hub_phase1_test" automatically.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_CONFIG = {
  host:     process.env.PG_HOST     ?? "localhost",
  port:     Number(process.env.PG_PORT ?? 5432),
  user:     process.env.PG_USER     ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "hub_phase1_test",
};

const MIGRATION_PATH_001 = resolve(__dirname, "../../../../../supabase/migrations/001_voucher_platform_phase1.sql");
const MIGRATION_PATH_002 = resolve(__dirname, "../../../../../supabase/migrations/002_voucher_platform_phase1_hardening.sql");
const MIGRATION_PATH_003 = resolve(__dirname, "../../../../../supabase/migrations/003_voucher_programs_phase2.sql");
const MIGRATION_PATH_004 = resolve(__dirname, "../../../../../supabase/migrations/004_voucher_asset_qr_redemption.sql");
const MIGRATION_PATH_005 = resolve(__dirname, "../../../../../supabase/migrations/005_voucher_settlement_phase4.sql");
const MIGRATION_PATH_006 = resolve(__dirname, "../../../../../supabase/migrations/006_voucher_payout_execution_phase5.sql");
const MIGRATION_PATH_007 = resolve(__dirname, "../../../../../supabase/migrations/007_voucher_payout_hardening.sql");
const MIGRATION_PATH_031 = resolve(__dirname, "../../../../../supabase/migrations/031_hub_order_legacy_columns.sql");

const SETUP_SQL = `
-- Drop and recreate the public schema so each test run starts from a clean slate.
-- This handles the case where a previous run already applied the migration
-- (e.g., rules_snapshot was already promoted from text[] to jsonb).
-- The auth schema is left intact since its tables predate the migration.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

-- Create Supabase roles that Postgres migrations reference (don't exist in vanilla PG)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Minimal schema that mirrors the live Supabase prerequisite tables.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE TYPE tx_category AS ENUM (
  'service','accessory','device','general','electronics','accessories',
  'services','clothing','food'
);
CREATE TYPE tx_action AS ENUM ('earn','redeem');
CREATE TYPE payment_method AS ENUM (
  'minipay_send','cash','card','other','onchain_transfer'
);

-- partners: minimal subset so Phase 3 inspect/presentation RPCs can resolve merchant_name.
CREATE TABLE IF NOT EXISTS partners (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text,
  name      text NOT NULL DEFAULT 'Test Partner',
  image_url text
);

-- spend_voucher_templates (minimal subset used by the migration RPCs)
CREATE TABLE IF NOT EXISTS spend_voucher_templates (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id           uuid        NOT NULL,
  active               boolean     NOT NULL DEFAULT true,
  expires_at           timestamptz,
  global_cap           integer,
  cooldown_seconds     integer     NOT NULL DEFAULT 0,
  miles_cost           integer     NOT NULL DEFAULT 0,
  title                text        NOT NULL DEFAULT 'Test Voucher',
  voucher_type         text        NOT NULL DEFAULT 'percent'
                                   CHECK (voucher_type IN ('percent','fixed','free_product')),
  discount_percent     numeric,
  discount_cusd        numeric,
  applicable_category  text,
  linked_product_id    uuid,
  retail_value_cusd    numeric
);

-- issued_vouchers (must exist before migration extends it)
CREATE TABLE IF NOT EXISTS issued_vouchers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address         text        NOT NULL,
  merchant_id          uuid,
  voucher_template_id  uuid        REFERENCES spend_voucher_templates(id),
  code                 text        NOT NULL,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','issued','claiming','redeemed','void','expired')),
  idempotency_key      text,
  -- Legacy live type that Phase 1 must normalize to jsonb.
  rules_snapshot       text[],
  retail_value_cusd    numeric,
  redeemed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- merchant_transactions (minimal subset for order insertion)
CREATE TABLE IF NOT EXISTS merchant_transactions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid,
  akiba_username   text        NOT NULL,
  user_address     text,
  category         tx_category NOT NULL,
  action           tx_action   NOT NULL,
  quote_kes        integer     NOT NULL,
  labor_kes        integer,
  discount_kes     integer,
  paid_kes         integer,
  status           text,
  item_name        text,
  item_category    text,
  product_id       text,
  payment_ref      text,
  payment_currency text,
  payment_method   payment_method,
  amount_cusd      double precision,
  amount_kes       integer,
  voucher_code     text,
  voucher_id       uuid,
  recipient_name   text,
  phone            text,
  city             text,
  location_details text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Legacy production shape: this table can predate Phase 1 and lack used_at.
-- The migration must evolve it rather than assuming CREATE TABLE IF NOT EXISTS
-- added every current column.
CREATE TABLE IF NOT EXISTS voucher_issue_nonces (
  nonce        text PRIMARY KEY,
  user_address text NOT NULL
);

-- hub_user_wallets: links Hub user IDs to EVM wallets.
-- Production schema uses linked_at (not created_at). Created here before 003.
CREATE TABLE IF NOT EXISTS hub_user_wallets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecosystem   text        NOT NULL CHECK (ecosystem IN ('minipay', 'base')),
  address     text        NOT NULL,
  is_primary  boolean     NOT NULL DEFAULT false,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecosystem, address),
  UNIQUE (user_id, ecosystem)
);

-- merchant_users: production table that merchant_audit_log.merchant_user_id references.
-- Created before 003 so the FK in production is satisfied when 003 runs.
CREATE TABLE IF NOT EXISTS merchant_users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL UNIQUE,
  partner_id uuid        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- merchant_audit_log: PRODUCTION schema (merchant_user_id, partner_id, action, order_id, metadata).
-- Created here before 003 so that 003's CREATE TABLE IF NOT EXISTS is a no-op,
-- proving 003 is compatible with the live table shape.
CREATE TABLE IF NOT EXISTS merchant_audit_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_user_id  uuid        NOT NULL,
  partner_id        uuid        NOT NULL,
  action            text        NOT NULL,
  order_id          uuid,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Seed a pre-existing audit row to prove 003 leaves it intact.
INSERT INTO merchant_audit_log (id, merchant_user_id, partner_id, action, metadata)
VALUES (
  '00000000-0000-0000-0000-aaa000000001',
  '00000000-0000-0000-0000-bbb000000001',
  '00000000-0000-0000-0000-ccc000000001',
  'order.accepted',
  '{"order_id":"legacy-1"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Preserve-and-convert fixture for legacy rules_snapshot text[] drift.
INSERT INTO spend_voucher_templates (
  id, partner_id, title, voucher_type, miles_cost, discount_percent
) VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000a002',
  'Legacy Snapshot Template',
  'percent',
  25,
  10
) ON CONFLICT (id) DO NOTHING;

INSERT INTO issued_vouchers (
  id, user_address, voucher_template_id, code, status, rules_snapshot
) VALUES (
  '00000000-0000-0000-0000-00000000a003',
  '0xlegacyrules',
  '00000000-0000-0000-0000-00000000a001',
  'LEGACYRULE',
  'issued',
  ARRAY['legacy-rule-a','legacy-rule-b']::text[]
) ON CONFLICT (id) DO NOTHING;
`;

let pool: pg.Pool;

beforeAll(async () => {
  pool = new Pool(DB_CONFIG);

  // Apply setup schema then all three migrations in order
  await pool.query(SETUP_SQL);
  await pool.query(readFileSync(MIGRATION_PATH_001, "utf-8"));
  await pool.query(readFileSync(MIGRATION_PATH_002, "utf-8"));
  await pool.query(readFileSync(MIGRATION_PATH_003, "utf-8"));
  await pool.query(readFileSync(MIGRATION_PATH_004, "utf-8"));
  await pool.query(readFileSync(MIGRATION_PATH_005, "utf-8"));
  await pool.query(readFileSync(MIGRATION_PATH_006, "utf-8"));
  await pool.query(readFileSync(MIGRATION_PATH_031, "utf-8"));
}, 30_000);

afterAll(async () => {
  await pool.end();
});

// ── #1 Migration applies cleanly ─────────────────────────────────────────────

describe("Migration application (#1)", () => {
  it("creates all expected tables", async () => {
    const tables = [
      "voucher_issue_nonces",
      "voucher_programs",
      "voucher_program_channel_allocations",
      "voucher_redemptions",
      "voucher_events",
      "mpesa_stk_requests",
      "mpesa_stk_results",
      "reconciliation_incidents",
    ];

    for (const table of tables) {
      const res = await pool.query(
        "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1",
        [table]
      );
      expect(res.rows.length, `Table ${table} should exist`).toBe(1);
    }
  });

  it("creates all expected functions", async () => {
    const functions = [
      "reserve_voucher_atomic_hub",
      "claim_voucher_atomic",
      "place_hub_order_and_redeem_voucher",
      "redeem_voucher_atomic",
      "release_claimed_voucher",
    ];

    for (const fn of functions) {
      const res = await pool.query(
        "SELECT 1 FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace",
        [fn]
      );
      expect(res.rows.length, `Function ${fn} should exist`).toBeGreaterThanOrEqual(1);
    }
  });

  it("adds issued_vouchers columns for burn recovery", async () => {
    const cols = ["claimed_at", "burn_idempotency_key", "burn_ref", "recovery_state", "expires_at"];
    for (const col of cols) {
      const res = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name='issued_vouchers' AND column_name=$1",
        [col]
      );
      expect(res.rows.length, `Column issued_vouchers.${col} should exist`).toBe(1);
    }
  });

  it("upgrades legacy voucher_issue_nonces with used_at", async () => {
    const res = await pool.query(
      "SELECT column_default, is_nullable FROM information_schema.columns " +
      "WHERE table_name='voucher_issue_nonces' AND column_name='used_at'"
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].is_nullable).toBe("NO");
    expect(res.rows[0].column_default).toContain("now()");
  });

  it("normalizes legacy rules_snapshot text[] to jsonb and preserves the old value", async () => {
    const typeRes = await pool.query(
      "SELECT data_type FROM information_schema.columns " +
      "WHERE table_name='issued_vouchers' AND column_name='rules_snapshot'"
    );
    expect(typeRes.rows).toHaveLength(1);
    expect(typeRes.rows[0].data_type).toBe("jsonb");

    const { rows: [voucher] } = await pool.query(
      "SELECT rules_snapshot, legacy_rules_snapshot FROM issued_vouchers " +
      "WHERE id='00000000-0000-0000-0000-00000000a003'"
    );
    expect(voucher.rules_snapshot.merchant_id).toBe(
      "00000000-0000-0000-0000-00000000a002"
    );
    expect(voucher.legacy_rules_snapshot.original_type).toBe("text[]");
    expect(voucher.legacy_rules_snapshot.value).toEqual([
      "legacy-rule-a",
      "legacy-rule-b",
    ]);
  });

  it("creates uq_iv_code partial unique index", async () => {
    const res = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE tablename='issued_vouchers' AND indexname='uq_iv_code'"
    );
    expect(res.rows.length).toBe(1);
  });

  it("creates uq_iv_idempotency_key partial unique index", async () => {
    const res = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE tablename='issued_vouchers' AND indexname='uq_iv_idempotency_key'"
    );
    expect(res.rows.length).toBe(1);
  });

  it("creates uq_mt_payment_ref partial unique index", async () => {
    const res = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE tablename='merchant_transactions' AND indexname='uq_mt_payment_ref'"
    );
    expect(res.rows.length).toBe(1);
  });

  it("creates append-only trigger on voucher_events", async () => {
    const res = await pool.query(
      "SELECT 1 FROM pg_trigger WHERE tgname='trg_voucher_events_no_mutation' AND tgrelid='voucher_events'::regclass"
    );
    expect(res.rows.length).toBe(1);
  });

  it("enables RLS on sensitive tables", async () => {
    const tables = [
      "voucher_issue_nonces",
      "voucher_programs",
      "voucher_program_channel_allocations",
      "voucher_redemptions",
      "voucher_events",
      "mpesa_stk_requests",
      "mpesa_stk_results",
      "reconciliation_incidents",
    ];
    for (const table of tables) {
      const res = await pool.query(
        "SELECT relrowsecurity FROM pg_class WHERE relname=$1 AND relnamespace='public'::regnamespace",
        [table]
      );
      expect(res.rows[0]?.relrowsecurity, `RLS should be enabled on ${table}`).toBe(true);
    }
  });

  it("does not include issued_count on voucher_programs (removed misleading counter)", async () => {
    const res = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='voucher_programs' AND column_name='issued_count'"
    );
    expect(res.rows.length).toBe(0);
  });
});

// ── #2 voucher_events append-only ────────────────────────────────────────────

describe("voucher_events append-only (#2)", () => {
  it("INSERT succeeds", async () => {
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, code, status) VALUES ('0xtest','CODE1','issued') RETURNING id`
    );
    await pool.query(
      `INSERT INTO voucher_events (issued_voucher_id, event_type) VALUES ($1, 'issued')`,
      [v.id]
    );
  });

  it("UPDATE is rejected", async () => {
    const { rows: [ev] } = await pool.query(
      `SELECT id FROM voucher_events LIMIT 1`
    );
    if (!ev) return; // no events yet — skip
    await expect(
      pool.query(`UPDATE voucher_events SET event_type='redeemed' WHERE id=$1`, [ev.id])
    ).rejects.toThrow();
  });

  it("DELETE is rejected", async () => {
    const { rows: [ev] } = await pool.query(
      `SELECT id FROM voucher_events LIMIT 1`
    );
    if (!ev) return;
    await expect(
      pool.query(`DELETE FROM voucher_events WHERE id=$1`, [ev.id])
    ).rejects.toThrow();
  });
});

// ── #5 reserve_voucher_atomic_hub uses partner_id (#1 fix) ──────────────────

describe("reserve_voucher_atomic_hub — partner_id (#1 fix)", () => {
  it("finds template by partner_id and issues a voucher", async () => {
    const { rows: [p] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('test@example.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000001";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, miles_cost, title)
       VALUES ($1, 100, 'Test') RETURNING id`,
      [partnerId]
    );

    const { rows } = await pool.query(
      `SELECT * FROM reserve_voucher_atomic_hub($1,$2,$3,$4,NULL,$5,NULL,'miles_purchase','miles')`,
      [t.id, "0xabc", partnerId, "TESTCODE1", p.id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].miles_cost).toBe(100);
  });

  it("raises TEMPLATE_INACTIVE when partner_id does not match", async () => {
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, miles_cost, title)
       VALUES ('00000000-0000-0000-0000-000000000002', 50, 'Other') RETURNING id`
    );
    const wrongPartner = "00000000-0000-0000-0000-000000000099";

    await expect(
      pool.query(
        `SELECT * FROM reserve_voucher_atomic_hub($1,$2,$3,$4)`,
        [t.id, "0xdef", wrongPartner, "BADCODE12"]
      )
    ).rejects.toThrow(/TEMPLATE_INACTIVE/);
  });
});

// ── #5 Expiry set at issuance ────────────────────────────────────────────────

describe("Expiry propagation at issuance (#5)", () => {
  it("sets issued_vouchers.expires_at from template.expires_at", async () => {
    const partnerId = "00000000-0000-0000-0000-000000000003";
    const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString(); // tomorrow

    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, miles_cost, title, expires_at)
       VALUES ($1, 50, 'Expiring', $2) RETURNING id`,
      [partnerId, expiresAt]
    );
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('exp@test.com') RETURNING id`
    );

    await pool.query(
      `SELECT * FROM reserve_voucher_atomic_hub($1,$2,$3,$4,NULL,$5)`,
      [t.id, "0xexpiry", partnerId, "EXPCODE11", u.id]
    );

    const { rows: [v] } = await pool.query(
      `SELECT expires_at FROM issued_vouchers WHERE code='EXPCODE11'`
    );
    expect(v?.expires_at).not.toBeNull();
    // Should match the template's expires_at (within a few seconds)
    const diff = Math.abs(new Date(v.expires_at).getTime() - new Date(expiresAt).getTime());
    expect(diff).toBeLessThan(5000);
  });
});

// ── #6 cap concurrency via advisory lock ─────────────────────────────────────

describe("Global cap concurrency (#2 — real PostgreSQL)", () => {
  it("concurrent requests respect global_cap=1", async () => {
    const partnerId = "00000000-0000-0000-0000-000000000004";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, miles_cost, title, global_cap)
       VALUES ($1, 10, 'Limited', 1) RETURNING id`,
      [partnerId]
    );
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('cap@test.com') RETURNING id`
    );

    // Fire 5 concurrent requests for the same template
    const attempts = Array.from({ length: 5 }, (_, i) => {
      const code = `CAP${i.toString().padStart(7, "0")}`;
      return pool.query(
        `SELECT * FROM reserve_voucher_atomic_hub($1,$2,$3,$4,NULL,$5)`,
        [t.id, `0xcap${i}`, partnerId, code, u.id]
      ).then((r) => ({ ok: true, row: r.rows[0] }))
       .catch((e: Error) => ({ ok: false, error: e.message }));
    });

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.ok);
    const failures  = results.filter((r) => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(4);
    expect((failures[0] as { ok: false; error: string }).error).toMatch(/CAP_EXCEEDED/);
  }, 15_000);
});

// ── #6 claim_voucher_atomic ────────────────────────────────────────────────

describe("claim_voucher_atomic (#6)", () => {
  it("transitions issued → claiming and records claimed_at", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('claim@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000005";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xclaim', $1, $2, 'CLAIMTEST', 'issued') RETURNING id`,
      [u.id, partnerId]
    );

    const { rows } = await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xclaim']::text[],$3)`,
      [v.id, u.id, partnerId]
    );
    expect(rows[0].ok).toBe(true);

    const { rows: [updated] } = await pool.query(
      `SELECT status, claimed_at FROM issued_vouchers WHERE id=$1`, [v.id]
    );
    expect(updated.status).toBe("claiming");
    expect(updated.claimed_at).not.toBeNull();
  });

  it("returns WRONG_STATUS for concurrent double-claim", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('dbl@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000006";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xdbl', $1, $2, 'DBLCLAIM1', 'issued') RETURNING id`,
      [u.id, partnerId]
    );

    // First claim succeeds
    await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xdbl']::text[],$3)`,
      [v.id, u.id, partnerId]
    );

    // Second claim sees status='claiming' and returns WRONG_STATUS
    const { rows: second } = await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xdbl']::text[],$3)`,
      [v.id, u.id, partnerId]
    );
    expect(second[0].ok).toBe(false);
    expect(second[0].error_code).toBe("WRONG_STATUS");
  });

  it("returns WRONG_OWNER for a different hub_user_id", async () => {
    const { rows: [u1] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('owner1@test.com') RETURNING id`
    );
    const { rows: [u2] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('owner2@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000007";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xown1', $1, $2, 'OWNTEST11', 'issued') RETURNING id`,
      [u1.id, partnerId]
    );

    const { rows } = await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xown2']::text[],$3)`,
      [v.id, u2.id, partnerId]
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].error_code).toBe("WRONG_OWNER");
  });

  it("accepts secondary linked-wallet address for legacy rows (#10)", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('secondary@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000008";
    // Legacy row: no hub_user_id, only user_address
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xprimary', NULL, $1, 'SECONDARY1', 'issued') RETURNING id`,
      [partnerId]
    );

    // User presents secondary wallet 0xsecondary alongside 0xprimary in the addresses array
    const { rows } = await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xsecondary','0xprimary']::text[],$3)`,
      [v.id, u.id, partnerId]
    );
    expect(rows[0].ok).toBe(true);
  });

  it("sets EXPIRED and returns EXPIRED error code when expires_at is in the past", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('expired@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000009";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status, expires_at)
       VALUES ('0xexp2', $1, $2, 'EXPTEST11', 'issued', now() - interval '1 second') RETURNING id`,
      [u.id, partnerId]
    );

    const { rows } = await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xexp2']::text[],$3)`,
      [v.id, u.id, partnerId]
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].error_code).toBe("EXPIRED");

    const { rows: [updated] } = await pool.query(
      `SELECT status FROM issued_vouchers WHERE id=$1`, [v.id]
    );
    expect(updated.status).toBe("expired");
  });
});

// ── #8 place_hub_order_and_redeem_voucher atomicity ──────────────────────────

describe("place_hub_order_and_redeem_voucher atomicity (#8)", () => {
  it("creates order and redeems voucher in one transaction", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('atomic@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000010";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates
         (partner_id,title,voucher_type,miles_cost,discount_cusd,retail_value_cusd)
       VALUES($1,'Atomic fixed','fixed',0,1.5,1.5) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs(template_id,name,state,total_cap)
       VALUES($1,'Atomic settlement','draft',10) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_settlement_terms
         (program_id,funding_party_type,settlement_currency,reimbursement_rate)
       VALUES($1,'akiba','cUSD',1)`,
      [p.id]
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers
         (user_address,hub_user_id,merchant_id,voucher_template_id,program_id,code,status,rules_snapshot)
       VALUES ('0xatom',$1,$2,$3,$4,'ATOMTEST1','claiming',
        jsonb_build_object('merchant_id',$2::uuid,'voucher_type','fixed','discount_cusd',1.5,
                            'retail_value_cusd',1.5,'linked_product_id','prod-1',
                            'applicable_category','electronics','title','Atomic fixed'))
       RETURNING id`,
      [u.id, partnerId, t.id, p.id]
    );

    const { rows } = await pool.query(
      `SELECT * FROM place_hub_order_and_redeem_voucher(
        $1,$2,'Widget','electronics','prod-1','REF001','CUSD','crypto:CUSD',
        5.0,650,'ATOMTEST1',$3,'Alice','254700000001','Nairobi',NULL,
        $4,$1,'prod-1','electronics',1.50,ARRAY['0xatom']::text[]
      )`,
      [partnerId, "0xatom", v.id, u.id]
    );

    expect(rows[0].ok).toBe(true);
    expect(rows[0].order_id).not.toBeNull();

    const { rows: [updatedV] } = await pool.query(
      `SELECT status FROM issued_vouchers WHERE id=$1`, [v.id]
    );
    expect(updatedV.status).toBe("redeemed");
  });

  it("rolls back order when voucher is in wrong status (not 'claiming')", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rollback@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000011";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xrb', $1, $2, 'RBTEST001', 'issued') RETURNING id`, // ISSUED, not claiming
      [u.id, partnerId]
    );

    const orderCountBefore = (await pool.query(`SELECT COUNT(*) FROM merchant_transactions`)).rows[0].count;

    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,$2,'Widget','electronics','prod-1','REF002','CUSD','crypto:CUSD',
          5.0,650,'RBTEST001',$3,'Bob','254700000002','Nairobi',NULL,
          $4,$1,'prod-1','electronics',1.50,ARRAY['0xrb']::text[]
        )`,
        [partnerId, "0xrb", v.id, u.id]
      )
    ).rejects.toThrow(/WRONG_STATUS/);

    const orderCountAfter = (await pool.query(`SELECT COUNT(*) FROM merchant_transactions`)).rows[0].count;
    expect(orderCountAfter).toBe(orderCountBefore); // order was NOT created
  });

  it("creates order without voucher (null voucher fields)", async () => {
    const partnerId = "00000000-0000-0000-0000-000000000012";

    const { rows } = await pool.query(
      `SELECT * FROM place_hub_order_and_redeem_voucher(
        $1,'0xnov','Widget','electronics','prod-2','REF003','CUSD','mpesa',
        5.0,650,NULL,NULL,'Carol','254700000003','Mombasa',NULL,
        NULL,NULL,NULL,NULL,NULL,NULL
      )`,
      [partnerId]
    );

    expect(rows[0].ok).toBe(true);
    expect(rows[0].order_id).not.toBeNull();

    const { rows: [order] } = await pool.query(
      `SELECT akiba_username,category,action,quote_kes,paid_kes,payment_method
         FROM merchant_transactions WHERE id=$1`,
      [rows[0].order_id]
    );
    expect(order.akiba_username).toBe("0xnov");
    expect(order.category).toBe("general");
    expect(order.action).toBe("redeem");
    expect(order.quote_kes).toBe(650);
    expect(order.paid_kes).toBe(650);
    expect(order.payment_method).toBe("other");
  });
});

// ── #7 payment_ref unique index rejects replay ───────────────────────────────

describe("payment_ref replay rejection (#7)", () => {
  it("uq_mt_payment_ref prevents duplicate payment references", async () => {
    const partnerId = "00000000-0000-0000-0000-000000000013";

    await pool.query(
      `INSERT INTO merchant_transactions (partner_id, akiba_username, user_address, category, action, quote_kes,
         status, item_name, item_category,
         product_id, payment_ref, payment_currency, payment_method, amount_cusd, amount_kes,
         recipient_name, phone, city)
       VALUES ($1,'dup','0xdup','general','redeem',650,'placed','Item','food','p1','UNIQUE_REF_001','CUSD','onchain_transfer',
               5.0,650,'Dave','254700','Nairobi')`,
      [partnerId]
    );

    await expect(
      pool.query(
        `INSERT INTO merchant_transactions (partner_id, akiba_username, user_address, category, action, quote_kes,
           status, item_name, item_category,
           product_id, payment_ref, payment_currency, payment_method, amount_cusd, amount_kes,
           recipient_name, phone, city)
         VALUES ($1,'dup2','0xdup2','general','redeem',650,'placed','Item','food','p1','UNIQUE_REF_001','CUSD','onchain_transfer',
                 5.0,650,'Eve','254700','Nairobi')`,
        [partnerId]
      )
    ).rejects.toThrow(/unique/i);
  });
});

// ── Migration idempotency: second application ─────────────────────────────────

describe("Migration idempotency (#2)", () => {
  it("runs both migrations a second time without error", async () => {
    await expect(pool.query(readFileSync(MIGRATION_PATH_001, "utf-8"))).resolves.not.toThrow();
    await expect(pool.query(readFileSync(MIGRATION_PATH_002, "utf-8"))).resolves.not.toThrow();
    await expect(pool.query(readFileSync(MIGRATION_PATH_031, "utf-8"))).resolves.not.toThrow();
  });
});

// ── Constraint evolution (#1 audit blocker): recovery_state ──────────────────

describe("recovery_state constraint (#1 blocker)", () => {
  it("allows burn_ambiguous and burn_confirmed_promote_failed, rejects unknown value", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rs@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000020";

    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xrs', $1, $2, 'RSTEST001', 'pending') RETURNING id`,
      [u.id, partnerId]
    );

    await pool.query(
      `UPDATE issued_vouchers SET recovery_state='burn_ambiguous' WHERE id=$1`, [v.id]
    );
    await pool.query(
      `UPDATE issued_vouchers SET recovery_state='burn_confirmed_promote_failed' WHERE id=$1`, [v.id]
    );
    await pool.query(
      `UPDATE issued_vouchers SET recovery_state=NULL WHERE id=$1`, [v.id]
    );

    await expect(
      pool.query(`UPDATE issued_vouchers SET recovery_state='invalid_state' WHERE id=$1`, [v.id])
    ).rejects.toThrow(/check/i);
  });
});

// ── release_claimed_voucher text[] overload ───────────────────────────────────

describe("release_claimed_voucher text[] overload", () => {
  it("releases a secondary-wallet voucher by address array", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rcv2@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000021";

    // Voucher owned by 0xsecondary (a secondary wallet address, not hub_user_id)
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xsecondary2', $1, $2, 'RELTEST01', 'claiming') RETURNING id`,
      [u.id, partnerId]
    );

    // Release passes both addresses — function must match on 0xsecondary2
    const { rows: [released] } = await pool.query(
      `SELECT release_claimed_voucher($1, $2, ARRAY['0xprimary2','0xsecondary2']::text[])`,
      [v.id, u.id]
    );
    expect(released.release_claimed_voucher).toBe(true);

    const { rows: [updated] } = await pool.query(
      `SELECT status FROM issued_vouchers WHERE id=$1`, [v.id]
    );
    expect(updated.status).toBe("issued");
  });

  it("returns false when no address matches", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rcv3@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000022";

    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xother99', NULL, $1, 'RELTEST02', 'claiming') RETURNING id`,
      [partnerId]
    );

    const { rows: [result] } = await pool.query(
      `SELECT release_claimed_voucher($1, $2, ARRAY['0xwrong1','0xwrong2']::text[])`,
      [v.id, u.id]
    );
    expect(result.release_claimed_voucher).toBe(false);
  });
});

// ── place_hub_order_and_redeem_voucher: merchant/product/category validation ─

describe("place_hub_order_and_redeem_voucher full revalidation", () => {
  let u: { id: string };
  const partnerId = "00000000-0000-0000-0000-000000000030";
  const wrongPartner = "00000000-0000-0000-0000-000000000031";

  async function insertClaimingVoucher(
    code: string,
    snapshot: Record<string, unknown>
  ) {
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status, rules_snapshot)
       VALUES ('0xfull', $1, $2, $3, 'claiming', $4) RETURNING id`,
      [u.id, partnerId, code, JSON.stringify(snapshot)]
    );
    return v as { id: string };
  }

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('fullval@test.com') RETURNING id`
    );
    u = rows[0] as { id: string };
  });

  it("rejects WRONG_MERCHANT when p_partner_id (actual order field) does not match voucher", async () => {
    const v = await insertClaimingVoucher("FULLM001", {
      merchant_id: partnerId, voucher_type: "percent", discount_percent: 10,
      discount_cusd: null, applicable_category: null, linked_product_id: null,
      retail_value_cusd: 50, miles_cost: 100, title: "T", snapshotted_at: new Date().toISOString(),
    });

    // 002 fix: WRONG_MERCHANT fires when p_partner_id (position 1) ≠ voucher's merchant_id.
    // Pass wrongPartner as p_partner_id and partnerId as the deprecated p_merchant_id to
    // verify the function no longer trusts the duplicated param.
    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xfull','Item','food','p1','FULLMREF1','CUSD','crypto:CUSD',
          5.0,650,'CODE1',$2,'Alice','254700000001','Nairobi',NULL,
          $3,$4,'p1','food',1.50,ARRAY['0xfull']::text[]
        )`,
        [wrongPartner, v.id, u.id, partnerId]   // wrongPartner as p_partner_id; partnerId as deprecated p_merchant_id
      )
    ).rejects.toThrow(/WRONG_MERCHANT/);
  });

  it("rejects WRONG_PRODUCT under row lock", async () => {
    const v = await insertClaimingVoucher("FULLP001", {
      merchant_id: partnerId, voucher_type: "fixed", discount_percent: null,
      discount_cusd: 2, applicable_category: null, linked_product_id: "expected-prod",
      retail_value_cusd: 50, miles_cost: 100, title: "T", snapshotted_at: new Date().toISOString(),
    });

    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xfull','Item','food','wrong-prod','FULLPREF1','CUSD','crypto:CUSD',
          5.0,650,'CODE2',$2,'Alice','254700000001','Nairobi',NULL,
          $3,$1,'wrong-prod','food',1.50,ARRAY['0xfull']::text[]
        )`,
        [partnerId, v.id, u.id]
      )
    ).rejects.toThrow(/WRONG_PRODUCT/);
  });

  it("rejects WRONG_CATEGORY under row lock", async () => {
    const v = await insertClaimingVoucher("FULLC001", {
      merchant_id: partnerId, voucher_type: "percent", discount_percent: 10,
      discount_cusd: null, applicable_category: "electronics", linked_product_id: null,
      retail_value_cusd: 50, miles_cost: 100, title: "T", snapshotted_at: new Date().toISOString(),
    });

    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xfull','Item','food','p1','FULLCREF1','CUSD','crypto:CUSD',
          5.0,650,'CODE3',$2,'Alice','254700000001','Nairobi',NULL,
          $3,$1,'p1','food',1.50,ARRAY['0xfull']::text[]
        )`,
        [partnerId, v.id, u.id]
      )
    ).rejects.toThrow(/WRONG_CATEGORY/);
  });

  it("rejects DISCOUNT_EXCEEDS_CAP under row lock", async () => {
    const v = await insertClaimingVoucher("FULLD001", {
      merchant_id: partnerId, voucher_type: "fixed", discount_percent: null,
      discount_cusd: 2, applicable_category: null, linked_product_id: null,
      retail_value_cusd: 5, miles_cost: 100, title: "T", snapshotted_at: new Date().toISOString(),
    });

    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xfull','Item','food','p1','FULLDREF1','CUSD','crypto:CUSD',
          3.0,390,'CODE4',$2,'Alice','254700000001','Nairobi',NULL,
          $3,$1,'p1','food',99.00,ARRAY['0xfull']::text[]
        )`,
        [partnerId, v.id, u.id]
      )
    ).rejects.toThrow(/DISCOUNT_EXCEEDS_CAP/);
  });
});

// ── Schema evolution: partial Phase 1 already deployed ───────────────────────
// Verifies the migration tolerates tables/constraints created by an earlier run.

describe("Schema evolution — partial Phase 1 already deployed", () => {
  it("allows running against a schema where voucher_events already existed", async () => {
    // voucher_events was created by the migration; we can verify it has the
    // updated event_type constraint by attempting to insert burn_ambiguous.
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('ev@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000040";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xev', $1, $2, 'EVTEST001', 'pending') RETURNING id`,
      [u.id, partnerId]
    );

    // burn_ambiguous must be accepted (constraint evolution applied)
    await expect(
      pool.query(
        `INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id)
         VALUES ($1, 'burn_ambiguous', '0xev')`,
        [v.id]
      )
    ).resolves.not.toThrow();
  });

  it("rejects an unknown event_type to confirm constraint is active", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('ev2@test.com') RETURNING id`
    );
    const partnerId = "00000000-0000-0000-0000-000000000041";
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status)
       VALUES ('0xev2', $1, $2, 'EVTEST002', 'pending') RETURNING id`,
      [u.id, partnerId]
    );

    await expect(
      pool.query(
        `INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id)
         VALUES ($1, 'unknown_event_type', '0xev2')`,
        [v.id]
      )
    ).rejects.toThrow(/check/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 002 hardening tests
// ══════════════════════════════════════════════════════════════════════════════

// ── 002 / Section 1: recovery_state constraint evolution ─────────────────────

describe("002 — recovery_state constraint evolution", () => {
  it("constraint named chk_iv_recovery_state exists after 002", async () => {
    const { rows } = await pool.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'issued_vouchers'::regclass
          AND contype  = 'c'
          AND conname  = 'chk_iv_recovery_state'`
    );
    expect(rows.length).toBe(1);
  });

  it("no auto-named issued_vouchers_recovery_state_check remains after 002 drops it", async () => {
    const { rows } = await pool.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'issued_vouchers'::regclass
          AND contype  = 'c'
          AND conname  = 'issued_vouchers_recovery_state_check'`
    );
    // 002 drops any such constraint; only the canonical chk_iv_recovery_state should exist
    expect(rows.length).toBe(0);
  });

  it("burn_ambiguous is accepted by the canonical constraint", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rs002a@test.com') RETURNING id`
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xrs002a', $1, 'RS002A001', 'pending') RETURNING id`,
      [u.id]
    );
    await expect(
      pool.query(`UPDATE issued_vouchers SET recovery_state='burn_ambiguous' WHERE id=$1`, [v.id])
    ).resolves.not.toThrow();
  });

  it("burn_confirmed_promote_failed is accepted by the canonical constraint", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rs002b@test.com') RETURNING id`
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xrs002b', $1, 'RS002B001', 'pending') RETURNING id`,
      [u.id]
    );
    await expect(
      pool.query(
        `UPDATE issued_vouchers SET recovery_state='burn_confirmed_promote_failed' WHERE id=$1`,
        [v.id]
      )
    ).resolves.not.toThrow();
  });

  it("unknown recovery_state is still rejected after constraint evolution", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rs002c@test.com') RETURNING id`
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xrs002c', $1, 'RS002C001', 'pending') RETURNING id`,
      [u.id]
    );
    await expect(
      pool.query(
        `UPDATE issued_vouchers SET recovery_state='invalid_state' WHERE id=$1`,
        [v.id]
      )
    ).rejects.toThrow(/check/i);
  });
});

// ── 002 / Section 2: tampering — scope params vs actual order fields ──────────

describe("002 — place_hub_order_and_redeem_voucher anti-tampering", () => {
  it("rejects order where p_partner_id (actual field) mismatches voucher merchant, even if p_merchant_id matches", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('tamp1@test.com') RETURNING id`
    );
    const realMerchant  = "00000000-0000-0000-0000-000000000050";
    const otherMerchant = "00000000-0000-0000-0000-000000000051";

    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, merchant_id, code, status, rules_snapshot)
       VALUES ('0xtamp1', $1, $2, 'TAMP1001', 'claiming', $3) RETURNING id`,
      [u.id, realMerchant, JSON.stringify({
        merchant_id: realMerchant, voucher_type: "percent", discount_percent: 10,
        discount_cusd: null, applicable_category: null, linked_product_id: null,
        retail_value_cusd: 50, miles_cost: 100, title: "T", snapshotted_at: new Date().toISOString(),
      })]
    );

    // Tampered call: p_partner_id = otherMerchant (wrong), p_merchant_id = realMerchant (matches voucher, deprecated param)
    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xtamp1','Item','food','p1','TAMP1REF1','CUSD','crypto:CUSD',
          5.0,650,'TAMP1001',$2,'Alice','254700000001','Nairobi',NULL,
          $3,$4,'p1','food',1.50,ARRAY['0xtamp1']::text[]
        )`,
        [otherMerchant, v.id, u.id, realMerchant]
      )
    ).rejects.toThrow(/WRONG_MERCHANT/);
  });

  it("accepts order where p_partner_id correctly matches voucher merchant", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('tamp2@test.com') RETURNING id`
    );
    const realMerchant = "00000000-0000-0000-0000-000000000052";
    await pool.query(
      `INSERT INTO partners(id,slug,name) VALUES($1,'tamp2-merchant','Tamp 2 Merchant')
       ON CONFLICT(id) DO NOTHING`,
      [realMerchant],
    );
    const { rows: [template] } = await pool.query(
      `INSERT INTO spend_voucher_templates(
         partner_id,title,voucher_type,miles_cost,discount_percent,retail_value_cusd
       ) VALUES($1,'Tamp 2','percent',1,10,50) RETURNING id`,
      [realMerchant],
    );
    const { rows: [program] } = await pool.query(
      `INSERT INTO voucher_programs(name,template_id,funding_type,total_cap,state)
       VALUES('Tamp 2 Program',$1,'sponsor',10,'draft') RETURNING id`,
      [template.id],
    );
    await pool.query(
      `INSERT INTO voucher_program_settlement_terms(
         program_id,funding_party_type,funding_party_reference,settlement_currency,reimbursement_rate
       ) VALUES($1,'sponsor','tamp2-sponsor','cUSD',1)`,
      [program.id],
    );

    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers(
         user_address,hub_user_id,merchant_id,voucher_template_id,program_id,code,status,rules_snapshot
       ) VALUES ('0xtamp2',$1,$2,$3,$4,'TAMP2001','claiming',$5) RETURNING id`,
      [u.id, realMerchant, template.id, program.id, JSON.stringify({
        merchant_id: realMerchant, voucher_type: "percent", discount_percent: 10,
        discount_cusd: null, applicable_category: null, linked_product_id: null,
        retail_value_cusd: 50, miles_cost: 100, title: "T", snapshotted_at: new Date().toISOString(),
      })]
    );

    const { rows } = await pool.query(
      `SELECT * FROM place_hub_order_and_redeem_voucher(
        $1,'0xtamp2','Item','food','p1','TAMP2REF1','CUSD','crypto:CUSD',
        13.5,650,'TAMP2001',$2,'Bob','254700000001','Nairobi',NULL,
        $3,$1,'p1','food',1.50,ARRAY['0xtamp2']::text[]
      )`,
      [realMerchant, v.id, u.id]
    );
    expect(rows[0].ok).toBe(true);
  });

  it("rejects legacy wallet-address voucher when p_user_addresses is NULL (fail closed)", async () => {
    const realMerchant = "00000000-0000-0000-0000-000000000053";

    // Legacy row: no hub_user_id, only user_address
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, merchant_id, code, status)
       VALUES ('0xlegacy002', $1, 'TAMP3001', 'claiming') RETURNING id`,
      [realMerchant]
    );

    // p_hub_user_id is NULL, p_user_addresses is NULL → must fail CLOSED
    await expect(
      pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xlegacy002','Item','food','p1','TAMP3REF1','CUSD','crypto:CUSD',
          5.0,650,'TAMP3001',$2,'Carol','254700000001','Nairobi',NULL,
          NULL,$1,'p1','food',0,NULL
        )`,
        [realMerchant, v.id]
      )
    ).rejects.toThrow(/WRONG_OWNER/);
  });
});

// ── 002 / Section 3: record_burn_outcome atomic RPC ──────────────────────────

describe("002 — record_burn_outcome RPC", () => {
  it("sets recovery_state and inserts event atomically", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rbo1@test.com') RETURNING id`
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xrbo1', $1, 'RBO1_0001', 'pending') RETURNING id`,
      [u.id]
    );

    await pool.query(
      `SELECT record_burn_outcome($1,$2,'burn_ambiguous','burn_ambiguous','{"burn_idempotency_key":"test-key"}'::jsonb)`,
      [v.id, u.id]
    );

    const { rows: [updated] } = await pool.query(
      `SELECT recovery_state FROM issued_vouchers WHERE id=$1`, [v.id]
    );
    expect(updated.recovery_state).toBe("burn_ambiguous");

    const { rows: events } = await pool.query(
      `SELECT event_type, metadata FROM voucher_events WHERE issued_voucher_id=$1`, [v.id]
    );
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("burn_ambiguous");
    expect(events[0].metadata.burn_idempotency_key).toBe("test-key");
  });

  it("persists confirmed-burn recovery state and event atomically", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('rbo2@test.com') RETURNING id`
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xrbo2', $1, 'RBO2_0001', 'pending') RETURNING id`,
      [u.id]
    );

    await pool.query(
      `SELECT record_burn_outcome(
        $1,$2,'burn_confirmed_promote_failed','burn_confirmed_promote_failed',
        '{"burn_ref":"confirmed-ref"}'::jsonb
      )`,
      [v.id, u.id]
    );

    const { rows: [updated] } = await pool.query(
      `SELECT recovery_state FROM issued_vouchers WHERE id=$1`, [v.id]
    );
    expect(updated.recovery_state).toBe("burn_confirmed_promote_failed");

    const { rows: events } = await pool.query(
      `SELECT event_type, metadata FROM voucher_events WHERE issued_voucher_id=$1`, [v.id]
    );
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("burn_confirmed_promote_failed");
    expect(events[0].metadata.burn_ref).toBe("confirmed-ref");
  });

  it("exists in pg_proc after 002", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_proc WHERE proname='record_burn_outcome' AND pronamespace='public'::regnamespace`
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Phase 2 helper: create a program + channel allocation ────────────────────

async function createProgram(opts: {
  partnerIdHex?: string;
  state?: string;
  totalCap?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  channel?: string;
  channelCap?: number | null;
  channelActive?: boolean;
}) {
  const state = opts.state ?? "active";
  const totalCap = opts.totalCap ?? 100;
  const startAt = opts.startAt ?? null;
  const endAt = opts.endAt ?? null;
  const channel = opts.channel ?? "claw";
  const channelCap = opts.channelCap ?? totalCap;
  const channelActive = opts.channelActive ?? true;

  const partnerId = opts.partnerIdHex ?? `00000000-0000-0000-0000-${Date.now().toString(16).padStart(12, "0")}`;

  const { rows: [t] } = await pool.query(
    `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
     VALUES ($1, 'Phase2 Test', 'percent', 0, 10) RETURNING id`,
    [partnerId]
  );

  const { rows: [p] } = await pool.query(
    `INSERT INTO voucher_programs (template_id, name, state, total_cap, start_at, end_at)
     VALUES ($1, 'P2Test', $2, $3, $4, $5) RETURNING id`,
    [t.id, state, totalCap, startAt, endAt]
  );

  await pool.query(
    `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
     VALUES ($1, $2, $3, $4)`,
    [p.id, channel, channelCap, channelActive]
  );

  return { programId: p.id as string, templateId: t.id as string, partnerId: partnerId as string };
}

async function issueVia003(params: {
  programId:  string;
  channel:    string;
  sourceRef:  string;
  code:       string;
  address?:   string;
  hubUserId?: string;
}) {
  return pool.query(
    `SELECT * FROM issue_voucher_from_program(
       $1, $2, $3, $4, $5, $6, '{}'::jsonb, 'test-actor'
     )`,
    [
      params.programId,
      params.channel,
      params.sourceRef,
      params.address ?? "0xtest",
      params.hubUserId ?? null,
      params.code,
    ]
  );
}

// ── 003 — issue_voucher_from_program ─────────────────────────────────────────

describe("003 — issue_voucher_from_program: core issuance", () => {
  it("issues a voucher and records an event", async () => {
    const { programId } = await createProgram({});
    const { rows: [row] } = await issueVia003({
      programId,
      channel:  "claw",
      sourceRef: "claw:core-001",
      code:     "CORE0001",
    });

    expect(row.ok).toBe(true);
    expect(row.voucher_id).toBeTruthy();

    const { rows: [v] } = await pool.query(
      `SELECT status, acquisition_source, source_ref, program_id FROM issued_vouchers WHERE id=$1`,
      [row.voucher_id]
    );
    expect(v.status).toBe("issued");
    expect(v.acquisition_source).toBe("claw");
    expect(v.source_ref).toBe("claw:core-001");
    expect(v.program_id).toBe(programId);

    const { rows: events } = await pool.query(
      `SELECT event_type FROM voucher_events WHERE issued_voucher_id=$1`, [row.voucher_id]
    );
    expect(events[0].event_type).toBe("issued");
  });

  it("idempotent: same source_ref returns same voucher", async () => {
    const { programId } = await createProgram({});
    const { rows: [first] } = await issueVia003({ programId, channel: "claw", sourceRef: "claw:idem-001", code: "IDEM0001" });
    const { rows: [second] } = await issueVia003({ programId, channel: "claw", sourceRef: "claw:idem-001", code: "IDEM0002" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.voucher_id).toBe(second.voucher_id);

    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM issued_vouchers WHERE program_id=$1 AND source_ref='claw:idem-001'`,
      [programId]
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it("rejects SOURCE_REF_CONFLICT: same source_ref different program", async () => {
    const { programId: p1 } = await createProgram({});
    const { programId: p2 } = await createProgram({});

    await issueVia003({ programId: p1, channel: "claw", sourceRef: "claw:conflict-001", code: "CONF0001" });

    await expect(
      issueVia003({ programId: p2, channel: "claw", sourceRef: "claw:conflict-001", code: "CONF0002" })
    ).rejects.toThrow("SOURCE_REF_CONFLICT");
  });
});

describe("003 — issue_voucher_from_program: cap enforcement", () => {
  it("enforces total_cap: second issue fails when cap=1", async () => {
    const { programId } = await createProgram({ totalCap: 1 });

    await issueVia003({ programId, channel: "claw", sourceRef: "claw:cap-001", code: "CAP00001" });

    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:cap-002", code: "CAP00002" })
    ).rejects.toThrow("TOTAL_CAP_EXCEEDED");
  });

  it("enforces channel_cap: second issue fails when channel cap=1", async () => {
    const { programId } = await createProgram({ channelCap: 1, totalCap: 100 });

    await issueVia003({ programId, channel: "claw", sourceRef: "claw:chcap-001", code: "CHCAP001" });

    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:chcap-002", code: "CHCAP002" })
    ).rejects.toThrow("CHANNEL_CAP_EXCEEDED");
  });

  it("concurrent total-cap: only one succeeds when cap=1", async () => {
    const { programId } = await createProgram({ totalCap: 1 });

    const results = await Promise.allSettled([
      issueVia003({ programId, channel: "claw", sourceRef: "claw:cc-001", code: "CC000001" }),
      issueVia003({ programId, channel: "claw", sourceRef: "claw:cc-002", code: "CC000002" }),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures  = results.filter((r) => r.status === "rejected");
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });

  it("cross-channel: claw and raffle share total_cap=2", async () => {
    const { programId } = await createProgram({ totalCap: 2, channel: "claw", channelCap: 1 });
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'raffle',1,true)`,
      [programId]
    );

    await issueVia003({ programId, channel: "claw",   sourceRef: "claw:cross-001",   code: "CROSS001" });
    await issueVia003({ programId, channel: "raffle",  sourceRef: "raffle:cross-001", code: "CROSS002" });

    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:cross-003", code: "CROSS003" })
    ).rejects.toThrow(/CAP_EXCEEDED/);
  });

  it("void releases inventory so a new voucher can be issued", async () => {
    const { programId } = await createProgram({ totalCap: 1 });
    const { rows: [issued] } = await issueVia003({
      programId, channel: "claw", sourceRef: "claw:void-001", code: "VOID0001",
    });

    // Void the voucher
    await pool.query(
      `UPDATE issued_vouchers SET status='void' WHERE id=$1`, [issued.voucher_id]
    );

    // Now issuance should succeed again
    const { rows: [reissued] } = await issueVia003({
      programId, channel: "claw", sourceRef: "claw:void-002", code: "VOID0002",
    });
    expect(reissued.ok).toBe(true);
  });

  it("redeemed voucher remains consumed (does not release cap)", async () => {
    const { programId } = await createProgram({ totalCap: 1 });
    const { rows: [issued] } = await issueVia003({
      programId, channel: "claw", sourceRef: "claw:redd-001", code: "REDD0001",
    });

    await pool.query(
      `UPDATE issued_vouchers SET status='redeemed' WHERE id=$1`, [issued.voucher_id]
    );

    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:redd-002", code: "REDD0002" })
    ).rejects.toThrow("TOTAL_CAP_EXCEEDED");
  });
});

describe("003 — issue_voucher_from_program: program/channel state checks", () => {
  it("rejects paused program", async () => {
    const { programId } = await createProgram({ state: "paused" });
    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:paused-001", code: "PAUS0001" })
    ).rejects.toThrow("PROGRAM_NOT_ACTIVE");
  });

  it("rejects ended program", async () => {
    const { programId } = await createProgram({ state: "ended" });
    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:ended-001", code: "END00001" })
    ).rejects.toThrow("PROGRAM_NOT_ACTIVE");
  });

  it("rejects program with future start_at", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { programId } = await createProgram({ startAt: future });
    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:future-001", code: "FUT00001" })
    ).rejects.toThrow("PROGRAM_NOT_STARTED");
  });

  it("rejects program with past end_at", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const { programId } = await createProgram({ endAt: past });
    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:exp-001", code: "EXP00001" })
    ).rejects.toThrow("PROGRAM_ENDED");
  });

  it("rejects inactive channel", async () => {
    const { programId } = await createProgram({ channelActive: false });
    await expect(
      issueVia003({ programId, channel: "claw", sourceRef: "claw:inch-001", code: "INCH0001" })
    ).rejects.toThrow("CHANNEL_INACTIVE");
  });
});

describe("003 — program safety triggers", () => {
  it("rejects template_id change after issuance", async () => {
    const { programId, templateId, partnerId } = await createProgram({});
    await issueVia003({ programId, channel: "claw", sourceRef: "claw:tmpl-001", code: "TMPL0001" });

    const { rows: [t2] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'Alt', 'percent', 0, 5) RETURNING id`,
      [partnerId]
    );

    await expect(
      pool.query(`UPDATE voucher_programs SET template_id=$1 WHERE id=$2`, [t2.id, programId])
    ).rejects.toThrow("TEMPLATE_CHANGE_AFTER_ISSUANCE");
  });

  it("rejects total_cap reduction below consumed", async () => {
    const { programId } = await createProgram({ totalCap: 5 });
    await issueVia003({ programId, channel: "claw", sourceRef: "claw:caprdc-001", code: "CAPRDC01" });
    await issueVia003({ programId, channel: "claw", sourceRef: "claw:caprdc-002", code: "CAPRDC02" });

    await expect(
      pool.query(`UPDATE voucher_programs SET total_cap=1 WHERE id=$1`, [programId])
    ).rejects.toThrow("CAP_BELOW_CONSUMED");
  });

  it("rejects channel cap reduction below consumed", async () => {
    const { programId } = await createProgram({ channelCap: 5 });
    await issueVia003({ programId, channel: "claw", sourceRef: "claw:chcaprdc-001", code: "CHRDC001" });
    await issueVia003({ programId, channel: "claw", sourceRef: "claw:chcaprdc-002", code: "CHRDC002" });

    await expect(
      pool.query(
        `UPDATE voucher_program_channel_allocations SET cap=1 WHERE program_id=$1 AND channel='claw'`,
        [programId]
      )
    ).rejects.toThrow("CHANNEL_CAP_BELOW_CONSUMED");
  });
});

describe("003 — v_program_inventory view", () => {
  it("reflects consumed and remaining correctly", async () => {
    const { programId } = await createProgram({ totalCap: 10, channelCap: 5 });

    await issueVia003({ programId, channel: "claw", sourceRef: "claw:inv-001", code: "INV00001" });
    await issueVia003({ programId, channel: "claw", sourceRef: "claw:inv-002", code: "INV00002" });

    const { rows } = await pool.query(
      `SELECT program_consumed, program_remaining, channel_consumed, channel_remaining
       FROM v_program_inventory WHERE program_id=$1 AND channel='claw'`,
      [programId]
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].program_consumed)).toBe(2);
    expect(Number(rows[0].program_remaining)).toBe(8);
    expect(Number(rows[0].channel_consumed)).toBe(2);
    expect(Number(rows[0].channel_remaining)).toBe(3);
  });

  it("void does not count as consumed in view", async () => {
    const { programId } = await createProgram({ totalCap: 10, channelCap: 10 });
    const { rows: [issued] } = await issueVia003({
      programId, channel: "claw", sourceRef: "claw:voidinv-001", code: "VINV0001",
    });
    await pool.query(`UPDATE issued_vouchers SET status='void' WHERE id=$1`, [issued.voucher_id]);

    const { rows } = await pool.query(
      `SELECT program_consumed FROM v_program_inventory WHERE program_id=$1 AND channel='claw'`,
      [programId]
    );
    expect(Number(rows[0].program_consumed)).toBe(0);
  });
});

describe("003 — source_ref trigger", () => {
  it("rejects claw issuance without source_ref", async () => {
    await expect(
      pool.query(
        `INSERT INTO issued_vouchers (user_address, code, status, acquisition_source)
         VALUES ('0xtest', 'NOSRCREF', 'issued', 'claw')`
      )
    ).rejects.toThrow("SOURCE_REF_REQUIRED");
  });

  it("allows miles_purchase without source_ref", async () => {
    const { rows } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, code, status, acquisition_source)
       VALUES ('0xtest', 'MILESSRCR', 'pending', 'miles_purchase') RETURNING id`
    );
    expect(rows[0].id).toBeTruthy();
  });
});

describe("003 — issue_voucher_from_program: issue_voucher_from_program in pg_proc", () => {
  it("exists after 003", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_proc WHERE proname='issue_voucher_from_program' AND pronamespace='public'::regnamespace`
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Phase 2 audit blocker tests ───────────────────────────────────────────────

describe("003 — issue_voucher_from_program: recipient-safe idempotency", () => {
  it("rejects SOURCE_REF_CONFLICT when same source_ref used by different hub_user_id", async () => {
    const { rows: [u1] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rsid1@t.com') RETURNING id`);
    const { rows: [u2] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rsid2@t.com') RETURNING id`);
    const { programId } = await createProgram({});

    // First issue: user1
    await pool.query(
      `SELECT * FROM issue_voucher_from_program($1,'claw','claw:rsid-001','0xwallet1',$2,'RSID0001','{}'::jsonb,'actor')`,
      [programId, u1.id]
    );

    // Second attempt: same source_ref but user2
    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_from_program($1,'claw','claw:rsid-001','0xwallet1',$2,'RSID0002','{}'::jsonb,'actor')`,
        [programId, u2.id]
      )
    ).rejects.toThrow("SOURCE_REF_CONFLICT");
  });

  it("rejects SOURCE_REF_CONFLICT when same source_ref used with different wallet address", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rsaddr@t.com') RETURNING id`);
    const { programId } = await createProgram({});

    await pool.query(
      `SELECT * FROM issue_voucher_from_program($1,'claw','claw:rsaddr-001','0xwallet-a',$2,'RSAD0001','{}'::jsonb,'actor')`,
      [programId, u.id]
    );

    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_from_program($1,'claw','claw:rsaddr-001','0xwallet-b',$2,'RSAD0002','{}'::jsonb,'actor')`,
        [programId, u.id]
      )
    ).rejects.toThrow("SOURCE_REF_CONFLICT");
  });

  it("accepts exact retry: same source_ref, same user, same address", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rsok@t.com') RETURNING id`);
    const { programId } = await createProgram({});

    const { rows: [first] } = await pool.query(
      `SELECT * FROM issue_voucher_from_program($1,'claw','claw:rsok-001','0xwallet-ok',$2,'RSOK0001','{}'::jsonb,'actor')`,
      [programId, u.id]
    );
    const { rows: [second] } = await pool.query(
      `SELECT * FROM issue_voucher_from_program($1,'claw','claw:rsok-001','0xwallet-ok',$2,'RSOK0002','{}'::jsonb,'actor')`,
      [programId, u.id]
    );
    // Same voucher returned
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.voucher_id).toBe(second.voucher_id);
  });
});

describe("003 — issue_voucher_from_program: wallet resolution", () => {
  it("resolves linked wallet when only hub_user_id supplied (null address)", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('walres@t.com') RETURNING id`);
    // Insert a linked wallet
    await pool.query(
      `INSERT INTO hub_user_wallets (user_id, ecosystem, address)
       VALUES ($1, 'minipay', '0xresolvedwallet')`,
      [u.id]
    );

    const { programId } = await createProgram({});
    const { rows: [row] } = await pool.query(
      `SELECT * FROM issue_voucher_from_program($1,'claw','claw:walres-001',NULL,$2,'WRES0001','{}'::jsonb,'actor')`,
      [programId, u.id]
    );
    expect(row.ok).toBe(true);

    // Voucher should have the resolved address
    const { rows: [v] } = await pool.query(
      `SELECT user_address FROM issued_vouchers WHERE id=$1`, [row.voucher_id]
    );
    expect(v.user_address).toBe("0xresolvedwallet");
  });

  it("rejects NO_LINKED_WALLET when hub_user_id has no wallet", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('nowallet@t.com') RETURNING id`);
    const { programId } = await createProgram({});

    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_from_program($1,'claw','claw:nowallet-001',NULL,$2,'NW000001','{}'::jsonb,'actor')`,
        [programId, u.id]
      )
    ).rejects.toThrow("NO_LINKED_WALLET");
  });

  it("rejects RECIPIENT_REQUIRED when both address and hub_user_id are null", async () => {
    const { programId } = await createProgram({});

    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_from_program($1,'claw','claw:norec-001',NULL,NULL,'NOREC001','{}'::jsonb,'actor')`,
        [programId]
      )
    ).rejects.toThrow("RECIPIENT_REQUIRED");
  });
});

describe("003 — issue_voucher_from_program: template expiry", () => {
  it("rejects TEMPLATE_EXPIRED for expired template", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('tmplexp@t.com') RETURNING id`);
    const partnerId = "00000000-0000-0000-0000-ff0000000001";
    const past = new Date(Date.now() - 86_400_000).toISOString();

    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent, expires_at)
       VALUES ($1, 'Expired Template', 'percent', 0, 10, $2) RETURNING id`,
      [partnerId, past]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap)
       VALUES ($1, 'ExpiredTmpl', 'active', 10) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',10,true)`,
      [p.id]
    );

    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_from_program($1,'claw','claw:tmplexp-001','0xaddr',$2,'TXPIRE01','{}'::jsonb,'actor')`,
        [p.id, u.id]
      )
    ).rejects.toThrow("TEMPLATE_EXPIRED");
  });
});

describe("003 — program funding loaded from program (not caller)", () => {
  it("new function signature has no p_sponsor/p_funding_type params", async () => {
    // Verify the 8-param overload exists and the 10-param old one does not
    const { rows } = await pool.query(`
      SELECT pronargs FROM pg_proc
      WHERE proname = 'issue_voucher_from_program'
        AND pronamespace = 'public'::regnamespace
    `);
    // Only the 8-param version should exist
    const argCounts = rows.map((r: { pronargs: number }) => r.pronargs);
    expect(argCounts).not.toContain(10);
    expect(argCounts).toContain(8);
  });

  it("voucher inherits sponsor and funding_type from program row", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('fundtrust@t.com') RETURNING id`);
    const partnerId = "00000000-0000-0000-0000-ff0000000002";

    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'Trust Template', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type, sponsor)
       VALUES ($1, 'SponsoredProg', 'active', 10, 'sponsor', 'ACME Corp') RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',10,true)`,
      [p.id]
    );

    const { rows: [row] } = await pool.query(
      `SELECT * FROM issue_voucher_from_program($1,'claw','claw:ft-001','0xaddr',$2,'FT000001','{}'::jsonb,'actor')`,
      [p.id, u.id]
    );
    expect(row.ok).toBe(true);

    const { rows: [v] } = await pool.query(
      `SELECT funding_type, sponsor FROM issued_vouchers WHERE id=$1`, [row.voucher_id]
    );
    expect(v.funding_type).toBe("sponsor");
    expect(v.sponsor).toBe("ACME Corp");
  });
});

describe("003 — create_voucher_program RPC", () => {
  it("creates program + allocations atomically", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000010";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'CreateProg T', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );

    const { rows: [r] } = await pool.query(`
      SELECT * FROM create_voucher_program(
        'New Program', $1, 'free', NULL, 100,
        NULL, NULL,
        '[{"channel":"claw","cap":50,"active":true},{"channel":"raffle","cap":50,"active":true}]'::jsonb,
        '00000000-0000-0000-0000-000000000099'::uuid,
        $2::uuid
      )`, [t.id, partnerId]
    );
    expect(r.ok).toBe(true);
    expect(r.program_id).toBeTruthy();

    const { rows: allocations } = await pool.query(
      `SELECT channel, cap, active FROM voucher_program_channel_allocations WHERE program_id=$1 ORDER BY channel`,
      [r.program_id]
    );
    expect(allocations).toHaveLength(2);
    expect(allocations[0].channel).toBe("claw");
    expect(allocations[1].channel).toBe("raffle");
    expect(Number(allocations[0].cap)).toBe(50);

    // Must start in draft
    const { rows: [prog] } = await pool.query(
      `SELECT state FROM voucher_programs WHERE id=$1`, [r.program_id]
    );
    expect(prog.state).toBe("draft");
  });

  it("rolls back atomically when channel cap sum exceeds total_cap", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000011";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'RollbackT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );

    await expect(
      pool.query(`
        SELECT * FROM create_voucher_program(
          'Rollback Test', $1, 'free', NULL, 10,
          NULL, NULL,
          '[{"channel":"claw","cap":8,"active":true},{"channel":"raffle","cap":8,"active":true}]'::jsonb,
          '00000000-0000-0000-0000-000000000099'::uuid,
          $2::uuid
        )`, [t.id, partnerId]
      )
    ).rejects.toThrow("CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP");

    // No orphan program should exist
    const { rows: progs } = await pool.query(
      `SELECT 1 FROM voucher_programs WHERE name='Rollback Test' LIMIT 1`
    );
    expect(progs).toHaveLength(0);
  });

  it("rejects active channel with null cap", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000012";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'NullCapT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );

    await expect(
      pool.query(`
        SELECT * FROM create_voucher_program(
          'NullCap', $1, 'free', NULL, 100,
          NULL, NULL,
          '[{"channel":"claw","cap":null,"active":true}]'::jsonb,
          '00000000-0000-0000-0000-000000000099'::uuid,
          $2::uuid
        )`, [t.id, partnerId]
      )
    ).rejects.toThrow("ACTIVE_CHANNEL_MUST_HAVE_POSITIVE_CAP");
  });

  it("writes to merchant_audit_log on creation", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000013";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'AuditT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );

    const muId = "00000000-0000-0000-0000-000000000099";
    const { rows: [r] } = await pool.query(`
      SELECT * FROM create_voucher_program(
        'AuditProg', $1, 'free', NULL, 50,
        NULL, NULL,
        '[{"channel":"claw","cap":50,"active":true}]'::jsonb,
        $2::uuid,
        $3::uuid
      )`, [t.id, muId, partnerId]
    );

    const { rows: logs } = await pool.query(
      `SELECT action, merchant_user_id, metadata FROM merchant_audit_log WHERE metadata->>'program_id'=$1`,
      [r.program_id]
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("program.created");
    expect(logs[0].merchant_user_id).toBe(muId);
  });
});

describe("003 — transition_program_state RPC", () => {
  it("activates a draft program with valid config", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000020";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'ActivateT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1, 'ActivateMe', 'draft', 100) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',50,true)`,
      [p.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_settlement_terms
         (program_id,funding_party_type,settlement_currency,reimbursement_rate)
       VALUES($1,'akiba','cUSD',1)`,
      [p.id]
    );

    const { rows: [r] } = await pool.query(
      `SELECT * FROM transition_program_state($1,'active','00000000-0000-0000-0000-000000000099'::uuid,'00000000-0000-0000-0000-000000000098'::uuid)`, [p.id]
    );
    expect(r.ok).toBe(true);

    const { rows: [prog] } = await pool.query(
      `SELECT state FROM voucher_programs WHERE id=$1`, [p.id]
    );
    expect(prog.state).toBe("active");
  });

  it("rejects activation without total_cap", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000021";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'NoCapT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state) VALUES ($1, 'NoCap', 'draft') RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',50,true)`,
      [p.id]
    );

    await expect(
      pool.query(`SELECT * FROM transition_program_state($1,'active','00000000-0000-0000-0000-000000000099'::uuid,'00000000-0000-0000-0000-000000000098'::uuid)`, [p.id])
    ).rejects.toThrow("ACTIVATION_REQUIRES_TOTAL_CAP");
  });

  it("rejects activation without active allocations", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000022";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'NoAllocT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1, 'NoAlloc', 'draft', 100) RETURNING id`,
      [t.id]
    );

    await expect(
      pool.query(`SELECT * FROM transition_program_state($1,'active','00000000-0000-0000-0000-000000000099'::uuid,'00000000-0000-0000-0000-000000000098'::uuid)`, [p.id])
    ).rejects.toThrow("ACTIVATION_REQUIRES_ACTIVE_CHANNEL");
  });

  it("rejects draft allocation writes when channel cap sum exceeds total_cap", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000023";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'SumCapT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1, 'SumCap', 'draft', 10) RETURNING id`,
      [t.id]
    );
    await expect(
      pool.query(
        `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
         VALUES ($1,'claw',7,true),($1,'raffle',7,true)`,
        [p.id]
      )
    ).rejects.toThrow("CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP");
  });

  it("rejects invalid state transition", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000024";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'TransT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1, 'TransMe', 'draft', 100) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',50,true)`,
      [p.id]
    );

    // draft → paused is not a valid transition
    await expect(
      pool.query(`SELECT * FROM transition_program_state($1,'paused','00000000-0000-0000-0000-000000000099'::uuid,'00000000-0000-0000-0000-000000000098'::uuid)`, [p.id])
    ).rejects.toThrow("INVALID_TRANSITION");
  });

  it("writes to merchant_audit_log on state transition", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000025";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'AuditTransT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1, 'AuditTrans', 'draft', 100) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',100,true)`,
      [p.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_settlement_terms
         (program_id,funding_party_type,settlement_currency,reimbursement_rate)
       VALUES($1,'akiba','cUSD',1)`,
      [p.id]
    );
    const muId = "00000000-0000-0000-0000-000000000099";
    const pid2 = "00000000-0000-0000-0000-000000000098";
    await pool.query(
      `SELECT * FROM transition_program_state($1,'active',$2::uuid,$3::uuid)`,
      [p.id, muId, pid2]
    );

    const { rows: logs } = await pool.query(
      `SELECT action, merchant_user_id, metadata FROM merchant_audit_log
       WHERE merchant_user_id=$1 AND action='program.state_changed'
         AND metadata->>'program_id'=$2`,
      [muId, p.id]
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].merchant_user_id).toBe(muId);
    expect(logs[0].metadata.from_state).toBe("draft");
    expect(logs[0].metadata.to_state).toBe("active");
  });
});

describe("003 — reserve_with_program_atomic_hub", () => {
  it("exists after 003", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_proc WHERE proname='reserve_with_program_atomic_hub'
       AND pronamespace='public'::regnamespace`
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("stamps program_id on reserved voucher", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000030";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'MilesProg T', 'percent', 100, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type)
       VALUES ($1, 'MilesProg', 'active', 50, 'miles') RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1,'miles_purchase',50,true)`,
      [p.id]
    );

    const { rows: [{ id: userId }] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('milesprog@t.com') RETURNING id`
    );

    const { rows: [r] } = await pool.query(`
      SELECT * FROM reserve_with_program_atomic_hub(
        $1,'0xmilesaddr',$2,'MPRC0001',NULL,$3
      )`, [t.id, partnerId, userId]
    );
    expect(r.voucher_id).toBeTruthy();

    const { rows: [v] } = await pool.query(
      `SELECT program_id FROM issued_vouchers WHERE id=$1`, [r.voucher_id]
    );
    expect(v.program_id).toBe(p.id);
  });

  it("enforces program total cap under concurrent writes", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000031";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'ProgCapT', 'percent', 100, 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type)
       VALUES ($1, 'ProgCap', 'active', 1, 'miles') RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1,'miles_purchase',1,true)`,
      [p.id]
    );
    const { rows: [{ id: userId }] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('progcap@t.com') RETURNING id`
    );

    const results = await Promise.allSettled([
      pool.query(`SELECT * FROM reserve_with_program_atomic_hub($1,'0xpc1',$2,'PROGCAP1',NULL,$3)`, [t.id, partnerId, userId]),
      pool.query(`SELECT * FROM reserve_with_program_atomic_hub($1,'0xpc2',$2,'PROGCAP2',NULL,$3)`, [t.id, partnerId, userId]),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures  = results.filter((r) => r.status === "rejected");
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });
});

describe("003 — merchant_audit_log table", () => {
  it("exists after 003", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_tables WHERE tablename='merchant_audit_log' AND schemaname='public'`
    );
    expect(rows.length).toBe(1);
  });

  it("denies anon and authenticated access (RLS)", async () => {
    const { rows: policies } = await pool.query(
      `SELECT policyname FROM pg_policies WHERE tablename='merchant_audit_log'`
    );
    expect(policies.length).toBeGreaterThanOrEqual(2);
    const names = policies.map((p: { policyname: string }) => p.policyname);
    expect(names).toContain("mal_deny_anon");
    expect(names).toContain("mal_deny_auth");
  });
});

describe("003 — program constraint: start_at < end_at", () => {
  it("rejects insert where start_at >= end_at", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000040";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'SchedT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past   = new Date(Date.now() - 86_400_000).toISOString();

    await expect(
      pool.query(
        `INSERT INTO voucher_programs (template_id, name, start_at, end_at) VALUES ($1, 'BadSched', $2, $3)`,
        [t.id, future, past]
      )
    ).rejects.toThrow(/chk_vp_schedule/i);
  });

  it("accepts insert where start_at < end_at", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000041";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'GoodSched', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );
    const past   = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    await expect(
      pool.query(
        `INSERT INTO voucher_programs (template_id, name, start_at, end_at) VALUES ($1, 'GoodSched', $2, $3) RETURNING id`,
        [t.id, past, future]
      )
    ).resolves.not.toThrow();
  });
});

describe("003 — program constraint: total_cap > 0", () => {
  it("rejects total_cap = 0", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000050";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'ZeroCapT', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );

    await expect(
      pool.query(
        `INSERT INTO voucher_programs (template_id, name, total_cap) VALUES ($1, 'ZeroCap', 0)`,
        [t.id]
      )
    ).rejects.toThrow(/chk_vp_total_cap_positive/i);
  });

  it("accepts null total_cap (unlimited)", async () => {
    const partnerId = "00000000-0000-0000-0000-ff0000000051";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'NullCapT2', 'percent', 0, 10) RETURNING id`,
      [partnerId]
    );

    await expect(
      pool.query(
        `INSERT INTO voucher_programs (template_id, name, total_cap) VALUES ($1, 'NullCap2', NULL) RETURNING id`,
        [t.id]
      )
    ).resolves.not.toThrow();
  });
});

// ─── Phase 2 Final Remediation Tests ─────────────────────────────────────────

describe("003 — merchant_audit_log: 003 is a no-op on production schema", () => {
  it("leaves pre-existing audit rows intact after 003 applies", async () => {
    const { rows } = await pool.query(
      `SELECT action, metadata FROM merchant_audit_log
       WHERE id='00000000-0000-0000-0000-aaa000000001'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("order.accepted");
    expect(rows[0].metadata).toEqual({ order_id: "legacy-1" });
  });

  it("has no entity_type, entity_id, actor_id, old_values, new_values columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='merchant_audit_log' AND table_schema='public'
    `);
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).not.toContain("entity_type");
    expect(cols).not.toContain("entity_id");
    expect(cols).not.toContain("actor_id");
    expect(cols).not.toContain("old_values");
    expect(cols).not.toContain("new_values");
  });

  it("has the production-schema columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='merchant_audit_log' AND table_schema='public'
    `);
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toContain("merchant_user_id");
    expect(cols).toContain("partner_id");
    expect(cols).toContain("action");
    expect(cols).toContain("order_id");
    expect(cols).toContain("metadata");
  });
});

describe("003 — voucher_program_channel_sources table", () => {
  it("exists after 003", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_tables WHERE tablename='voucher_program_channel_sources' AND schemaname='public'`
    );
    expect(rows).toHaveLength(1);
  });

  it("has required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='voucher_program_channel_sources' AND table_schema='public'
    `);
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toContain("program_id");
    expect(cols).toContain("channel");
    expect(cols).toContain("chain_id");
    expect(cols).toContain("contract_address");
    expect(cols).toContain("allowed_reward_classes");
    expect(cols).toContain("active");
  });

  it("enforces UNIQUE(program_id, channel)", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000a0";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, 'SrcUniqT', 'percent', 0, 5) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1,'SrcUniq','draft',10) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',10,true)`,
      [p.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_sources (program_id, channel, chain_id, contract_address)
       VALUES ($1,'claw',44787,'0xdeadbeef01')`,
      [p.id]
    );
    await expect(
      pool.query(
        `INSERT INTO voucher_program_channel_sources (program_id, channel, chain_id, contract_address)
         VALUES ($1,'claw',44787,'0xdeadbeef02')`,
        [p.id]
      )
    ).rejects.toThrow(/unique/i);
  });
});

describe("003 — reserve_with_program_atomic_hub: program resolution safety", () => {
  async function makeTemplate(partnerId: string, label: string) {
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, $2, 'percent', 100, 10) RETURNING id`,
      [partnerId, label]
    );
    return t as { id: string };
  }

  async function makeUser(email: string) {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ($1) RETURNING id`, [email]
    );
    return u as { id: string };
  }

  it("returns PROGRAM_REQUIRED when zero eligible programs exist", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000b0";
    const t = await makeTemplate(partnerId, "NoProg T");
    const u = await makeUser("noprog@t.com");

    await expect(
      pool.query(
        `SELECT * FROM reserve_with_program_atomic_hub($1,'0xnoprog',$2,'NOPROG1',NULL,$3)`,
        [t.id, partnerId, u.id]
      )
    ).rejects.toThrow("PROGRAM_REQUIRED");
  });

  it("returns PROGRAM_AMBIGUOUS when multiple active programs match", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000b1";
    const t = await makeTemplate(partnerId, "AmbigT");
    const u = await makeUser("ambig@t.com");

    for (const name of ["MilesProg-A", "MilesProg-B"]) {
      const { rows: [p] } = await pool.query(
        `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type)
         VALUES ($1,$2,'active',100,'miles') RETURNING id`,
        [t.id, name]
      );
      await pool.query(
        `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
         VALUES ($1,'miles_purchase',100,true)`,
        [p.id]
      );
    }

    await expect(
      pool.query(
        `SELECT * FROM reserve_with_program_atomic_hub($1,'0xambig',$2,'AMBIG1',NULL,$3)`,
        [t.id, partnerId, u.id]
      )
    ).rejects.toThrow("PROGRAM_AMBIGUOUS");
  });

  it("returns CAP_EXCEEDED when the only eligible program is exhausted", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000b2";
    const t = await makeTemplate(partnerId, "ExhaustedT");
    const u = await makeUser("exhausted@t.com");

    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type)
       VALUES ($1,'ExhaustedProg','active',1,'miles') RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1,'miles_purchase',1,true)`,
      [p.id]
    );
    // Simulate one consumed voucher so the program total_cap is exhausted.
    await pool.query(
      `INSERT INTO issued_vouchers (user_address, voucher_template_id, code, status, source_ref, program_id, acquisition_source)
       VALUES ('0xexhausted', $1, 'EXHV0001', 'redeemed', 'test:exh:0001', $2, 'miles_purchase')`,
      [t.id, p.id]
    );

    await expect(
      pool.query(
        `SELECT * FROM reserve_with_program_atomic_hub($1,'0xexh',$2,'EXH1',NULL,$3)`,
        [t.id, partnerId, u.id]
      )
    ).rejects.toThrow(/PROGRAM_TOTAL_CAP_EXCEEDED/);
  });

  it("does NOT fall back to unlimited Phase 1 path when no program exists", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000b3";
    const t = await makeTemplate(partnerId, "NoFallbackT");
    const u = await makeUser("nofallback@t.com");

    const result = await pool.query(
      `SELECT * FROM reserve_with_program_atomic_hub($1,'0xnofb',$2,'NOFB1',NULL,$3)`,
      [t.id, partnerId, u.id]
    ).catch((e: Error) => e);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/PROGRAM_REQUIRED/);
  });
});

describe("003 — invariant triggers: direct DB writes are guarded", () => {
  async function makeTemplate(partnerId: string, label: string) {
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, $2, 'percent', 0, 5) RETURNING id`,
      [partnerId, label]
    );
    return t as { id: string };
  }

  it("rejects INSERT of active voucher_programs without total_cap", async () => {
    const t = await makeTemplate("00000000-0000-0000-0000-ff00000000c0", "TrigT1");
    await expect(
      pool.query(
        `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1,'TrigA1','active',NULL)`,
        [t.id]
      )
    ).rejects.toThrow(/ACTIVATION_REQUIRES_TOTAL_CAP/);
  });

  it("rejects UPDATE that reduces total_cap below alloc sum", async () => {
    const t = await makeTemplate("00000000-0000-0000-0000-ff00000000c1", "TrigT2");
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1,'TrigCapReduce','draft',100) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1,'claw',60,true),($1,'raffle',40,true)`,
      [p.id]
    );
    // Reducing total_cap to 90 is below 100 alloc sum
    await expect(
      pool.query(`UPDATE voucher_programs SET total_cap=90 WHERE id=$1`, [p.id])
    ).rejects.toThrow(/TOTAL_CAP_BELOW_ALLOC_SUM/);
  });

  it("rejects INSERT of active allocation with null cap", async () => {
    const t = await makeTemplate("00000000-0000-0000-0000-ff00000000c2", "TrigT3");
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1,'TrigNullAlloc','draft',100) RETURNING id`,
      [t.id]
    );
    await expect(
      pool.query(
        `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
         VALUES ($1,'claw',NULL,true)`,
        [p.id]
      )
    ).rejects.toThrow(/ACTIVE_ALLOCATION_REQUIRES_POSITIVE_CAP/);
  });

  it("rejects INSERT of channel allocation exceeding total_cap", async () => {
    const t = await makeTemplate("00000000-0000-0000-0000-ff00000000c3", "TrigT4");
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1,'TrigOverAlloc','draft',50) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',30,true)`,
      [p.id]
    );
    await expect(
      pool.query(
        `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'raffle',30,true)`,
        [p.id]
      )
    ).rejects.toThrow(/CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP/);
  });

  it("rejects DELETE of channel allocation that has consumed inventory", async () => {
    const t = await makeTemplate("00000000-0000-0000-0000-ff00000000c4", "TrigT5");
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type)
       VALUES ($1,'TrigConsumedDel','active',20,'miles') RETURNING id`,
      [t.id]
    );
    // Two channels so last-channel guard doesn't block; only the consumed one is deleted.
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1,'miles_purchase',10,true),($1,'claw',10,true)`,
      [p.id]
    );
    // Simulate one consumed voucher on the miles_purchase channel.
    await pool.query(
      `INSERT INTO issued_vouchers (user_address, voucher_template_id, code, status, source_ref, program_id, acquisition_source)
       VALUES ('0xtrigcons', $1, 'TRIG0C001', 'redeemed', 'test:trigc:001', $2, 'miles_purchase')`,
      [t.id, p.id]
    );
    // Delete the consumed channel — last-channel guard passes (claw still active).
    // consumed-delete guard fires: CANNOT_DELETE_CHANNEL_WITH_CONSUMPTION.
    await expect(
      pool.query(
        `DELETE FROM voucher_program_channel_allocations WHERE program_id=$1 AND channel='miles_purchase'`,
        [p.id]
      )
    ).rejects.toThrow(/CANNOT_DELETE_CHANNEL_WITH_CONSUMPTION/);
  });

  it("rejects DELETE of last active channel on an active program", async () => {
    const t = await makeTemplate("00000000-0000-0000-0000-ff00000000c5", "TrigT6");
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap, funding_type)
       VALUES ($1,'TrigLastChan','active',10,'miles') RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1,'miles_purchase',10,true)`,
      [p.id]
    );
    await expect(
      pool.query(
        `DELETE FROM voucher_program_channel_allocations WHERE program_id=$1 AND channel='miles_purchase'`,
        [p.id]
      )
    ).rejects.toThrow(/CANNOT_REMOVE_LAST_ACTIVE_CHANNEL/);
  });
});

describe("003 — update_voucher_program RPC", () => {
  it("function exists after 003", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_proc WHERE proname='update_voucher_program' AND pronamespace='public'::regnamespace`
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("updates program name atomically", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000d0";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1,'UpdateT','percent',0,5) RETURNING id`,
      [partnerId]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap) VALUES ($1,'OldName','draft',50) RETURNING id`,
      [t.id]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active) VALUES ($1,'claw',50,true)`,
      [p.id]
    );

    const muId = "00000000-0000-0000-0000-000000000099";
    const { rows: [r] } = await pool.query(`
      SELECT * FROM update_voucher_program(
        $1, $2::uuid, $3::uuid,
        'NewName', NULL, NULL, 50, NULL, NULL, false, false
      )`, [p.id, muId, partnerId]
    );
    expect(r.ok).toBe(true);

    const { rows: [prog] } = await pool.query(
      `SELECT name FROM voucher_programs WHERE id=$1`, [p.id]
    );
    expect(prog.name).toBe("NewName");
  });
});

describe("003 — reserve_voucher_atomic_hub Phase 1 signature compatibility", () => {
  it("accepts NULL::jsonb for rules_snapshot (9-param Phase 1 signature)", async () => {
    const partnerId = "00000000-0000-0000-0000-ff00000000e0";
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1,'Phase1CompatT','percent',0,5) RETURNING id`,
      [partnerId]
    );
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('phase1compat@t.com') RETURNING id`
    );

    const { rows: [r] } = await pool.query(`
      SELECT * FROM reserve_voucher_atomic_hub(
        $1, '0xcompat', $2, 'COMPAT01', NULL, $3,
        NULL::jsonb, 'miles_purchase', 'miles'
      )`, [t.id, partnerId, u.id]
    );
    expect(r.voucher_id).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 004 — Voucher-as-asset + QR presentation / in-store redemption
// ══════════════════════════════════════════════════════════════════════════════

import { createHash, randomUUID } from "crypto";

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function rawToken(label: string): string {
  // Deterministic-per-label raw token in the AKV1 shape (tests only).
  return `AKV1.${Buffer.from(`${label}:${Math.random()}`).toString("base64url")}`;
}

// Creates a partner + template + issued voucher in status='issued'.
// Uses acquisition_source='miles_purchase' so the source_ref trigger doesn't fire.
async function makePresentableVoucher(opts: {
  label: string;
  partnerId?: string;
  hubUserId?: string | null;
  address?: string;
  expiresAt?: string | null;
  status?: string;
  partnerName?: string;
}): Promise<{ voucherId: string; partnerId: string; templateId: string }> {
  const partnerId = opts.partnerId ?? `00000000-0000-0000-0000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;

  await pool.query(
    `INSERT INTO partners (id, slug, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [partnerId, `slug-${opts.label}`, opts.partnerName ?? `Partner ${opts.label}`]
  );

  const { rows: [t] } = await pool.query(
    `INSERT INTO spend_voucher_templates
       (partner_id, title, voucher_type, miles_cost, discount_percent, applicable_category)
     VALUES ($1, $2, 'percent', 100, 15, 'food') RETURNING id`,
    [partnerId, `Offer ${opts.label}`]
  );

  const snapshot = {
    merchant_id: partnerId,
    voucher_type: "percent",
    discount_percent: 15,
    discount_cusd: null,
    applicable_category: "food",
    title: `Offer ${opts.label}`,
  };
  const { rows: [program] } = await pool.query(
    `INSERT INTO voucher_programs(name,template_id,funding_type,total_cap,state)
     VALUES($1,$2,'sponsor',100,'draft') RETURNING id`,
    [`Program ${opts.label}`, t.id],
  );
  await pool.query(
    `INSERT INTO voucher_program_settlement_terms(
       program_id,funding_party_type,funding_party_reference,settlement_currency,reimbursement_rate
     ) VALUES($1,'sponsor',$2,'cUSD',1)`,
    [program.id, `sponsor-${opts.label}`],
  );

  const { rows: [v] } = await pool.query(
    `INSERT INTO issued_vouchers
       (user_address, hub_user_id, merchant_id, voucher_template_id, program_id, code, status,
        acquisition_source, expires_at, rules_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'miles_purchase', $8, $9) RETURNING id`,
    [
      (opts.address ?? "0xpresent").toLowerCase(),
      opts.hubUserId ?? null,
      partnerId,
      t.id,
      program.id,
      `QR${opts.label.slice(0, 8).toUpperCase()}`,
      opts.status ?? "issued",
      opts.expiresAt ?? null,
      JSON.stringify(snapshot),
    ]
  );

  return { voucherId: v.id, partnerId, templateId: t.id };
}

const FUTURE_TOKEN_EXPIRY = () => new Date(Date.now() + 100_000).toISOString();

describe("004 applies cleanly and is idempotent", () => {
  it("runs 004 a second time without error", async () => {
    await expect(
      pool.query(readFileSync(MIGRATION_PATH_004, "utf-8"))
    ).resolves.not.toThrow();
    await expect(
      pool.query(readFileSync(MIGRATION_PATH_005, "utf-8"))
    ).resolves.not.toThrow();
    await expect(
      pool.query(readFileSync(MIGRATION_PATH_031, "utf-8"))
    ).resolves.not.toThrow();
  });

  it("creates all expected functions", async () => {
    const fns = [
      "issue_voucher_presentation_atomic",
      "revoke_voucher_presentation_atomic",
      "inspect_voucher_presentation",
      "redeem_voucher_in_store_atomic",
      "merchant_grant_atomic",
    ];
    for (const fn of fns) {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`,
        [fn]
      );
      expect(rows.length, `Function ${fn} should exist`).toBeGreaterThanOrEqual(1);
    }
  });

  it("clears stale tokens created before the lifecycle trigger existed", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO auth.users (email) VALUES ('stale-backfill@t.com') RETURNING id`
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers
         (user_address, hub_user_id, code, status, redemption_token_hash,
          redemption_token_expires_at, redemption_token_issued_at)
       VALUES ('0xstale', $1, 'STALEQR1', 'claiming', $2, now()+interval '60 seconds', now())
       RETURNING id`,
      [u.id, sha256hex("AKV1.stale-backfill")]
    );

    await pool.query(readFileSync(MIGRATION_PATH_004, "utf-8"));

    const { rows: [after] } = await pool.query(
      `SELECT redemption_token_hash FROM issued_vouchers WHERE id=$1`,
      [v.id]
    );
    expect(after.redemption_token_hash).toBeNull();
  });
});

describe("004 — issued_vouchers token columns", () => {
  it("adds redemption token columns", async () => {
    const cols = ["redemption_token_expires_at", "redemption_token_issued_at", "redemption_token_version"];
    for (const col of cols) {
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='issued_vouchers' AND column_name=$1`,
        [col]
      );
      expect(rows.length, `issued_vouchers.${col} should exist`).toBe(1);
    }
  });

  it("redemption_token_version defaults to 0 and is NOT NULL", async () => {
    const { rows } = await pool.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name='issued_vouchers' AND column_name='redemption_token_version'`
    );
    expect(rows[0].is_nullable).toBe("NO");
    expect(rows[0].column_default).toContain("0");
  });

  it("creates uq_iv_token_hash partial unique index", async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename='issued_vouchers' AND indexname='uq_iv_token_hash'`
    );
    expect(rows.length).toBe(1);
  });
});

describe("004 — voucher_redemptions extensions", () => {
  it("adds redemption_channel, merchant_user_id, external_reference", async () => {
    for (const col of ["redemption_channel", "merchant_user_id", "external_reference"]) {
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='voucher_redemptions' AND column_name=$1`,
        [col]
      );
      expect(rows.length, `voucher_redemptions.${col}`).toBe(1);
    }
  });

  it("makes redemption_channel non-null with an online_order default", async () => {
    const { rows } = await pool.query(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name='voucher_redemptions' AND column_name='redemption_channel'`
    );
    expect(rows[0].is_nullable).toBe("NO");
    expect(rows[0].column_default).toContain("online_order");
  });

  it("rejects an invalid redemption_channel", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('vrchan@t.com') RETURNING id`);
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xvrchan', $1, 'VRCHAN001', 'issued') RETURNING id`,
      [u.id]
    );
    await expect(
      pool.query(
        `INSERT INTO voucher_redemptions (issued_voucher_id, discount_applied, redemption_channel)
         VALUES ($1, 0, 'bogus_channel')`,
        [v.id]
      )
    ).rejects.toThrow(/chk_vr_redemption_channel/i);
  });
});

describe("004 — voucher_events extended constraint", () => {
  it("accepts 'presented' and 'presentation_revoked'", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('veext@t.com') RETURNING id`);
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xveext', $1, 'VEEXT0001', 'issued') RETURNING id`,
      [u.id]
    );
    await expect(
      pool.query(`INSERT INTO voucher_events (issued_voucher_id, event_type) VALUES ($1, 'presented')`, [v.id])
    ).resolves.not.toThrow();
    await expect(
      pool.query(`INSERT INTO voucher_events (issued_voucher_id, event_type) VALUES ($1, 'presentation_revoked')`, [v.id])
    ).resolves.not.toThrow();
  });

  it("still rejects an unknown event_type", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('veext2@t.com') RETURNING id`);
    const { rows: [v] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, hub_user_id, code, status)
       VALUES ('0xveext2', $1, 'VEEXT0002', 'issued') RETURNING id`,
      [u.id]
    );
    await expect(
      pool.query(`INSERT INTO voucher_events (issued_voucher_id, event_type) VALUES ($1, 'nope_event')`, [v.id])
    ).rejects.toThrow(/check/i);
  });
});

describe("004 — issue_voucher_presentation_atomic", () => {
  it("mints a token and records a 'presented' event (status=issued)", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('pres1@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "pres1", hubUserId: u.id });
    const hash = sha256hex(rawToken("pres1"));

    const { rows } = await pool.query(
      `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
      [voucherId, u.id, hash, FUTURE_TOKEN_EXPIRY()]
    );
    expect(rows[0].ok).toBe(true);
    expect(rows[0].token_version).toBe(1);
    expect(rows[0].merchant_name).toContain("Partner");

    const { rows: ev } = await pool.query(
      `SELECT event_type, metadata FROM voucher_events WHERE issued_voucher_id=$1 AND event_type='presented'`,
      [voucherId]
    );
    expect(ev.length).toBe(1);
    expect(ev[0].metadata.token_version).toBe(1);
  });

  it("rejects when voucher is not status=issued", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('pres2@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "pres2", hubUserId: u.id, status: "redeemed" });
    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
        [voucherId, u.id, sha256hex(rawToken("pres2")), FUTURE_TOKEN_EXPIRY()]
      )
    ).rejects.toThrow(/ALREADY_REDEEMED/);
  });

  it("rejects a wrong owner", async () => {
    const { rows: [u1] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('presown1@t.com') RETURNING id`);
    const { rows: [u2] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('presown2@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "presown", hubUserId: u1.id });
    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY['0xnotmine']::text[],$3,$4)`,
        [voucherId, u2.id, sha256hex(rawToken("presown")), FUTURE_TOKEN_EXPIRY()]
      )
    ).rejects.toThrow(/NOT_OWNER/);
  });

  it("increments token_version on rotation", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('presrot@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "presrot", hubUserId: u.id });

    const { rows: first } = await pool.query(
      `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
      [voucherId, u.id, sha256hex(rawToken("presrot-a")), FUTURE_TOKEN_EXPIRY()]
    );
    const { rows: second } = await pool.query(
      `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
      [voucherId, u.id, sha256hex(rawToken("presrot-b")), FUTURE_TOKEN_EXPIRY()]
    );
    expect(first[0].token_version).toBe(1);
    expect(second[0].token_version).toBe(2);
  });

  it("rejects token expiry beyond now()+120s", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('preslong@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "preslong", hubUserId: u.id });
    const tooLong = new Date(Date.now() + 200_000).toISOString();
    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
        [voucherId, u.id, sha256hex(rawToken("preslong")), tooLong]
      )
    ).rejects.toThrow(/TOKEN_EXPIRY_TOO_LONG/);
  });

  it("rejects a malformed SHA-256 token hash", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('preshash@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "preshash", hubUserId: u.id });
    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
        [voucherId, u.id, "not-a-sha256-hash", FUTURE_TOKEN_EXPIRY()]
      )
    ).rejects.toThrow(/INVALID_TOKEN_HASH/);
  });

  it("rejects a token expiry that is not in the future", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('prespast@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "prespast", hubUserId: u.id });
    await expect(
      pool.query(
        `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
        [voucherId, u.id, sha256hex(rawToken("prespast")), new Date(Date.now() - 1_000).toISOString()]
      )
    ).rejects.toThrow(/TOKEN_EXPIRY_NOT_FUTURE/);
  });

  it("persists the expired transition and returns ok=false", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('presexp@t.com') RETURNING id`);
    const past = new Date(Date.now() - 1000).toISOString();
    const { voucherId } = await makePresentableVoucher({ label: "presexp", hubUserId: u.id, expiresAt: past });

    const { rows } = await pool.query(
      `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
      [voucherId, u.id, sha256hex(rawToken("presexp")), FUTURE_TOKEN_EXPIRY()]
    );
    expect(rows[0].ok).toBe(false);

    const { rows: [v] } = await pool.query(
      `SELECT status, redemption_token_hash FROM issued_vouchers WHERE id=$1`, [voucherId]
    );
    expect(v.redemption_token_hash).toBeNull();
    expect(v.status).toBe("expired");

    const { rows: events } = await pool.query(
      `SELECT 1 FROM voucher_events WHERE issued_voucher_id=$1 AND event_type='expired'`,
      [voucherId]
    );
    expect(events).toHaveLength(1);
  });
});

describe("004 — revoke_voucher_presentation_atomic", () => {
  it("is idempotent when no token is present", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rev1@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "rev1", hubUserId: u.id });
    const { rows } = await pool.query(
      `SELECT * FROM revoke_voucher_presentation_atomic($1,$2,ARRAY[]::text[])`,
      [voucherId, u.id]
    );
    expect(rows[0].ok).toBe(true);
  });

  it("clears token fields after a presentation", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rev2@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "rev2", hubUserId: u.id });
    await pool.query(
      `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
      [voucherId, u.id, sha256hex(rawToken("rev2")), FUTURE_TOKEN_EXPIRY()]
    );
    await pool.query(
      `SELECT * FROM revoke_voucher_presentation_atomic($1,$2,ARRAY[]::text[])`,
      [voucherId, u.id]
    );
    const { rows: [v] } = await pool.query(
      `SELECT redemption_token_hash, redemption_token_expires_at, redemption_token_issued_at
       FROM issued_vouchers WHERE id=$1`,
      [voucherId]
    );
    expect(v.redemption_token_hash).toBeNull();
    expect(v.redemption_token_expires_at).toBeNull();
    expect(v.redemption_token_issued_at).toBeNull();
  });

  it("rejects a wrong owner", async () => {
    const { rows: [u1] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rev3a@t.com') RETURNING id`);
    const { rows: [u2] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('rev3b@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "rev3", hubUserId: u1.id });
    await expect(
      pool.query(
        `SELECT * FROM revoke_voucher_presentation_atomic($1,$2,ARRAY['0xnope']::text[])`,
        [voucherId, u2.id]
      )
    ).rejects.toThrow(/NOT_OWNER/);
  });
});

// Helper: present a voucher and return the raw token + hash.
async function presentVoucher(voucherId: string, hubUserId: string, label: string) {
  const raw = rawToken(label);
  const hash = sha256hex(raw);
  await pool.query(
    `SELECT * FROM issue_voucher_presentation_atomic($1,$2,ARRAY[]::text[],$3,$4)`,
    [voucherId, hubUserId, hash, FUTURE_TOKEN_EXPIRY()]
  );
  return { raw, hash };
}

describe("004 — inspect_voucher_presentation", () => {
  it("returns generic valid=false for an unknown token", async () => {
    const { rows } = await pool.query(
      `SELECT * FROM inspect_voucher_presentation($1,$2)`,
      [sha256hex("AKV1.nonexistent"), "00000000-0000-0000-0000-000000000abc"]
    );
    expect(rows[0].valid).toBe(false);
    expect(rows[0].invalid_reason).toBe("INVALID");
    expect(rows[0].voucher_id).toBeNull();
    expect(rows[0].offer_title).toBeNull();
  });

  it("returns the same generic result for an expired token", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('insexp@t.com') RETURNING id`);
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "insexp", hubUserId: u.id });
    const hash = sha256hex(rawToken("insexp"));
    // Set a token directly with a past expiry.
    await pool.query(
      `UPDATE issued_vouchers
         SET redemption_token_hash=$2, redemption_token_expires_at=now() - interval '5 seconds',
             redemption_token_issued_at=now()
       WHERE id=$1`,
      [voucherId, hash]
    );
    const { rows } = await pool.query(`SELECT * FROM inspect_voucher_presentation($1,$2)`, [hash, partnerId]);
    expect(rows[0].valid).toBe(false);
    expect(rows[0].invalid_reason).toBe("INVALID");
    expect(rows[0].voucher_id).toBeNull();
  });

  it("returns the same generic result for a different partner", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('inswm@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "inswm", hubUserId: u.id });
    const { hash } = await presentVoucher(voucherId, u.id, "inswm");
    const { rows } = await pool.query(
      `SELECT * FROM inspect_voucher_presentation($1,$2)`,
      [hash, "00000000-0000-0000-0000-000000009999"]
    );
    expect(rows[0].valid).toBe(false);
    expect(rows[0].invalid_reason).toBe("INVALID");
    expect(rows[0].voucher_id).toBeNull();
  });

  it("returns a valid preview for a valid token", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('insok@t.com') RETURNING id`);
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "insok", hubUserId: u.id, partnerName: "Insok Cafe" });
    const { hash } = await presentVoucher(voucherId, u.id, "insok");
    const { rows } = await pool.query(`SELECT * FROM inspect_voucher_presentation($1,$2)`, [hash, partnerId]);
    expect(rows[0].valid).toBe(true);
    expect(rows[0].voucher_id).toBe(voucherId);
    expect(rows[0].merchant_name).toBe("Insok Cafe");
    expect(Number(rows[0].discount_percent)).toBe(15);
  });

  it("does not expose user address or raw rules in the response", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('inspii@t.com') RETURNING id`);
    const { voucherId, partnerId } = await makePresentableVoucher({
      label: "inspii", hubUserId: u.id, address: "0xSEKRITWALLET",
    });
    const { hash } = await presentVoucher(voucherId, u.id, "inspii");
    const { rows, fields } = await pool.query(`SELECT * FROM inspect_voucher_presentation($1,$2)`, [hash, partnerId]);
    const cols = fields.map((f) => f.name);
    expect(cols).not.toContain("user_address");
    expect(cols).not.toContain("rules_snapshot");
    expect(cols).not.toContain("redemption_token_hash");
    expect(JSON.stringify(rows[0]).toLowerCase()).not.toContain("0xsekritwallet");
  });

  it("uses the immutable rules snapshot instead of mutable template terms", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('inssnap@t.com') RETURNING id`);
    const { voucherId, partnerId, templateId } = await makePresentableVoucher({
      label: "inssnap", hubUserId: u.id,
    });
    const { hash } = await presentVoucher(voucherId, u.id, "inssnap");

    await pool.query(
      `UPDATE spend_voucher_templates
          SET title='Mutated Offer', discount_percent=99, applicable_category='electronics'
        WHERE id=$1`,
      [templateId]
    );

    const { rows } = await pool.query(
      `SELECT * FROM inspect_voucher_presentation($1,$2)`,
      [hash, partnerId]
    );
    expect(rows[0].offer_title).toBe("Offer inssnap");
    expect(Number(rows[0].discount_percent)).toBe(15);
    expect(rows[0].applicable_category).toBe("food");
  });
});

describe("004 — redeem_voucher_in_store_atomic", () => {
  it("redeems a presented voucher and writes channel + audit rows", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('red1@t.com') RETURNING id`);
    const muId = "00000000-0000-0000-0000-00000000ed01";
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "red1", hubUserId: u.id });
    const { hash } = await presentVoucher(voucherId, u.id, "red1");

    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [hash, partnerId, muId, 10, "POS-001"]
    );
    expect(rows[0].ok).toBe(true);
    expect(rows[0].voucher_id).toBe(voucherId);

    const { rows: [v] } = await pool.query(
      `SELECT status, redemption_token_hash FROM issued_vouchers WHERE id=$1`, [voucherId]
    );
    expect(v.status).toBe("redeemed");
    expect(v.redemption_token_hash).toBeNull();

    const { rows: [r] } = await pool.query(
      `SELECT redemption_channel, merchant_user_id, external_reference, discount_applied
         FROM voucher_redemptions
        WHERE issued_voucher_id=$1`,
      [voucherId]
    );
    expect(r.redemption_channel).toBe("merchant_scan");
    expect(r.merchant_user_id).toBe(muId);
    expect(r.external_reference).toBe("POS-001");
    expect(Number(r.discount_applied)).toBe(1.5);

    const { rows: audit } = await pool.query(
      `SELECT action FROM merchant_audit_log WHERE metadata->>'voucher_id'=$1 AND action='voucher.redeemed'`,
      [voucherId]
    );
    expect(audit.length).toBe(1);
  });

  it("concurrent double-scan: exactly one succeeds", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('reddbl@t.com') RETURNING id`);
    const muId = "00000000-0000-0000-0000-00000000ed02";
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "reddbl", hubUserId: u.id });
    const { hash } = await presentVoucher(voucherId, u.id, "reddbl");

    const results = await Promise.all([
      pool.query(`SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`, [hash, partnerId, muId, 10, "A"]),
      pool.query(`SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`, [hash, partnerId, muId, 10, "B"]),
    ]);
    expect(results.filter((r) => r.rows[0].ok).length).toBe(1);
    expect(results.filter((r) => !r.rows[0].ok && r.rows[0].error_code === "INVALID").length).toBe(1);
  });

  it("online checkout claim racing a merchant scan: exactly one path redeems", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('redrace@t.com') RETURNING id`);
    const muId = "00000000-0000-0000-0000-00000000ed03";
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "redrace", hubUserId: u.id });
    const { hash } = await presentVoucher(voucherId, u.id, "redrace");

    const onlineClaim = pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xpresent']::text[],$3)`,
      [voucherId, u.id, partnerId]
    );
    const merchantScan = pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [hash, partnerId, muId, 10, "race"]
    );

    const [claimRes, scanRes] = await Promise.all([onlineClaim, merchantScan]);
    const claimWon = claimRes.rows[0].ok === true;
    const scanWon = scanRes.rows[0].ok === true;
    expect(Number(claimWon) + Number(scanWon)).toBe(1);

    if (claimWon) {
      await pool.query(
        `SELECT * FROM place_hub_order_and_redeem_voucher(
          $1,'0xpresent','Race item','food','race-product',$2,'CUSD','crypto:CUSD',
          8.5,650,'RACE',$3,'Alice','254700000001','Nairobi',NULL,
          $4,$1,'race-product','food',1.5,ARRAY['0xpresent']::text[]
        )`,
        [partnerId, `RACE-${Date.now()}`, voucherId, u.id]
      );
    }

    const { rows: [v] } = await pool.query(
      `SELECT status, redemption_token_hash FROM issued_vouchers WHERE id=$1`,
      [voucherId]
    );
    expect(v.status).toBe("redeemed");
    expect(v.redemption_token_hash).toBeNull();

    const { rows: redemptions } = await pool.query(
      `SELECT COUNT(*) AS c FROM voucher_redemptions WHERE issued_voucher_id=$1`, [voucherId]
    );
    expect(Number(redemptions[0].c)).toBe(1);
  });

  it("returns generic INVALID for an unknown token", async () => {
    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [sha256hex("AKV1.unknown"), "00000000-0000-0000-0000-000000000abc", "00000000-0000-0000-0000-0000000eed09", 1, null]
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "INVALID", voucher_id: null });
  });

  it("returns the same generic INVALID for an expired token", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('redexp@t.com') RETURNING id`);
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "redexp", hubUserId: u.id });
    const hash = sha256hex(rawToken("redexp"));
    await pool.query(
      `UPDATE issued_vouchers SET redemption_token_hash=$2,
              redemption_token_expires_at=now() - interval '5 seconds', redemption_token_issued_at=now()
       WHERE id=$1`,
      [voucherId, hash]
    );
    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [hash, partnerId, "00000000-0000-0000-0000-0000000eed09", 1, null]
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "INVALID", voucher_id: null });
  });

  it("returns the same generic INVALID for a wrong merchant", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('redwm@t.com') RETURNING id`);
    const { voucherId } = await makePresentableVoucher({ label: "redwm", hubUserId: u.id });
    const { hash } = await presentVoucher(voucherId, u.id, "redwm");
    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [hash, "00000000-0000-0000-0000-000000008888", "00000000-0000-0000-0000-0000000eed09", 1, null]
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "INVALID", voucher_id: null });
  });

  it("persists voucher expiry discovered during redemption", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('redvexp@t.com') RETURNING id`);
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "redvexp", hubUserId: u.id });
    const hash = sha256hex(rawToken("redvexp"));
    await pool.query(
      `UPDATE issued_vouchers
          SET expires_at=now() - interval '5 seconds',
              redemption_token_hash=$2,
              redemption_token_expires_at=now() + interval '60 seconds',
              redemption_token_issued_at=now()
        WHERE id=$1`,
      [voucherId, hash]
    );

    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [hash, partnerId, "00000000-0000-0000-0000-0000000eed09", 1, null]
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "INVALID" });

    const { rows: [v] } = await pool.query(
      `SELECT status, redemption_token_hash FROM issued_vouchers WHERE id=$1`,
      [voucherId]
    );
    expect(v.status).toBe("expired");
    expect(v.redemption_token_hash).toBeNull();
  });

  it("a redeemed voucher cannot reuse the old token", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('redreuse@t.com') RETURNING id`);
    const muId = "00000000-0000-0000-0000-00000000ed04";
    const { voucherId, partnerId } = await makePresentableVoucher({ label: "redreuse", hubUserId: u.id });
    const { hash } = await presentVoucher(voucherId, u.id, "redreuse");

    await pool.query(`SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`, [hash, partnerId, muId, 10, null]);
    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,$5)`,
      [hash, partnerId, muId, 10, null]
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "INVALID" });
  });
});

describe("004 — presentation token lifecycle invariant", () => {
  it("claim and release cannot resurrect an old presentation token", async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO auth.users (email) VALUES ('tokenlife@t.com') RETURNING id`);
    const { voucherId, partnerId } = await makePresentableVoucher({
      label: "tokenlife", hubUserId: u.id, address: "0xTokenLife",
    });
    const { hash } = await presentVoucher(voucherId, u.id, "tokenlife");

    const { rows: claimed } = await pool.query(
      `SELECT * FROM claim_voucher_atomic($1,$2,ARRAY['0xtokenlife']::text[],$3)`,
      [voucherId, u.id, partnerId]
    );
    expect(claimed[0].ok).toBe(true);

    const { rows: released } = await pool.query(
      `SELECT release_claimed_voucher($1,$2,ARRAY['0xtokenlife']::text[])`,
      [voucherId, u.id]
    );
    expect(released[0].release_claimed_voucher).toBe(true);

    const { rows: [voucher] } = await pool.query(
      `SELECT status, redemption_token_hash FROM issued_vouchers WHERE id=$1`,
      [voucherId]
    );
    expect(voucher.status).toBe("issued");
    expect(voucher.redemption_token_hash).toBeNull();

    const { rows: inspected } = await pool.query(
      `SELECT * FROM inspect_voucher_presentation($1,$2)`,
      [hash, partnerId]
    );
    expect(inspected[0]).toMatchObject({ valid: false, invalid_reason: "INVALID", voucher_id: null });
  });
});

describe("004 — merchant_grant_atomic", () => {
  async function makeGrantProgram(label: string) {
    const partnerId = `00000000-0000-0000-0000-${label.replace(/[^0-9a-f]/g, "0").padEnd(12, "a").slice(0, 12)}`;
    const { rows: [t] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, miles_cost, discount_percent)
       VALUES ($1, $2, 'percent', 0, 10) RETURNING id`,
      [partnerId, `Grant ${label}`]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap)
       VALUES ($1, $2, 'active', 100) RETURNING id`,
      [t.id, `GrantProg ${label}`]
    );
    await pool.query(
      `INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
       VALUES ($1, 'merchant_grant', 100, true)`,
      [p.id]
    );
    return { programId: p.id as string, partnerId };
  }

  it("writes an audit row using the production schema", async () => {
    const muId = "00000000-0000-0000-0000-0000000eed01";
    const { programId, partnerId } = await makeGrantProgram("aud");

    const { rows } = await pool.query(
      `SELECT * FROM merchant_grant_atomic($1,$2,$3,$4,NULL,$5,$6)`,
      [programId, muId, partnerId, "0xgrantee", "MGRANT001", "mgrant:aud:001"]
    );
    expect(rows[0].ok).toBe(true);
    expect(rows[0].voucher_id).toBeTruthy();

    const { rows: audit } = await pool.query(
      `SELECT merchant_user_id, partner_id, action, metadata
       FROM merchant_audit_log
       WHERE action='voucher.merchant_granted' AND metadata->>'voucher_id'=$1`,
      [rows[0].voucher_id]
    );
    expect(audit.length).toBe(1);
    expect(audit[0].merchant_user_id).toBe(muId);
    expect(audit[0].partner_id).toBe(partnerId);
    expect(audit[0].metadata.program_id).toBe(programId);
  });

  it("is idempotent: duplicate source_ref returns the same voucher", async () => {
    const muId = "00000000-0000-0000-0000-0000000eed02";
    const secondManagerId = "00000000-0000-0000-0000-0000000eed12";
    const { programId, partnerId } = await makeGrantProgram("idem");

    const { rows: first } = await pool.query(
      `SELECT * FROM merchant_grant_atomic($1,$2,$3,$4,NULL,$5,$6)`,
      [programId, muId, partnerId, "0xidemgrantee", "MGRANT010", "mgrant:idem:001"]
    );
    const { rows: second } = await pool.query(
      `SELECT * FROM merchant_grant_atomic($1,$2,$3,$4,NULL,$5,$6)`,
      [programId, secondManagerId, partnerId, "0xidemgrantee", "MGRANT011", "mgrant:idem:001"]
    );
    expect(first[0].voucher_id).toBe(second[0].voucher_id);

    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) AS c FROM issued_vouchers WHERE program_id=$1 AND source_ref='mgrant:idem:001'`,
      [programId]
    );
    expect(Number(cnt[0].c)).toBe(1);

    const { rows: audits } = await pool.query(
      `SELECT COUNT(*) AS c
         FROM merchant_audit_log
        WHERE action='voucher.merchant_granted'
          AND metadata->>'voucher_id'=$1`,
      [first[0].voucher_id]
    );
    expect(Number(audits[0].c)).toBe(1);
  });

  it("rejects a caller-supplied partner that does not own the program", async () => {
    const muId = "00000000-0000-0000-0000-0000000eed03";
    const { programId } = await makeGrantProgram("iso");
    const wrongPartner = "00000000-0000-0000-0000-00000000f999";

    await expect(
      pool.query(
        `SELECT * FROM merchant_grant_atomic($1,$2,$3,$4,NULL,$5,$6)`,
        [programId, muId, wrongPartner, "0xisolated", "MGRANT020", "mgrant:iso:001"]
      )
    ).rejects.toThrow(/PROGRAM_PARTNER_MISMATCH/);

    const { rows: vouchers } = await pool.query(
      `SELECT 1 FROM issued_vouchers WHERE program_id=$1 AND source_ref='mgrant:iso:001'`,
      [programId]
    );
    expect(vouchers).toHaveLength(0);
  });
});

describe("004 — no PII in inspect response", () => {
  it("inspect returns only the safe preview columns", async () => {
    const { fields } = await pool.query(
      `SELECT * FROM inspect_voucher_presentation($1,$2) LIMIT 0`,
      [sha256hex("AKV1.shape"), "00000000-0000-0000-0000-000000000abc"]
    );
    const cols = new Set(fields.map((f) => f.name));
    const expected = [
      "valid", "invalid_reason", "voucher_id", "offer_title", "voucher_type",
      "discount_percent", "discount_cusd", "merchant_name", "applicable_category", "token_expires_at",
    ];
    expect([...cols].sort()).toEqual([...expected].sort());
    expect(cols.has("user_address")).toBe(false);
    expect(cols.has("hub_user_id")).toBe(false);
    expect(cols.has("rules_snapshot")).toBe(false);
  });
});

describe("005 — voucher settlement invariants", () => {
  async function makeSettlementVoucher(
    label: string,
    snapshot: Record<string, unknown>,
    withTerms = true,
  ) {
    const partnerId = randomUUID();
    await pool.query(
      `INSERT INTO partners(id,slug,name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
      [partnerId, `settle-${label}`, `Settlement ${label}`],
    );
    const { rows: [template] } = await pool.query(
      `INSERT INTO spend_voucher_templates(
         partner_id,title,voucher_type,miles_cost,discount_percent,discount_cusd,retail_value_cusd
       ) VALUES($1,$2,$3,1,$4,$5,$6) RETURNING id`,
      [
        partnerId,
        `Settlement ${label}`,
        snapshot.voucher_type,
        snapshot.discount_percent ?? null,
        snapshot.discount_cusd ?? null,
        snapshot.retail_value_cusd ?? null,
      ],
    );
    const { rows: [program] } = await pool.query(
      `INSERT INTO voucher_programs(name,template_id,funding_type,total_cap,state)
       VALUES($1,$2,'sponsor',100,'draft') RETURNING id`,
      [`Program ${label}`, template.id],
    );
    if (withTerms) {
      await pool.query(
        `INSERT INTO voucher_program_settlement_terms(
           program_id,funding_party_type,funding_party_reference,settlement_currency,reimbursement_rate
         ) VALUES($1,'sponsor',$2,'cUSD',0.8)`,
        [program.id, `sponsor-${label}`],
      );
    }
    const rawToken = `AKV1.${Buffer.alloc(32, label.charCodeAt(0) || 1).toString("base64url")}`;
    const { rows: [voucher] } = await pool.query(
      `INSERT INTO issued_vouchers(
         user_address,merchant_id,voucher_template_id,program_id,code,status,rules_snapshot,
         redemption_token_hash,redemption_token_expires_at
       ) VALUES($1,$2,$3,$4,$5,'issued',$6,$7,now()+interval '5 minutes') RETURNING id`,
      [`0x${label}`, partnerId, template.id, program.id, `S${label}`, JSON.stringify(snapshot), sha256hex(rawToken)],
    );
    return { partnerId, templateId: template.id, programId: program.id, voucherId: voucher.id, rawToken };
  }

  it.each([
    ["percent", { voucher_type: "percent", discount_percent: 20, retail_value_cusd: 15 }, 50, 10],
    ["fixed", { voucher_type: "fixed", discount_cusd: 12 }, 7, 7],
    ["free", { voucher_type: "free_product", retail_value_cusd: 9 }, 20, 9],
  ])("calculates %s discounts exactly", async (_name, snapshot, gross, expected) => {
    const { rows } = await pool.query(
      `SELECT calculate_voucher_discount($1::jsonb,$2::numeric) AS amount`,
      [JSON.stringify(snapshot), gross],
    );
    expect(Number(rows[0].amount)).toBe(expected);
  });

  it("uses immutable voucher snapshot after template mutation", async () => {
    const fixture = await makeSettlementVoucher("snap001", {
      voucher_type: "percent", discount_percent: 25, retail_value_cusd: 100, title: "Snapshot",
    });
    await pool.query(`UPDATE spend_voucher_templates SET discount_percent=90 WHERE id=$1`, [fixture.templateId]);
    const { rows } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,40,'snapshot-order')`,
      [sha256hex(fixture.rawToken), fixture.partnerId, randomUUID()],
    );
    expect(rows[0].ok).toBe(true);
    const { rows: entries } = await pool.query(
      `SELECT discount_amount_cusd,payable_amount FROM voucher_settlement_entries WHERE issued_voucher_id=$1`,
      [fixture.voucherId],
    );
    expect(Number(entries[0].discount_amount_cusd)).toBe(10);
    expect(Number(entries[0].payable_amount)).toBe(8);
  });

  it("rolls redemption back when settlement terms are missing", async () => {
    const fixture = await makeSettlementVoucher("noterms1", {
      voucher_type: "fixed", discount_cusd: 5, title: "No terms",
    }, false);
    await expect(pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,20,NULL)`,
      [sha256hex(fixture.rawToken), fixture.partnerId, randomUUID()],
    )).rejects.toThrow(/SETTLEMENT_TERMS_REQUIRED/);
    const { rows } = await pool.query(`SELECT status FROM issued_vouchers WHERE id=$1`, [fixture.voucherId]);
    expect(rows[0].status).toBe("issued");
  });

  it("concurrent redemption creates one payable", async () => {
    const fixture = await makeSettlementVoucher("race0001", {
      voucher_type: "fixed", discount_cusd: 4, title: "Race",
    });
    const args = [sha256hex(fixture.rawToken), fixture.partnerId, randomUUID(), 10];
    const results = await Promise.all([
      pool.query(`SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,NULL)`, args),
      pool.query(`SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,$4,NULL)`, args),
    ]);
    expect(results.filter((result) => result.rows[0].ok).length).toBe(1);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM voucher_settlement_entries WHERE issued_voucher_id=$1`,
      [fixture.voucherId],
    );
    expect(rows[0].count).toBe(1);
  });

  it("prevents settlement ledger mutation", async () => {
    const { rows: [entry] } = await pool.query(
      `SELECT id FROM voucher_settlement_entries ORDER BY created_at DESC LIMIT 1`,
    );
    await expect(pool.query(
      `UPDATE voucher_settlement_entries SET payable_amount=999 WHERE id=$1`,
      [entry.id],
    )).rejects.toThrow(/append-only/);
    await expect(pool.query(
      `DELETE FROM voucher_settlement_entries WHERE id=$1`,
      [entry.id],
    )).rejects.toThrow(/append-only/);
  });

  it("isolates batches by partner and prevents concurrent duplicate batching", async () => {
    const fixture = await makeSettlementVoucher("batch001", {
      voucher_type: "fixed", discount_cusd: 3, title: "Batch",
    });
    await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic($1,$2,$3,10,NULL)`,
      [sha256hex(fixture.rawToken), fixture.partnerId, randomUUID()],
    );
    const { rows: [entry] } = await pool.query(
      `SELECT id FROM voucher_settlement_entries WHERE issued_voucher_id=$1`,
      [fixture.voucherId],
    );
    await expect(pool.query(
      `SELECT * FROM create_partner_settlement_batch($1,'cUSD',ARRAY[$2]::uuid[],$3,'admin')`,
      [randomUUID(), entry.id, `wrong-${randomUUID()}`],
    )).rejects.toThrow(/INVALID_OR_CROSS_PARTNER_PAYABLE/);

    const attempts = await Promise.allSettled([
      pool.query(
        `SELECT * FROM create_partner_settlement_batch($1,'cUSD',ARRAY[$2]::uuid[],$3,'admin')`,
        [fixture.partnerId, entry.id, `batch-a-${randomUUID()}`],
      ),
      pool.query(
        `SELECT * FROM create_partner_settlement_batch($1,'cUSD',ARRAY[$2]::uuid[],$3,'admin')`,
        [fixture.partnerId, entry.id, `batch-b-${randomUUID()}`],
      ),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
  });

  it("enforces transitions and unique paid references", async () => {
    const { rows: batches } = await pool.query(
      `SELECT id FROM merchant_settlement_batches WHERE state='draft' ORDER BY created_at DESC LIMIT 1`,
    );
    const batchId = batches[0].id;
    await expect(pool.query(
      `SELECT * FROM transition_partner_settlement_batch($1,'paid','admin','ref-x','{}')`,
      [batchId],
    )).rejects.toThrow(/INVALID_BATCH_TRANSITION/);
    await pool.query(`SELECT * FROM transition_partner_settlement_batch($1,'approved','admin',NULL,NULL)`, [batchId]);
    await pool.query(`SELECT * FROM transition_partner_settlement_batch($1,'processing','admin',NULL,NULL)`, [batchId]);
    await pool.query(
      `SELECT * FROM transition_partner_settlement_batch($1,'paid','admin','unique-payment-ref','{"manual":true}')`,
      [batchId],
    );
    const { rows: [other] } = await pool.query(
      `INSERT INTO merchant_settlement_batches(partner_id,currency,idempotency_key,created_by,state)
       VALUES($1,'cUSD',$2,'admin','processing') RETURNING id`,
      [randomUUID(), `manual-${randomUUID()}`],
    );
    await expect(pool.query(
      `SELECT * FROM transition_partner_settlement_batch($1,'paid','admin','unique-payment-ref','{"manual":true}')`,
      [other.id],
    )).rejects.toThrow(/uq_msb_payment_reference/);
  });

  it("records ambiguous legacy redemptions once on migration reapplication", async () => {
    const fixture = await makeSettlementVoucher("legacy01", {
      voucher_type: "fixed", discount_cusd: 2, title: "Legacy",
    }, false);
    const { rows: [redemption] } = await pool.query(
      `INSERT INTO voucher_redemptions(
         issued_voucher_id,user_address,merchant_id,discount_applied,redemption_channel
       ) VALUES($1,'0xlegacy',$2,2,'merchant_scan') RETURNING id`,
      [fixture.voucherId, fixture.partnerId],
    );
    await pool.query(readFileSync(MIGRATION_PATH_005, "utf-8"));
    await pool.query(readFileSync(MIGRATION_PATH_005, "utf-8"));
    await pool.query(readFileSync(MIGRATION_PATH_031, "utf-8"));
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM reconciliation_incidents
       WHERE type='voucher_settlement_backfill_ambiguous' AND data->>'redemption_id'=$1`,
      [redemption.id],
    );
    expect(rows[0].count).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 006 — Phase 5: payout execution, provider controls, reconciliation
// ════════════════════════════════════════════════════════════════════════════

describe("006 — payout execution (Phase 5)", () => {
  const ENC = { iv: "aa", tag: "bb", ciphertext: "cc" };

  async function makeDestination(partnerId: string, opts: { approved?: boolean; cooled?: boolean } = {}) {
    const { rows: [d] } = await pool.query(
      `SELECT destination_id FROM register_payout_destination(
         $1,'manual','Manual Dest','USD',$2::jsonb,'Manual ...0001',$3,'merchant@x',NULL)`,
      [partnerId, JSON.stringify(ENC), randomUUID()],
    );
    const destId = d.destination_id;
    if (opts.approved !== false) {
      await pool.query(`SELECT * FROM approve_payout_destination($1,'admin@x','admin')`, [destId]);
    }
    if (opts.cooled !== false) {
      await pool.query(
        `UPDATE merchant_payout_destinations SET last_modified_at = now() - interval '48 hours' WHERE id=$1`,
        [destId],
      );
    }
    return destId;
  }

  async function makeApprovedBatch(partnerId: string, amount = 100) {
    const { rows: [b] } = await pool.query(
      `INSERT INTO merchant_settlement_batches(
         partner_id,currency,item_count,total_payable_amount,idempotency_key,created_by,state,approved_at
       ) VALUES($1,'USD',1,$2,$3,'admin','approved',now()) RETURNING id`,
      [partnerId, amount, `b-${randomUUID()}`],
    );
    return b.id;
  }

  // ── applies cleanly and is idempotent ──────────────────────────────────────
  describe("006 applies cleanly and is idempotent", () => {
    it("applies 006 twice without error", async () => {
      await pool.query(readFileSync(MIGRATION_PATH_006, "utf-8"));
      await pool.query(readFileSync(MIGRATION_PATH_006, "utf-8"));
    });

    it("creates the key payout RPCs", async () => {
      const fns = [
        "create_payout_instruction", "record_payout_submission", "record_payout_confirmation",
        "mark_payout_uncertain", "retry_payout", "process_provider_callback",
        "register_payout_destination", "approve_payout_destination",
        "pause_payout_provider", "resume_payout_provider",
      ];
      for (const fn of fns) {
        const res = await pool.query(
          "SELECT 1 FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace", [fn],
        );
        expect(res.rows.length, `Function ${fn} should exist`).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ── provider config seeded ─────────────────────────────────────────────────
  describe("006 — payout_provider_config seeded", () => {
    it("test provider is enabled", async () => {
      const { rows } = await pool.query(
        `SELECT is_enabled FROM payout_provider_config WHERE provider_name='test'`);
      expect(rows[0].is_enabled).toBe(true);
    });
    it("mpesa_b2c provider is disabled", async () => {
      const { rows } = await pool.query(
        `SELECT is_enabled FROM payout_provider_config WHERE provider_name='mpesa_b2c'`);
      expect(rows[0].is_enabled).toBe(false);
    });
  });

  // ── batch state extension ──────────────────────────────────────────────────
  describe("006 — merchant_settlement_batches state extension", () => {
    it("allows the new 'submitted' state", async () => {
      const { rows: [b] } = await pool.query(
        `INSERT INTO merchant_settlement_batches(partner_id,currency,idempotency_key,created_by,state)
         VALUES($1,'USD',$2,'admin','submitted') RETURNING state`,
        [randomUUID(), `sub-${randomUUID()}`],
      );
      expect(b.state).toBe("submitted");
    });
  });

  // ── create_payout_instruction validation ───────────────────────────────────
  describe("006 — create_payout_instruction validation", () => {
    it("rejects batch not in approved state", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const { rows: [b] } = await pool.query(
        `INSERT INTO merchant_settlement_batches(partner_id,currency,item_count,total_payable_amount,idempotency_key,created_by,state)
         VALUES($1,'USD',1,100,$2,'admin','draft') RETURNING id`,
        [partner, `d-${randomUUID()}`],
      );
      await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [b.id, dest]))
        .rejects.toThrow(/BATCH_NOT_APPROVED/);
    });

    it("rejects destination from a different partner", async () => {
      const partner = randomUUID();
      const otherDest = await makeDestination(randomUUID());
      const batch = await makeApprovedBatch(partner);
      await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, otherDest]))
        .rejects.toThrow(/DESTINATION_WRONG_PARTNER/);
    });

    it("rejects an unapproved destination", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner, { approved: false });
      const batch = await makeApprovedBatch(partner);
      await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]))
        .rejects.toThrow(/DESTINATION_NOT_APPROVED/);
    });

    it("rejects a destination still in the cooling period", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner, { cooled: false }); // approved now, not backdated
      const batch = await makeApprovedBatch(partner);
      await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]))
        .rejects.toThrow(/DESTINATION_COOLING_PERIOD/);
    });

    it("rejects when the provider is paused", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const batch = await makeApprovedBatch(partner);
      await pool.query(`SELECT * FROM pause_payout_provider('manual','test','admin')`);
      try {
        await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]))
          .rejects.toThrow(/PROVIDER_PAUSED/);
      } finally {
        await pool.query(`SELECT * FROM resume_payout_provider('manual','admin')`);
      }
    });

    it("rejects amount above the per-payout limit", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const batch = await makeApprovedBatch(partner, 9999999); // > manual per_payout_limit (999999)
      await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]))
        .rejects.toThrow(/EXCEEDS_PER_PAYOUT_LIMIT/);
    });
  });

  // ── state machine ──────────────────────────────────────────────────────────
  describe("006 — payout state machine", () => {
    async function freshInstruction(amount = 100) {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const batch = await makeApprovedBatch(partner, amount);
      const { rows: [r] } = await pool.query(
        `SELECT * FROM create_payout_instruction($1,$2,'init@x')`, [batch, dest]);
      return { partner, dest, batch, instructionId: r.instruction_id };
    }

    it("happy path: pending -> submitted -> confirmed, batch paid", async () => {
      const { batch, instructionId } = await freshInstruction();
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','REF-1','rh','resp',now()+interval '2 hours')`,
        [instructionId]);
      await pool.query(
        `SELECT * FROM record_payout_confirmation($1,'a','REF-1',100,'USD')`, [instructionId]);
      const { rows: [b] } = await pool.query(`SELECT state FROM merchant_settlement_batches WHERE id=$1`, [batch]);
      const { rows: [i] } = await pool.query(`SELECT state FROM settlement_payout_instructions WHERE id=$1`, [instructionId]);
      expect(b.state).toBe("paid");
      expect(i.state).toBe("confirmed");
    });

    it("timeout path: submitted -> uncertain creates an incident", async () => {
      const { instructionId } = await freshInstruction();
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','REF-T','rh','resp',now()+interval '2 hours')`,
        [instructionId]);
      await pool.query(`SELECT * FROM mark_payout_uncertain($1,'a','timeout')`, [instructionId]);
      const { rows: [i] } = await pool.query(`SELECT state FROM settlement_payout_instructions WHERE id=$1`, [instructionId]);
      expect(i.state).toBe("uncertain");
      const { rows } = await pool.query(
        `SELECT count(*)::int AS c FROM reconciliation_incidents
         WHERE type='payout_uncertain' AND data->>'instruction_id'=$1`, [instructionId]);
      expect(rows[0].c).toBe(1);
    });

    it("retry from uncertain returns batch to approved", async () => {
      const { batch, instructionId } = await freshInstruction();
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','REF-U','rh','resp',now()+interval '2 hours')`,
        [instructionId]);
      await pool.query(`SELECT * FROM mark_payout_uncertain($1,'a','timeout')`, [instructionId]);
      await pool.query(`SELECT * FROM retry_payout($1,'a')`, [instructionId]);
      const { rows: [i] } = await pool.query(`SELECT state FROM settlement_payout_instructions WHERE id=$1`, [instructionId]);
      const { rows: [b] } = await pool.query(`SELECT state FROM merchant_settlement_batches WHERE id=$1`, [batch]);
      expect(i.state).toBe("pending");
      expect(b.state).toBe("approved");
    });

    it("retry from failed returns instruction to pending", async () => {
      const { instructionId } = await freshInstruction();
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','REF-F','rh','resp',now()+interval '2 hours')`,
        [instructionId]);
      await pool.query(`SELECT * FROM record_payout_failure($1,'a','E','boom')`, [instructionId]);
      await pool.query(`SELECT * FROM retry_payout($1,'a')`, [instructionId]);
      const { rows: [i] } = await pool.query(`SELECT state FROM settlement_payout_instructions WHERE id=$1`, [instructionId]);
      expect(i.state).toBe("pending");
    });

    it("confirmed payout cannot be retried", async () => {
      const { instructionId } = await freshInstruction();
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','REF-C','rh','resp',now()+interval '2 hours')`,
        [instructionId]);
      await pool.query(`SELECT * FROM record_payout_confirmation($1,'a','REF-C',100,'USD')`, [instructionId]);
      await expect(pool.query(`SELECT * FROM retry_payout($1,'a')`, [instructionId]))
        .rejects.toThrow(/CANNOT_RETRY_IN_STATE/);
    });

    it("confirmation rejects an amount mismatch", async () => {
      const { instructionId } = await freshInstruction();
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','REF-M','rh','resp',now()+interval '2 hours')`,
        [instructionId]);
      await expect(pool.query(`SELECT * FROM record_payout_confirmation($1,'a','REF-M',999,'USD')`, [instructionId]))
        .rejects.toThrow(/AMOUNT_MISMATCH/);
      const { rows: [i] } = await pool.query(`SELECT state FROM settlement_payout_instructions WHERE id=$1`, [instructionId]);
      expect(i.state).toBe("submitted"); // not confirmed
    });
  });

  // ── callback idempotency ───────────────────────────────────────────────────
  describe("006 — process_provider_callback idempotency", () => {
    it("treats the same raw_body_hash as already processed on replay", async () => {
      const hash = `cbh-${randomUUID()}`;
      await pool.query(
        `SELECT * FROM process_provider_callback('test',$1,'UNK',1,'USD','confirmed',true,'sys')`, [hash]);
      const { rows } = await pool.query(
        `SELECT * FROM process_provider_callback('test',$1,'UNK',1,'USD','confirmed',true,'sys')`, [hash]);
      expect(rows[0].already_processed).toBe(true);
    });

    it("creates an incident on an invalid signature", async () => {
      const hash = `cbsig-${randomUUID()}`;
      const { rows } = await pool.query(
        `SELECT * FROM process_provider_callback('test',$1,'X',1,'USD','confirmed',false,'sys')`, [hash]);
      expect(rows[0].error_code).toBe("INVALID_SIGNATURE");
      const { rows: inc } = await pool.query(
        `SELECT count(*)::int AS c FROM reconciliation_incidents WHERE type='payout_callback_invalid_signature'`);
      expect(inc[0].c).toBeGreaterThanOrEqual(1);
    });

    it("creates an incident on an unknown provider reference", async () => {
      const hash = `cbunk-${randomUUID()}`;
      const { rows } = await pool.query(
        `SELECT * FROM process_provider_callback('test',$1,'NO-SUCH-REF',1,'USD','confirmed',true,'sys')`, [hash]);
      expect(rows[0].error_code).toBe("UNKNOWN_REFERENCE");
    });

    it("confirms an instruction via a valid callback", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const batch = await makeApprovedBatch(partner);
      const { rows: [c] } = await pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]);
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','CB-REF','rh','resp',now()+interval '2 hours')`,
        [c.instruction_id]);
      const hash = `cbok-${randomUUID()}`;
      const { rows } = await pool.query(
        `SELECT * FROM process_provider_callback('test',$1,'CB-REF',100,'USD','confirmed',true,'sys')`, [hash]);
      expect(rows[0].ok).toBe(true);
      const { rows: [i] } = await pool.query(`SELECT state FROM settlement_payout_instructions WHERE id=$1`, [c.instruction_id]);
      expect(i.state).toBe("confirmed");
    });
  });

  // ── destination management ─────────────────────────────────────────────────
  describe("006 — destination management", () => {
    it("register_payout_destination creates an inactive destination", async () => {
      const dest = await makeDestination(randomUUID(), { approved: false, cooled: false });
      const { rows: [d] } = await pool.query(
        `SELECT is_active, approved_at FROM merchant_payout_destinations WHERE id=$1`, [dest]);
      expect(d.is_active).toBe(false);
      expect(d.approved_at).toBeNull();
    });

    it("approve_payout_destination activates it", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner, { approved: false, cooled: false });
      await pool.query(`SELECT * FROM approve_payout_destination($1,'admin','admin')`, [dest]);
      const { rows: [d] } = await pool.query(
        `SELECT is_active, approved_at FROM merchant_payout_destinations WHERE id=$1`, [dest]);
      expect(d.is_active).toBe(true);
      expect(d.approved_at).not.toBeNull();
    });

    it("enforces cooling period for a recently-approved destination", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner, { cooled: false }); // approved at now()
      await pool.query(
        `UPDATE merchant_payout_destinations SET last_modified_at = now() - interval '1 hour' WHERE id=$1`, [dest]);
      const batch = await makeApprovedBatch(partner);
      await expect(pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]))
        .rejects.toThrow(/DESTINATION_COOLING_PERIOD/);
    });
  });

  // ── concurrency ────────────────────────────────────────────────────────────
  describe("006 — concurrent payout instruction creation", () => {
    it("only one of two concurrent creations for the same batch succeeds", async () => {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const batch = await makeApprovedBatch(partner);
      const attempts = await Promise.allSettled([
        pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]),
        pool.query(`SELECT * FROM create_payout_instruction($1,$2,'b')`, [batch, dest]),
      ]);
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    });
  });

  // ── append-only enforcement ────────────────────────────────────────────────
  describe("006 — append-only enforcement", () => {
    async function anAttempt() {
      const partner = randomUUID();
      const dest = await makeDestination(partner);
      const batch = await makeApprovedBatch(partner);
      const { rows: [c] } = await pool.query(`SELECT * FROM create_payout_instruction($1,$2,'a')`, [batch, dest]);
      await pool.query(
        `SELECT * FROM record_payout_submission($1,'a','AT-REF','rh','resp',now()+interval '2 hours')`,
        [c.instruction_id]);
      const { rows: [at] } = await pool.query(
        `SELECT id FROM settlement_payout_attempts WHERE instruction_id=$1 LIMIT 1`, [c.instruction_id]);
      return at.id;
    }

    it("rejects UPDATE on settlement_payout_attempts", async () => {
      const id = await anAttempt();
      await expect(pool.query(`UPDATE settlement_payout_attempts SET status='failed' WHERE id=$1`, [id]))
        .rejects.toThrow(/append-only/);
    });

    it("rejects DELETE on settlement_payout_attempts", async () => {
      const id = await anAttempt();
      await expect(pool.query(`DELETE FROM settlement_payout_attempts WHERE id=$1`, [id]))
        .rejects.toThrow(/append-only/);
    });

    it("rejects UPDATE on settlement_payout_events", async () => {
      const { rows: [e] } = await pool.query(`SELECT id FROM settlement_payout_events LIMIT 1`);
      await expect(pool.query(`UPDATE settlement_payout_events SET actor_id='x' WHERE id=$1`, [e.id]))
        .rejects.toThrow(/append-only/);
    });
  });

  // ── no sensitive data in views ─────────────────────────────────────────────
  describe("006 — no sensitive data in views", () => {
    it("v_payout_instruction_summary exposes no encrypted_destination column", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='v_payout_instruction_summary' AND column_name='encrypted_destination'`);
      expect(rows.length).toBe(0);
    });

    it("settlement_payout_instructions has no decrypted_* columns", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='settlement_payout_instructions' AND column_name LIKE 'decrypted_%'`);
      expect(rows.length).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 007 — Payout Production Hardening
// ─────────────────────────────────────────────────────────────────────────────

describe("007 — payout production hardening", () => {
  // Helper: idempotent 007 application via beforeAll
  beforeAll(async () => {
    await pool.query(readFileSync(MIGRATION_PATH_007, "utf-8"));
  });

  // ── Migration hygiene ────────────────────────────────────────────────────

  describe("007 applies cleanly and is idempotent", () => {
    it("applies twice without error", async () => {
      await expect(
        pool.query(readFileSync(MIGRATION_PATH_007, "utf-8"))
      ).resolves.toBeDefined();
    });

    it("payout_receipt_seq sequence exists", async () => {
      const { rows } = await pool.query(
        `SELECT sequencename FROM pg_sequences WHERE sequencename = 'payout_receipt_seq'`
      );
      expect(rows.length).toBe(1);
    });

    it("v_payout_receipt view exists", async () => {
      const { rows } = await pool.query(
        `SELECT viewname FROM pg_views WHERE viewname = 'v_payout_receipt'`
      );
      expect(rows.length).toBe(1);
    });
  });

  // ── Payment evidence columns ─────────────────────────────────────────────

  describe("007 — settlement_payout_instructions payment evidence columns", () => {
    it("payment_method column was added", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='settlement_payout_instructions' AND column_name='payment_method'`
      );
      expect(rows.length).toBe(1);
    });

    it("payment_date column was added", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='settlement_payout_instructions' AND column_name='payment_date'`
      );
      expect(rows.length).toBe(1);
    });

    it("evidence_note column was added", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='settlement_payout_instructions' AND column_name='evidence_note'`
      );
      expect(rows.length).toBe(1);
    });

    it("confirming_actor column was added", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='settlement_payout_instructions' AND column_name='confirming_actor'`
      );
      expect(rows.length).toBe(1);
    });
  });

  // ── Production audit compatibility for destination helpers ───────────────

  describe("007 — destination helper compatibility with live merchant_audit_log", () => {
    let partnerId: string;
    let destinationId: string;

    beforeAll(async () => {
      const p = await pool.query(
        `INSERT INTO partners(name) VALUES('Destination Helper Partner') RETURNING id`
      );
      partnerId = p.rows[0].id;

      const d = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by)
         VALUES ($1,'bank','Helper Bank','KES','{}','Bank ...4321','test@example.com')
         RETURNING id`,
        [partnerId]
      );
      destinationId = d.rows[0].id;
    });

    it("merchant_audit_log keeps the live production schema after 007", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'merchant_audit_log'`
      );
      const cols = rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain("merchant_user_id");
      expect(cols).toContain("partner_id");
      expect(cols).toContain("action");
      expect(cols).toContain("order_id");
      expect(cols).toContain("metadata");
      expect(cols).not.toContain("actor_id");
      expect(cols).not.toContain("actor_type");
      expect(cols).not.toContain("entity_type");
      expect(cols).not.toContain("entity_id");
      expect(cols).not.toContain("old_values");
      expect(cols).not.toContain("new_values");
    });

    it("verify_payout_destination succeeds without writing to merchant_audit_log", async () => {
      const before = await pool.query(
        `SELECT count(*)::int AS count FROM merchant_audit_log WHERE action = 'destination.verified'`
      );

      const { rows } = await pool.query(
        `SELECT ok FROM verify_payout_destination($1, 'admin-verify', 'admin')`,
        [destinationId]
      );
      expect(rows[0].ok).toBe(true);

      const after = await pool.query(
        `SELECT count(*)::int AS count FROM merchant_audit_log WHERE action = 'destination.verified'`
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);

      const verified = await pool.query(
        `SELECT verified_by, verified_at, last_modified_at, cooling_expires_at
         FROM merchant_payout_destinations WHERE id = $1`,
        [destinationId]
      );
      expect(verified.rows[0].verified_by).toBe("admin-verify");
      expect(verified.rows[0].verified_at).not.toBeNull();
      expect(verified.rows[0].last_modified_at).not.toBeNull();
      expect(verified.rows[0].cooling_expires_at).not.toBeNull();
    });

    it("approve_payout_destination succeeds and maintains 007 approval metadata", async () => {
      const { rows } = await pool.query(
        `SELECT ok FROM approve_payout_destination($1, 'admin-approve', 'admin')`,
        [destinationId]
      );
      expect(rows[0].ok).toBe(true);

      const approved = await pool.query(
        `SELECT approved_by, approved_at, is_approved, is_active, cooling_expires_at
         FROM merchant_payout_destinations WHERE id = $1`,
        [destinationId]
      );
      expect(approved.rows[0].approved_by).toBe("admin-approve");
      expect(approved.rows[0].approved_at).not.toBeNull();
      expect(approved.rows[0].is_approved).toBe(true);
      expect(approved.rows[0].is_active).toBe(true);
      expect(approved.rows[0].cooling_expires_at).not.toBeNull();
    });
  });

  // ── One-active-destination-per-type trigger ───────────────────────────────

  describe("007 — one-active-destination-per-type trigger", () => {
    let partnerId: string;
    let dest1Id: string;
    let dest2Id: string;
    let partnerIdB: string;

    beforeAll(async () => {
      const p = await pool.query(`INSERT INTO partners(name) VALUES('Trigger Test Partner') RETURNING id`);
      partnerId = p.rows[0].id;
      const pb = await pool.query(`INSERT INTO partners(name) VALUES('Trigger Test Partner B') RETURNING id`);
      partnerIdB = pb.rows[0].id;
    });

    it("activating a second destination of same type deactivates the first", async () => {
      // Insert first active destination.
      const r1 = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active, is_approved, approved_at)
         VALUES ($1,'bank','Dest 1','KES','{}','Bank ...1234','test@example.com',true,true,now())
         RETURNING id`,
        [partnerId]
      );
      dest1Id = r1.rows[0].id;

      // Insert second active destination of same type → trigger should deactivate dest1.
      const r2 = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active, is_approved, approved_at)
         VALUES ($1,'bank','Dest 2','KES','{}','Bank ...5678','test@example.com',true,true,now())
         RETURNING id`,
        [partnerId]
      );
      dest2Id = r2.rows[0].id;

      const { rows } = await pool.query(
        `SELECT id, is_active FROM merchant_payout_destinations WHERE id = ANY($1)`,
        [[dest1Id, dest2Id]]
      );
      const map = Object.fromEntries(rows.map((r: {id: string; is_active: boolean}) => [r.id, r.is_active]));
      expect(map[dest1Id]).toBe(false);
      expect(map[dest2Id]).toBe(true);
    });

    it("different destination types for same partner can both be active", async () => {
      const r1 = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active, is_approved, approved_at)
         VALUES ($1,'bank','Bank Dest','KES','{}','Bank ...1111','test@example.com',true,true,now())
         RETURNING id`,
        [partnerId]
      );
      const bankId = r1.rows[0].id;

      const r2 = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active, is_approved, approved_at)
         VALUES ($1,'manual','Manual Dest','KES','{}','Manual desc','test@example.com',true,true,now())
         RETURNING id`,
        [partnerId]
      );
      const manualId = r2.rows[0].id;

      const { rows } = await pool.query(
        `SELECT id, is_active FROM merchant_payout_destinations WHERE id = ANY($1)`,
        [[bankId, manualId]]
      );
      const map = Object.fromEntries(rows.map((r: {id: string; is_active: boolean}) => [r.id, r.is_active]));
      expect(map[bankId]).toBe(true);
      expect(map[manualId]).toBe(true);
    });

    it("same destination type for different partners can both be active", async () => {
      const r1 = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active, is_approved, approved_at)
         VALUES ($1,'bank','Partner A Bank','KES','{}','Bank ...AAAA','test@example.com',true,true,now())
         RETURNING id`,
        [partnerId]
      );

      const r2 = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active, is_approved, approved_at)
         VALUES ($1,'bank','Partner B Bank','KES','{}','Bank ...BBBB','test@example.com',true,true,now())
         RETURNING id`,
        [partnerIdB]
      );

      const { rows } = await pool.query(
        `SELECT is_active FROM merchant_payout_destinations WHERE id = ANY($1)`,
        [[r1.rows[0].id, r2.rows[0].id]]
      );
      expect(rows.every((r: {is_active: boolean}) => r.is_active)).toBe(true);
    });
  });

  // ── record_payout_confirmation 8-param with receipt number ───────────────

  describe("007 — record_payout_confirmation 8-param", () => {
    let partnerId: string;
    let batchId: string;
    let destId: string;
    let instructionId: string;

    beforeAll(async () => {
      const p = await pool.query(
        `INSERT INTO partners(name) VALUES('ConfirmTest Partner') RETURNING id`
      );
      partnerId = p.rows[0].id;

      // Payout destination
      const d = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active,
            is_approved, approved_at, last_modified_at, cooling_expires_at)
         VALUES ($1,'bank','Test Bank','KES','{}','Bank ...0001','test@example.com',true,
                 true,now(),now() - interval '25 hours',now() - interval '1 hour')
         RETURNING id`,
        [partnerId]
      );
      destId = d.rows[0].id;

      // Settlement batch (approved state so instruction can be created)
      const b = await pool.query(
        `INSERT INTO merchant_settlement_batches
           (partner_id, currency, state, total_payable_amount, item_count, idempotency_key, created_by, updated_by, approved_at)
         VALUES ($1,'KES','approved',100.00,1,'confirm-007-' || gen_random_uuid()::text,'test','test',now())
         RETURNING id`,
        [partnerId]
      );
      batchId = b.rows[0].id;

      // Create payout instruction
      const r = await pool.query(`
        SELECT instruction_id FROM create_payout_instruction($1, $2, 'admin-actor')`,
        [batchId, destId]
      );
      instructionId = r.rows[0].instruction_id;

      // Advance to submitted state
      await pool.query(`
        SELECT ok FROM record_payout_submission(
          $1, 'admin-actor', 'MANUAL-SUBMIT-001', 'reqhash', 'reshash',
          now() + interval '2 hours'
        )`,
        [instructionId]
      );
    });

    it("record_payout_confirmation returns receipt_number in RCP-YYMMDD-NNNNNN format", async () => {
      const { rows } = await pool.query(`
        SELECT ok, receipt_number FROM record_payout_confirmation(
          $1, 'admin-actor', 'PAY-REF-001', 100.00, 'KES',
          'bank_transfer', CURRENT_DATE, 'Test evidence note'
        )`,
        [instructionId]
      );
      expect(rows[0].ok).toBe(true);
      expect(rows[0].receipt_number).toMatch(/^RCP-\d{6}-\d{6}$/);
    });

    it("confirmed instruction stores payment_method, payment_date, evidence_note", async () => {
      const { rows } = await pool.query(
        `SELECT payment_method, payment_date, evidence_note, confirming_actor
         FROM settlement_payout_instructions WHERE id = $1`,
        [instructionId]
      );
      expect(rows[0].payment_method).toBe("bank_transfer");
      expect(rows[0].confirming_actor).toBe("admin-actor");
      expect(rows[0].evidence_note).toBe("Test evidence note");
    });

    it("record_payout_confirmation is idempotent on already-confirmed instruction", async () => {
      // Calling again on confirmed instruction should return true (not error).
      const { rows } = await pool.query(`
        SELECT ok, receipt_number FROM record_payout_confirmation(
          $1, 'admin-actor', 'PAY-REF-001', 100.00, 'KES',
          'bank_transfer', CURRENT_DATE, 'Test evidence note'
        )`,
        [instructionId]
      );
      expect(rows[0].ok).toBe(true);
      // receipt_number is returned from the existing event
      expect(rows[0].receipt_number).toMatch(/^RCP-/);
    });
  });

  // ── v_payout_receipt view ────────────────────────────────────────────────

  describe("007 — v_payout_receipt view safety", () => {
    it("v_payout_receipt has no encrypted_destination column", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='v_payout_receipt' AND column_name='encrypted_destination'`
      );
      expect(rows.length).toBe(0);
    });

    it("v_payout_receipt includes receipt_number column", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='v_payout_receipt' AND column_name='receipt_number'`
      );
      expect(rows.length).toBe(1);
    });

    it("confirmed instruction appears in v_payout_receipt", async () => {
      // At least one confirmed instruction must have been created by earlier tests.
      const { rows } = await pool.query(
        `SELECT count(*) AS cnt FROM v_payout_receipt`
      );
      expect(Number(rows[0].cnt)).toBeGreaterThan(0);
    });

    it("unconfirmed instruction does NOT appear in v_payout_receipt", async () => {
      // Create a new instruction and leave it in 'pending' state.
      const p = await pool.query(
        `INSERT INTO partners(name) VALUES('UnconfirmedReceiptPartner') RETURNING id`
      );
      const pid = p.rows[0].id;
      const d = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active,
            is_approved, approved_at, last_modified_at, cooling_expires_at)
         VALUES ($1,'bank','Unconfirmed Dest','KES','{}','Bank ...9999','test@example.com',true,
                 true,now(),now() - interval '25 hours',now() - interval '1 hour')
         RETURNING id`,
        [pid]
      );
      const b = await pool.query(
        `INSERT INTO merchant_settlement_batches
           (partner_id, currency, state, total_payable_amount, item_count, idempotency_key, created_by, updated_by, approved_at)
         VALUES ($1,'KES','approved',50.00,1,'receipt-pending-007-' || gen_random_uuid()::text,'test','test',now())
         RETURNING id`,
        [pid]
      );
      const r = await pool.query(
        `SELECT instruction_id FROM create_payout_instruction($1,$2,'actor')`,
        [b.rows[0].id, d.rows[0].id]
      );
      const pendingInstrId = r.rows[0].instruction_id;

      const { rows } = await pool.query(
        `SELECT instruction_id FROM v_payout_receipt WHERE instruction_id = $1`,
        [pendingInstrId]
      );
      expect(rows.length).toBe(0);
    });
  });

  // ── M-Pesa and Celo disabled in DB ──────────────────────────────────────

  describe("007 — M-Pesa and Celo disabled in DB", () => {
    it("mpesa_b2c provider has is_enabled = false", async () => {
      const { rows } = await pool.query(
        `SELECT is_enabled FROM payout_provider_config WHERE provider_name = 'mpesa_b2c'`
      );
      expect(rows[0].is_enabled).toBe(false);
    });

    it("celo provider has is_enabled = false", async () => {
      const { rows } = await pool.query(
        `SELECT is_enabled FROM payout_provider_config WHERE provider_name = 'celo'`
      );
      expect(rows[0].is_enabled).toBe(false);
    });

    it("manual provider has is_enabled = true", async () => {
      const { rows } = await pool.query(
        `SELECT is_enabled FROM payout_provider_config WHERE provider_name = 'manual'`
      );
      expect(rows[0].is_enabled).toBe(true);
    });
  });

  // ── Dual-approver constraint (DB level) ──────────────────────────────────

  describe("007 — dual-approver self-approval rejection", () => {
    it("provide_secondary_approval raises CANNOT_SELF_APPROVE when actor == initiated_by", async () => {
      const p = await pool.query(
        `INSERT INTO partners(name) VALUES('DualApprovePartner') RETURNING id`
      );
      const pid = p.rows[0].id;
      const d = await pool.query(
        `INSERT INTO merchant_payout_destinations
           (partner_id, destination_type, display_name, currency,
            encrypted_destination, destination_summary, created_by, is_active,
            is_approved, approved_at, last_modified_at, cooling_expires_at)
         VALUES ($1,'bank','Dual Bank','KES','{}','Bank ...2222','test@example.com',true,
                 true,now(),now() - interval '25 hours',now() - interval '1 hour')
         RETURNING id`,
        [pid]
      );
      const b = await pool.query(
        `INSERT INTO merchant_settlement_batches
           (partner_id, currency, state, total_payable_amount, item_count, idempotency_key, created_by, updated_by, approved_at)
         VALUES ($1,'KES','approved',5000.00,1,'dual-approve-007-' || gen_random_uuid()::text,'test','test',now())
         RETURNING id`,
        [pid]
      );
      const r = await pool.query(
        `SELECT instruction_id FROM create_payout_instruction($1,$2,'initiator-007')`,
        [b.rows[0].id, d.rows[0].id]
      );
      const instrId = r.rows[0].instruction_id;

      // Same actor trying to provide secondary approval should raise CANNOT_SELF_APPROVE.
      await expect(
        pool.query(
          `SELECT ok FROM provide_secondary_approval($1, 'initiator-007')`,
          [instrId]
        )
      ).rejects.toThrow(/CANNOT_SELF_APPROVE/);
    });
  });

  // ── Append-only events still enforced after 007 ──────────────────────────

  describe("007 — append-only enforcement still active", () => {
    it("UPDATE on settlement_payout_events raises an exception", async () => {
      const { rows } = await pool.query(
        `SELECT id FROM settlement_payout_events LIMIT 1`
      );
      if (rows.length === 0) return; // no events yet in this test run; skip

      await expect(
        pool.query(
          `UPDATE settlement_payout_events SET actor_id = 'TAMPERED' WHERE id = $1`,
          [rows[0].id]
        )
      ).rejects.toThrow();
    });

    it("DELETE on settlement_payout_attempts raises an exception", async () => {
      const { rows } = await pool.query(
        `SELECT id FROM settlement_payout_attempts LIMIT 1`
      );
      if (rows.length === 0) return;

      await expect(
        pool.query(
          `DELETE FROM settlement_payout_attempts WHERE id = $1`,
          [rows[0].id]
        )
      ).rejects.toThrow();
    });
  });

  // ── Receipt number uniqueness ────────────────────────────────────────────

  describe("007 — receipt numbers are unique", () => {
    it("two confirmation events produce different receipt numbers", async () => {
      // Create two separate complete lifecycles and compare receipt numbers.
      async function buildConfirmedInstruction(suffix: string) {
        const p = await pool.query(
          `INSERT INTO partners(name) VALUES($1) RETURNING id`,
          [`ReceiptUniq-${suffix}`]
        );
        const pid = p.rows[0].id;
        const d = await pool.query(
          `INSERT INTO merchant_payout_destinations
             (partner_id, destination_type, display_name, currency,
              encrypted_destination, destination_summary, created_by, is_active,
              is_approved, approved_at, last_modified_at, cooling_expires_at)
           VALUES ($1,'bank','Bank ${suffix}','KES','{}','Bank ...${suffix}','test@example.com',true,
                   true,now(),now() - interval '25 hours',now() - interval '1 hour')
           RETURNING id`,
          [pid]
        );
        const b = await pool.query(
          `INSERT INTO merchant_settlement_batches
             (partner_id, currency, state, total_payable_amount, item_count, idempotency_key, created_by, updated_by, approved_at)
           VALUES ($1,'KES','approved',10.00,1,'receipt-uniq-007-' || gen_random_uuid()::text,'test','test',now())
           RETURNING id`,
          [pid]
        );
        const r = await pool.query(
          `SELECT instruction_id FROM create_payout_instruction($1,$2,'actor')`,
          [b.rows[0].id, d.rows[0].id]
        );
        const instrId = r.rows[0].instruction_id;
        await pool.query(
          `SELECT ok FROM record_payout_submission($1,'actor','REF-${suffix}','rh','rsh',now()+interval '2h')`,
          [instrId]
        );
        const c = await pool.query(
          `SELECT receipt_number FROM record_payout_confirmation(
             $1,'actor','REF-${suffix}',10.00,'KES','bank_transfer',CURRENT_DATE,'Note ${suffix}'
           )`,
          [instrId]
        );
        return c.rows[0].receipt_number as string;
      }

      const [r1, r2] = await Promise.all([
        buildConfirmedInstruction("A"),
        buildConfirmedInstruction("B"),
      ]);
      expect(r1).toMatch(/^RCP-/);
      expect(r2).toMatch(/^RCP-/);
      expect(r1).not.toBe(r2);
    });
  });
});
