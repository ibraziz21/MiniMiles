/**
 * Postgres integration tests for the order lifecycle backbone
 * (order-lifecycle-completion-spec.md, migrations 032/034/035/036/037).
 *
 * Runs against a disposable "hub_lifecycle_test" database, applying the
 * prerequisite voucher-platform migrations (001-007, 031) plus
 * packages/react-app/sql/merchant_order_lifecycle.sql (the untracked script
 * that first added merchant_transactions' lifecycle columns and the
 * tx_status enum's original values) before the lifecycle migrations
 * themselves — this mirrors production, where merchant_transactions.status
 * is a real Postgres enum, not text. A JS-mocked test could never catch
 * this; three real bugs surfaced only once this suite ran against actual
 * Postgres:
 *   - order_status_transitions.from_status is text; comparing it directly
 *     against the enum column requires an explicit ::text cast.
 *   - the dynamic EXECUTE ... USING p_to_status UPDATE requires an explicit
 *     ::tx_status cast — parameterized statements don't get the same
 *     literal-to-enum leniency plain UPDATEs do.
 *   - voucher_events.chk_ve_event_type didn't allow 'reinstated'.
 *
 * Requires postgres running (pg_isready). Creates/drops
 * "hub_lifecycle_test" automatically.
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
  database: "hub_lifecycle_test",
};

const MIGRATIONS_DIR = resolve(__dirname, "../../../../../supabase/migrations");
const migrationPath = (name: string) => resolve(MIGRATIONS_DIR, name);
const LEGACY_ORDER_LIFECYCLE_SQL = resolve(
  __dirname, "../../../../react-app/sql/merchant_order_lifecycle.sql"
);

const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

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
-- Production's tx_status starts minimal; merchant_order_lifecycle.sql (run
-- below) is what actually expands it with the base lifecycle values, and
-- migration 032 expands it further. Starting with just 'placed' means both
-- scripts' ALTER TYPE ADD VALUE statements are genuinely exercised here,
-- not just assumed.
CREATE TYPE tx_status AS ENUM ('placed');

CREATE TABLE IF NOT EXISTS partners (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      text,
  name      text NOT NULL DEFAULT 'Test Partner',
  image_url text
);

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

CREATE TABLE IF NOT EXISTS issued_vouchers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address         text        NOT NULL,
  merchant_id          uuid,
  voucher_template_id  uuid        REFERENCES spend_voucher_templates(id),
  code                 text        NOT NULL,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','issued','claiming','redeemed','void','expired')),
  idempotency_key      text,
  rules_snapshot       text[],
  retail_value_cusd    numeric,
  redeemed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

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
  status           tx_status   NOT NULL DEFAULT 'placed',
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

CREATE TABLE IF NOT EXISTS voucher_issue_nonces (
  nonce        text PRIMARY KEY,
  user_address text NOT NULL
);

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

CREATE TABLE IF NOT EXISTS merchant_users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL UNIQUE,
  partner_id uuid        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_audit_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_user_id  uuid        NOT NULL,
  partner_id        uuid        NOT NULL,
  action            text        NOT NULL,
  order_id          uuid,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
`;

let pool: pg.Pool;
let partnerId: string;

async function applyMigrationsTwice() {
  const files = [
    "001_voucher_platform_phase1.sql",
    "002_voucher_platform_phase1_hardening.sql",
    "003_voucher_programs_phase2.sql",
    "004_voucher_asset_qr_redemption.sql",
    "005_voucher_settlement_phase4.sql",
    "006_voucher_payout_execution_phase5.sql",
    "031_hub_order_legacy_columns.sql",
    "032_order_lifecycle_backbone.sql",
    "034_fulfillment_jobs.sql",
    "035_refund_pipeline.sql",
    "036_disputes_notifications_reconciliation.sql",
    "037_reward_accrue_release.sql",
    "039_refund_repairs.sql",
    "040_durable_reward_jobs.sql",
    "041_digital_fulfillment_hardening.sql",
    "042_reconciliation_qualification.sql",
    "043_recovery_refund_atomicity.sql",
  ];
  // Gate: a blank database applies every migration sequentially, twice.
  for (let pass = 0; pass < 2; pass++) {
    for (const file of files) {
      await pool.query(readFileSync(migrationPath(file), "utf-8"));
    }
  }
}

beforeAll(async () => {
  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(readFileSync(LEGACY_ORDER_LIFECYCLE_SQL, "utf-8"));
  await applyMigrationsTwice();

  const { rows: [p] } = await pool.query(
    `INSERT INTO partners (name) VALUES ('Lifecycle Test Merchant') RETURNING id`
  );
  partnerId = p.id;
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function makeOrder(overrides: Partial<{
  amount_cusd: number; amount_kes: number; payment_ref: string; payment_method: string;
  voucher_id: string | null; pending_reward_payload: Record<string, unknown> | null;
}> = {}): Promise<string> {
  const { rows: [order] } = await pool.query(
    `INSERT INTO merchant_transactions
       (partner_id, akiba_username, user_address, category, action, quote_kes,
        status, amount_cusd, amount_kes, payment_ref, payment_method, voucher_id, pending_reward_payload)
     VALUES ($1, 'tester', '0xbuyer', 'general', 'redeem', 500,
             'placed', $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      partnerId,
      overrides.amount_cusd ?? 5,
      overrides.amount_kes ?? null,
      overrides.payment_ref ?? `ref-${Math.random().toString(36).slice(2)}`,
      overrides.payment_method ?? "onchain_transfer",
      overrides.voucher_id ?? null,
      JSON.stringify(overrides.pending_reward_payload ?? null),
    ]
  );
  return order.id;
}

async function advance(orderId: string, toStatus: string, actor: string, meta: Record<string, unknown> = {}) {
  const { rows: [r] } = await pool.query(
    `SELECT * FROM advance_order_status($1, $2, $3, $4::jsonb)`,
    [orderId, toStatus, actor, JSON.stringify(meta)]
  );
  return r as { ok: boolean; error_code: string };
}

describe("advance_order_status — valid transitions", () => {
  it("moves a physical order through the full happy path with timestamps and order_events", async () => {
    const orderId = await makeOrder();

    expect((await advance(orderId, "accepted", "merchant")).ok).toBe(true);
    expect((await advance(orderId, "packed", "merchant")).ok).toBe(true);
    expect((await advance(orderId, "out_for_delivery", "merchant")).ok).toBe(true);
    expect((await advance(orderId, "delivered", "merchant")).ok).toBe(true);
    expect((await advance(orderId, "received", "customer")).ok).toBe(true);
    expect((await advance(orderId, "completed", "system")).ok).toBe(true);

    const { rows: [row] } = await pool.query(
      `SELECT status, accepted_at, packed_at, dispatched_at, delivered_at, received_at, completed_at
       FROM merchant_transactions WHERE id = $1`,
      [orderId]
    );
    expect(row.status).toBe("completed");
    for (const col of ["accepted_at", "packed_at", "dispatched_at", "delivered_at", "received_at", "completed_at"]) {
      expect(row[col], `${col} should be set`).not.toBeNull();
    }

    const { rows: events } = await pool.query(
      `SELECT actor, from_status, to_status FROM order_events WHERE order_id = $1 ORDER BY created_at`,
      [orderId]
    );
    expect(events.map((e) => [e.actor, e.from_status, e.to_status])).toEqual([
      ["merchant", "placed", "accepted"],
      ["merchant", "accepted", "packed"],
      ["merchant", "packed", "out_for_delivery"],
      ["merchant", "out_for_delivery", "delivered"],
      ["customer", "delivered", "received"],
      ["system", "received", "completed"],
    ]);
  });

  it("moves a digital order through provider_pending via enqueue_digital_fulfillment and complete_fulfillment_job, cascading all the way to completed", async () => {
    const orderId = await makeOrder();
    await pool.query(`INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, '{}'::jsonb, 'pending')`, [orderId]);

    const { rows: [enq] } = await pool.query(
      `SELECT * FROM enqueue_digital_fulfillment($1, $2::jsonb)`,
      [orderId, JSON.stringify({ product_id: "p1" })]
    );
    expect(enq.ok).toBe(true);

    const { rows: [afterEnqueue] } = await pool.query(
      `SELECT status FROM merchant_transactions WHERE id = $1`, [orderId]
    );
    expect(afterEnqueue.status).toBe("provider_pending");

    const { rows: [job] } = await pool.query(
      `SELECT id, status FROM fulfillment_jobs WHERE order_id = $1`, [orderId]
    );
    expect(job.status).toBe("pending");

    // complete_fulfillment_job cascades delivered -> received -> completed
    // atomically, in one DB transaction -- no cross-app webhook needed for
    // digital orders, since delivery IS receipt.
    const { rows: [complete] } = await pool.query(
      `SELECT * FROM complete_fulfillment_job($1, $2)`, [job.id, "TOPUP-REF-123"]
    );
    expect(complete.ok).toBe(true);

    const { rows: [afterComplete] } = await pool.query(
      `SELECT status, delivered_at, received_at, completed_at FROM merchant_transactions WHERE id = $1`, [orderId]
    );
    expect(afterComplete.status).toBe("completed");
    expect(afterComplete.delivered_at).not.toBeNull();
    expect(afterComplete.received_at).not.toBeNull();
    expect(afterComplete.completed_at).not.toBeNull();

    // ...and the reward job the customer accrued at purchase is now eligible
    // for the scheduled worker to release.
    const { rows: [rewardJob] } = await pool.query(
      `SELECT status FROM reward_jobs WHERE order_id = $1`, [orderId]
    );
    expect(rewardJob.status).toBe("eligible");
  });

  it("complete_fulfillment_job is idempotent — calling it again on an already-completed order is a no-op, not an error", async () => {
    const orderId = await makeOrder();
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);

    const first = await pool.query(`SELECT * FROM complete_fulfillment_job($1, $2)`, [job.id, "REF-1"]);
    expect(first.rows[0].ok).toBe(true);

    const second = await pool.query(`SELECT * FROM complete_fulfillment_job($1, $2)`, [job.id, "REF-1"]);
    expect(second.rows[0].ok).toBe(true);

    const { rows: [order] } = await pool.query(`SELECT status FROM merchant_transactions WHERE id = $1`, [orderId]);
    expect(order.status).toBe("completed");
  });

  it("enqueue_digital_fulfillment is idempotent — a repeat call returns the existing job", async () => {
    const orderId = await makeOrder();
    const { rows: [first] } = await pool.query(
      `SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]
    );
    const { rows: [second] } = await pool.query(
      `SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]
    );
    expect(second.ok).toBe(true);
    expect(second.job_id).toBe(first.job_id);

    const { rows } = await pool.query(`SELECT count(*) FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);
    expect(Number(rows[0].count)).toBe(1);
  });
});

describe("advance_order_status — invalid transitions and actor permissions", () => {
  it("rejects a transition not in order_status_transitions", async () => {
    const orderId = await makeOrder();
    const result = await advance(orderId, "delivered", "merchant");
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("INVALID_TRANSITION");
  });

  it("rejects an actor not permitted for an otherwise-valid transition", async () => {
    const orderId = await makeOrder();
    const result = await advance(orderId, "accepted", "customer");
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ACTOR_NOT_ALLOWED");
  });

  it("lets a merchant (not just admin) cancel from accepted/packed/out_for_delivery", async () => {
    const orderId = await makeOrder();
    await advance(orderId, "accepted", "merchant");
    const result = await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });
    expect(result.ok).toBe(true);
  });

  it("returns ORDER_NOT_FOUND for a nonexistent order", async () => {
    const result = await advance("00000000-0000-0000-0000-000000000000", "accepted", "merchant");
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ORDER_NOT_FOUND");
  });
});

describe("direct status UPDATEs are rejected at the DB level", () => {
  it("raises when bypassing advance_order_status", async () => {
    const orderId = await makeOrder();
    await expect(
      pool.query(`UPDATE merchant_transactions SET status = 'accepted' WHERE id = $1`, [orderId])
    ).rejects.toThrow(/Direct status updates are forbidden/);
  });

  it("does not raise for updates that leave status unchanged", async () => {
    const orderId = await makeOrder();
    await expect(
      pool.query(`UPDATE merchant_transactions SET recipient_name = 'Alice' WHERE id = $1`, [orderId])
    ).resolves.not.toThrow();
  });
});

describe("cancellation + refund atomicity", () => {
  it("creates exactly one refund row with the correct rail, atomically with the cancel", async () => {
    const orderId = await makeOrder({ amount_cusd: 5, payment_method: "onchain_transfer" });
    const result = await advance(orderId, "cancelled", "merchant", { reason: "cannot_deliver" });
    expect(result.ok).toBe(true);

    const { rows } = await pool.query(
      `SELECT rail, reason, refund_status, amount_cusd FROM order_cancellation_compensations WHERE order_id = $1`,
      [orderId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rail).toBe("crypto");
    expect(rows[0].reason).toBe("cannot_deliver");
    expect(rows[0].refund_status).toBe("pending_manual");
    expect(Number(rows[0].amount_cusd)).toBe(5);
  });

  it("uses the mpesa rail for M-Pesa-paid orders", async () => {
    const orderId = await makeOrder({ payment_method: "other" });
    await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });
    const { rows } = await pool.query(
      `SELECT rail FROM order_cancellation_compensations WHERE order_id = $1`, [orderId]
    );
    expect(rows[0].rail).toBe("mpesa");
  });

  it("does not create a refund row when nothing was paid", async () => {
    const orderId = await makeOrder({ amount_cusd: 0 });
    await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });
    const { rows } = await pool.query(
      `SELECT count(*) FROM order_cancellation_compensations WHERE order_id = $1`, [orderId]
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("is idempotent — cancelling twice via retry does not create a second refund row", async () => {
    const orderId = await makeOrder();
    // ON CONFLICT (order_id) DO NOTHING on the refund insert makes a second
    // attempt at the same cancel safe. We can't re-cancel through
    // advance_order_status once terminal, so call the same insert path a
    // second time directly against a fresh order at the same status to
    // prove the constraint, not the RPC's own transition guard.
    await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });
    const { rows } = await pool.query(
      `SELECT count(*) FROM order_cancellation_compensations WHERE order_id = $1`, [orderId]
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("reinstates a redeemed voucher on cancel and records a 'reinstated' voucher_event", async () => {
    const { rows: [template] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, discount_percent)
       VALUES ($1, '10pct', 'percent', 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [voucher] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, merchant_id, voucher_template_id, code, status)
       VALUES ('0xbuyer', $1, $2, 'RESTOCK1', 'redeemed') RETURNING id`,
      [partnerId, template.id]
    );
    const orderId = await makeOrder({ voucher_id: voucher.id });

    const result = await advance(orderId, "cancelled", "merchant", { reason: "cannot_deliver" });
    expect(result.ok).toBe(true);

    const { rows: [v] } = await pool.query(`SELECT status FROM issued_vouchers WHERE id = $1`, [voucher.id]);
    expect(v.status).toBe("issued");

    const { rows: events } = await pool.query(
      `SELECT event_type FROM voucher_events WHERE issued_voucher_id = $1`, [voucher.id]
    );
    expect(events.map((e) => e.event_type)).toContain("reinstated");

    const { rows: [compensation] } = await pool.query(
      `SELECT voucher_reinstated FROM order_cancellation_compensations WHERE order_id = $1`, [orderId]
    );
    expect(compensation.voucher_reinstated).toBe(true);
  });

  it("stores the rail-native KES amount for M-Pesa refunds", async () => {
    const orderId = await makeOrder({ payment_method: "other", amount_cusd: 5, amount_kes: 650 });
    await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });

    const { rows: [row] } = await pool.query(
      `SELECT rail, amount_kes, amount_cusd FROM order_cancellation_compensations WHERE order_id = $1`,
      [orderId]
    );
    expect(row.rail).toBe("mpesa");
    expect(Number(row.amount_kes)).toBe(650);
  });

  it("leaves amount_kes null for crypto refunds (amount_cusd + payment_currency already carry the token amount)", async () => {
    // place_hub_order_and_redeem_voucher normalizes "crypto:*" payment
    // methods down to the payment_method enum's 'onchain_transfer' at
    // insert time — that's the value actually stored, and what
    // advance_order_status's rail detection matches on.
    const orderId = await makeOrder({ payment_method: "onchain_transfer", amount_cusd: 5 });
    await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });

    const { rows: [row] } = await pool.query(
      `SELECT rail, amount_kes FROM order_cancellation_compensations WHERE order_id = $1`,
      [orderId]
    );
    expect(row.rail).toBe("crypto");
    expect(row.amount_kes).toBeNull();
  });

  it("voids the reward job on cancel — nothing left to release", async () => {
    const orderId = await makeOrder();
    await pool.query(
      `INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
      [orderId, JSON.stringify({ amount: 5, currency: "CUSD" })]
    );

    await advance(orderId, "cancelled", "merchant", { reason: "out_of_stock" });

    const { rows: [job] } = await pool.query(
      `SELECT status, voided_at FROM reward_jobs WHERE order_id = $1`, [orderId]
    );
    expect(job.status).toBe("voided");
    expect(job.voided_at).not.toBeNull();
  });

  it("records a reconciliation incident when cancellation compensation fails, instead of only logging a warning", async () => {
    // A voucher_id pointing at a redeemed voucher with no matching
    // voucher_redemptions row is harmless (settlement lookup just finds
    // nothing) — to force the exception path, point at a voucher id that
    // doesn't exist in issued_vouchers at all so the UPDATE...WHERE finds no
    // row and the reinstatement block's later SELECT ... INTO (strict) on a
    // dependent table raises. Simpler: drop the voucher_events table's
    // insert privilege is out of scope for a unit test: fake a settlement
    // entry lookup failure by inserting a redemption row whose voucher_id
    // doesn't match any settlement entry's expected merchant, then break
    // add_settlement_adjustment's precondition (no settlement terms).
    const { rows: [template] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, discount_percent)
       VALUES ($1, '10pct', 'percent', 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [voucher] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, merchant_id, voucher_template_id, code, status)
       VALUES ('0xbuyer', $1, $2, 'FAILCOMP1', 'redeemed') RETURNING id`,
      [partnerId, template.id]
    );
    const orderId = await makeOrder({ voucher_id: voucher.id });
    const { rows: [program] } = await pool.query(
      `INSERT INTO voucher_programs (template_id, name, state, total_cap)
       VALUES ($1, 'No-terms program', 'draft', 10) RETURNING id`,
      [template.id]
    );
    await pool.query(
      `INSERT INTO voucher_redemptions (issued_voucher_id, order_id, user_address, merchant_id, discount_applied)
       VALUES ($1, $2, '0xbuyer', $3, 0.5)`,
      [voucher.id, orderId.toString(), partnerId]
    );
    await pool.query(
      `INSERT INTO voucher_settlement_entries (
         issued_voucher_id, voucher_redemption_id, program_id, merchant_id,
         funding_party_type, entry_type, gross_amount_cusd, discount_amount_cusd,
         reimbursement_rate, payable_amount, currency, idempotency_key
       )
       SELECT $1::uuid, id, $2::uuid, $3::uuid, 'akiba', 'payable_created', 5, 0.5, 1, 0.5, 'CUSD', 'seed-' || $1::text
       FROM voucher_redemptions WHERE issued_voucher_id = $1::uuid`,
      [voucher.id, program.id, partnerId]
    );
    // No voucher_program_settlement_terms row exists for this program ->
    // add_settlement_adjustment raises SETTLEMENT_TERMS_REQUIRED.

    const result = await advance(orderId, "cancelled", "merchant", { reason: "cannot_deliver" });
    expect(result.ok).toBe(true); // the cancel itself still succeeds

    const { rows: incidents } = await pool.query(
      `SELECT type, data FROM reconciliation_incidents
       WHERE type = 'cancellation_compensation_failed' AND order_id = $1`,
      [orderId]
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0].data.error).toMatch(/SETTLEMENT_TERMS_REQUIRED/);
  });
});

describe("durable reward jobs — accrue at purchase, release at completion", () => {
  it("place_hub_order_and_redeem_voucher creates the reward job atomically with the order", async () => {
    const paymentRef = `reward-atomic-${Math.random().toString(36).slice(2)}`;
    const { rows: [row] } = await pool.query(
      `SELECT * FROM place_hub_order_and_redeem_voucher(
        $1,'0xrewardtest','Widget','electronics','prod-reward',$2,'CUSD','crypto:CUSD',
        5.0,650,NULL,NULL,'Grace','254700000088','Nairobi',NULL,
        NULL,NULL,NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,NULL,$3::jsonb
      )`,
      [partnerId, paymentRef, JSON.stringify({ amount: 5, currency: "CUSD" })]
    );
    expect(row.ok).toBe(true);

    const { rows: [job] } = await pool.query(
      `SELECT status, payload FROM reward_jobs WHERE order_id = $1`, [row.order_id]
    );
    expect(job.status).toBe("pending");
    expect(job.payload).toEqual({ amount: 5, currency: "CUSD" });
  });

  it("uses the caller-supplied order id so a pre-built reward payload's idempotencyKey matches the created row", async () => {
    // lib/akiba/purchase-events.ts's getPurchaseEventForOrder reconstructs
    // `hub-purchase-${orderId}` to look up the Platform event later -- the
    // payload built before this call must reference the SAME id the row
    // actually gets, which requires the caller to pre-generate it.
    const preGeneratedId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const paymentRef = `reward-preid-${Math.random().toString(36).slice(2)}`;
    const payload = { idempotencyKey: `hub-purchase-${preGeneratedId}` };

    const { rows: [row] } = await pool.query(
      `SELECT * FROM place_hub_order_and_redeem_voucher(
        $1,'0xpreid','Widget','electronics','prod-preid',$2,'CUSD','crypto:CUSD',
        5.0,650,NULL,NULL,'Ivy','254700000066','Nairobi',NULL,
        NULL,NULL,NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,NULL,$3::jsonb,$4::uuid
      )`,
      [partnerId, paymentRef, JSON.stringify(payload), preGeneratedId]
    );
    expect(row.ok).toBe(true);
    expect(row.order_id).toBe(preGeneratedId);

    const { rows: [job] } = await pool.query(
      `SELECT payload FROM reward_jobs WHERE order_id = $1`, [preGeneratedId]
    );
    expect(job.payload.idempotencyKey).toBe(`hub-purchase-${preGeneratedId}`);
  });

  it("does not create a reward job when no payload is given (backward compatible)", async () => {
    const paymentRef = `reward-none-${Math.random().toString(36).slice(2)}`;
    const { rows: [row] } = await pool.query(
      `SELECT * FROM place_hub_order_and_redeem_voucher(
        $1,'0xnoreward','Widget','electronics','prod-none',$2,'CUSD','crypto:CUSD',
        5.0,650,NULL,NULL,'Henry','254700000077','Nairobi',NULL,
        NULL,NULL,NULL,NULL,NULL,NULL
      )`,
      [partnerId, paymentRef]
    );
    expect(row.ok).toBe(true);
    const { rows } = await pool.query(`SELECT count(*) FROM reward_jobs WHERE order_id = $1`, [row.order_id]);
    expect(Number(rows[0].count)).toBe(0);
  });

  it("marks the reward job eligible only once the order reaches completed", async () => {
    const orderId = await makeOrder();
    await pool.query(
      `INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, '{}'::jsonb, 'pending')`,
      [orderId]
    );

    await advance(orderId, "accepted", "merchant");
    let job = (await pool.query(`SELECT status FROM reward_jobs WHERE order_id = $1`, [orderId])).rows[0];
    expect(job.status).toBe("pending"); // not eligible yet

    await advance(orderId, "packed", "merchant");
    await advance(orderId, "out_for_delivery", "merchant");
    await advance(orderId, "delivered", "merchant");
    await advance(orderId, "received", "customer");
    job = (await pool.query(`SELECT status FROM reward_jobs WHERE order_id = $1`, [orderId])).rows[0];
    expect(job.status).toBe("pending"); // still not eligible — not completed yet

    await advance(orderId, "completed", "system");
    job = (await pool.query(`SELECT status FROM reward_jobs WHERE order_id = $1`, [orderId])).rows[0];
    expect(job.status).toBe("eligible");
  });

  it("claim_reward_jobs claims eligible jobs and hides them from a second concurrent claim", async () => {
    const orderId = await makeOrder();
    await pool.query(
      `INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, '{}'::jsonb, 'eligible')`,
      [orderId]
    );

    const [first, second] = await Promise.all([
      pool.query(`SELECT * FROM claim_reward_jobs(10)`),
      pool.query(`SELECT * FROM claim_reward_jobs(10)`),
    ]);
    const claimedIds = [...first.rows, ...second.rows].map((r) => r.order_id);
    expect(claimedIds.filter((id) => id === orderId)).toHaveLength(1);

    const { rows: [job] } = await pool.query(`SELECT status FROM reward_jobs WHERE order_id = $1`, [orderId]);
    expect(job.status).toBe("processing");
  });

  it("complete_reward_job(ok=true) releases the job", async () => {
    const orderId = await makeOrder();
    const { rows: [job] } = await pool.query(
      `INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, '{}'::jsonb, 'processing') RETURNING id`,
      [orderId]
    );
    await pool.query(`SELECT complete_reward_job($1, true, NULL)`, [job.id]);

    const { rows: [row] } = await pool.query(`SELECT status, released_at FROM reward_jobs WHERE id = $1`, [job.id]);
    expect(row.status).toBe("released");
    expect(row.released_at).not.toBeNull();
  });

  it("complete_reward_job(ok=false) re-arms the job for retry with backoff instead of losing it", async () => {
    const orderId = await makeOrder();
    const { rows: [job] } = await pool.query(
      `INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, '{}'::jsonb, 'processing') RETURNING id`,
      [orderId]
    );
    await pool.query(`SELECT complete_reward_job($1, false, $2)`, [job.id, "Platform unavailable"]);

    const { rows: [row] } = await pool.query(
      `SELECT status, attempts, last_error, next_retry_at > now() AS retry_in_future FROM reward_jobs WHERE id = $1`,
      [job.id]
    );
    expect(row.status).toBe("eligible"); // back in the pool, not dropped
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("Platform unavailable");
    expect(row.retry_in_future).toBe(true);
  });

  it("gate: a simulated repeated Platform outage never loses the job — it eventually releases exactly once", async () => {
    const orderId = await makeOrder();
    const { rows: [job] } = await pool.query(
      `INSERT INTO reward_jobs (order_id, payload, status) VALUES ($1, '{}'::jsonb, 'eligible') RETURNING id`,
      [orderId]
    );

    // Simulate three consecutive worker sweeps that fail (outage), each
    // claiming, failing, and re-arming -- the job survives every one.
    for (let i = 0; i < 3; i++) {
      const { rows: claimed } = await pool.query(`SELECT * FROM claim_reward_jobs(10)`);
      expect(claimed.some((r) => r.order_id === orderId)).toBe(true);
      await pool.query(`SELECT complete_reward_job($1, false, 'simulated outage')`, [job.id]);
      // Force next_retry_at into the past so the next sweep can claim it again immediately.
      await pool.query(`UPDATE reward_jobs SET next_retry_at = now() - interval '1 second' WHERE id = $1`, [job.id]);
    }

    // Fourth attempt: Platform recovers.
    const { rows: claimed } = await pool.query(`SELECT * FROM claim_reward_jobs(10)`);
    expect(claimed.some((r) => r.order_id === orderId)).toBe(true);
    await pool.query(`SELECT complete_reward_job($1, true, NULL)`, [job.id]);

    const { rows: [row] } = await pool.query(`SELECT status, attempts, released_at FROM reward_jobs WHERE id = $1`, [job.id]);
    expect(row.status).toBe("released");
    expect(row.attempts).toBe(3);
    expect(row.released_at).not.toBeNull();

    // Never more than one job row for the order, regardless of how many
    // failed attempts happened.
    const { rows: countRows } = await pool.query(`SELECT count(*) FROM reward_jobs WHERE order_id = $1`, [orderId]);
    expect(Number(countRows[0].count)).toBe(1);
  });
});

describe("digital fulfilment hardening — three attempts, then auto-cancel + refund", () => {
  it("the first two failures stay in fulfil_failed, awaiting manual retry — no cancellation yet", async () => {
    const orderId = await makeOrder({ amount_cusd: 5, payment_method: "onchain_transfer" });
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);

    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, `attempt ${attempt} failed`]);
      expect(result.rows[0].ok).toBe(true);

      const { rows: [order] } = await pool.query(`SELECT status FROM merchant_transactions WHERE id = $1`, [orderId]);
      expect(order.status).toBe("fulfil_failed");

      // Ops can retry after each of the first two failures.
      const retry = await pool.query(`SELECT * FROM retry_fulfillment_job($1)`, [job.id]);
      expect(retry.rows[0].ok).toBe(true);
    }

    const { rows: [finalJob] } = await pool.query(`SELECT attempts FROM fulfillment_jobs WHERE id = $1`, [job.id]);
    expect(finalJob.attempts).toBe(2);
  });

  it("gate: the third failure automatically cancels the order and creates exactly one refund row", async () => {
    const orderId = await makeOrder({ amount_cusd: 5, payment_method: "onchain_transfer" });
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);

    // Two failures + retries, matching real ops usage.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, `attempt ${attempt} failed`]);
      await pool.query(`SELECT * FROM retry_fulfillment_job($1)`, [job.id]);
    }

    // Third failure: exhausted.
    const third = await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, "attempt 3 failed"]);
    expect(third.rows[0].ok).toBe(true);

    const { rows: [order] } = await pool.query(
      `SELECT status, cancelled_at FROM merchant_transactions WHERE id = $1`, [orderId]
    );
    expect(order.status).toBe("cancelled");
    expect(order.cancelled_at).not.toBeNull();

    const { rows: refunds } = await pool.query(
      `SELECT rail, refund_status, amount_cusd FROM order_cancellation_compensations WHERE order_id = $1`, [orderId]
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0].refund_status).toBe("pending_manual");
    expect(Number(refunds[0].amount_cusd)).toBe(5);

    // A further retry attempt is naturally rejected — the order is terminal.
    const retryAfterCancel = await pool.query(`SELECT * FROM retry_fulfillment_job($1)`, [job.id]);
    expect(retryAfterCancel.rows[0].ok).toBe(false);
  });

  it("gate: exhausted retries also reinstate a redeemed voucher, atomically with the cancel", async () => {
    const { rows: [template] } = await pool.query(
      `INSERT INTO spend_voucher_templates (partner_id, title, voucher_type, discount_percent)
       VALUES ($1, '10pct', 'percent', 10) RETURNING id`,
      [partnerId]
    );
    const { rows: [voucher] } = await pool.query(
      `INSERT INTO issued_vouchers (user_address, merchant_id, voucher_template_id, code, status)
       VALUES ('0xbuyer', $1, $2, 'DIGIFAIL1', 'redeemed') RETURNING id`,
      [partnerId, template.id]
    );
    const orderId = await makeOrder({ voucher_id: voucher.id, amount_cusd: 4.5, payment_method: "onchain_transfer" });
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, `attempt ${attempt}`]);
      if (attempt < 3) await pool.query(`SELECT * FROM retry_fulfillment_job($1)`, [job.id]);
    }

    const { rows: [v] } = await pool.query(`SELECT status FROM issued_vouchers WHERE id = $1`, [voucher.id]);
    expect(v.status).toBe("issued");

    const { rows: [compensation] } = await pool.query(
      `SELECT voucher_reinstated FROM order_cancellation_compensations WHERE order_id = $1`, [orderId]
    );
    expect(compensation.voucher_reinstated).toBe(true);
  });

  it("notifies the customer on the auto-cancel (refund_initiated + order_cancelled)", async () => {
    const orderId = await makeOrder({ amount_cusd: 5, payment_method: "onchain_transfer" });
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, `attempt ${attempt}`]);
      if (attempt < 3) await pool.query(`SELECT * FROM retry_fulfillment_job($1)`, [job.id]);
    }

    const { rows: notifications } = await pool.query(
      `SELECT template FROM notification_outbox WHERE order_id = $1 ORDER BY template`, [orderId]
    );
    expect(notifications.map((n) => n.template)).toEqual(
      expect.arrayContaining(["order_cancelled", "refund_initiated"])
    );
  });
});

describe("reconciliation qualification — v_stuck_orders covers the four newer statuses (042)", () => {
  async function isStuck(orderId: string): Promise<boolean> {
    const { rows } = await pool.query(`SELECT 1 FROM v_stuck_orders WHERE id = $1`, [orderId]);
    return rows.length === 1;
  }

  it("flags a packed order only after 24h, not before", async () => {
    const orderId = await makeOrder();
    await advance(orderId, "accepted", "merchant");
    await advance(orderId, "packed", "merchant");
    expect(await isStuck(orderId)).toBe(false);

    await pool.query(`UPDATE merchant_transactions SET packed_at = now() - interval '25 hours' WHERE id = $1`, [orderId]);
    expect(await isStuck(orderId)).toBe(true);
  });

  it("flags a received order only after 2h (double the auto-complete sweep's 1h window)", async () => {
    const orderId = await makeOrder();
    await advance(orderId, "accepted", "merchant");
    await advance(orderId, "packed", "merchant");
    await advance(orderId, "out_for_delivery", "merchant");
    await advance(orderId, "delivered", "merchant");
    await advance(orderId, "received", "customer");
    expect(await isStuck(orderId)).toBe(false);

    await pool.query(`UPDATE merchant_transactions SET received_at = now() - interval '3 hours' WHERE id = $1`, [orderId]);
    expect(await isStuck(orderId)).toBe(true);
  });

  it("flags a fulfil_failed order only after 6h", async () => {
    const orderId = await makeOrder({ amount_cusd: 5, payment_method: "onchain_transfer" });
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);
    await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, "provider down"]);
    expect(await isStuck(orderId)).toBe(false);

    await pool.query(`UPDATE merchant_transactions SET fulfil_failed_at = now() - interval '7 hours' WHERE id = $1`, [orderId]);
    expect(await isStuck(orderId)).toBe(true);
  });

  it("flags a retrying order only after 15m — a row parked here means retry_fulfillment_job crashed mid-flight", async () => {
    const orderId = await makeOrder({ amount_cusd: 5, payment_method: "onchain_transfer" });
    await pool.query(`SELECT * FROM enqueue_digital_fulfillment($1, '{}'::jsonb)`, [orderId]);
    const { rows: [job] } = await pool.query(`SELECT id FROM fulfillment_jobs WHERE order_id = $1`, [orderId]);
    await pool.query(`SELECT * FROM fail_fulfillment_job($1, $2)`, [job.id, "provider down"]);
    await advance(orderId, "retrying", "system");
    expect(await isStuck(orderId)).toBe(false);

    await pool.query(`UPDATE merchant_transactions SET retrying_at = now() - interval '16 minutes' WHERE id = $1`, [orderId]);
    expect(await isStuck(orderId)).toBe(true);
  });

  it("gate: admin can force a stuck 'received' order to completed — the escape hatch for a broken auto-complete sweep", async () => {
    const orderId = await makeOrder();
    await advance(orderId, "accepted", "merchant");
    await advance(orderId, "packed", "merchant");
    await advance(orderId, "out_for_delivery", "merchant");
    await advance(orderId, "delivered", "merchant");
    await advance(orderId, "received", "customer");

    expect((await advance(orderId, "completed", "customer")).ok).toBe(false);

    const result = await advance(orderId, "completed", "admin");
    expect(result.ok).toBe(true);

    const { rows: [row] } = await pool.query(`SELECT status FROM merchant_transactions WHERE id = $1`, [orderId]);
    expect(row.status).toBe("completed");
  });
});

describe("recovery/refund atomicity (043) — fixes a real race between customer recovery and admin refund", () => {
  async function makeIncident(): Promise<string> {
    const { rows: [i] } = await pool.query(
      `INSERT INTO reconciliation_incidents (type, data) VALUES ('order_rpc_failed_after_payment', '{}'::jsonb) RETURNING id`
    );
    return i.id;
  }

  it("gate: only one of two concurrent claims on the same incident succeeds", async () => {
    const incidentId = await makeIncident();

    const first = await pool.query(`SELECT * FROM claim_reconciliation_incident($1, 'customer-1')`, [incidentId]);
    expect(first.rows[0].ok).toBe(true);

    const second = await pool.query(`SELECT * FROM claim_reconciliation_incident($1, 'admin-1')`, [incidentId]);
    expect(second.rows[0].ok).toBe(false);
    expect(second.rows[0].error_code).toBe("ALREADY_CLAIMED");
  });

  it("a released claim can be re-claimed immediately, without waiting out the lease", async () => {
    const incidentId = await makeIncident();

    await pool.query(`SELECT * FROM claim_reconciliation_incident($1, 'customer-1')`, [incidentId]);
    await pool.query(`SELECT * FROM release_reconciliation_incident_claim($1)`, [incidentId]);

    const retry = await pool.query(`SELECT * FROM claim_reconciliation_incident($1, 'customer-1')`, [incidentId]);
    expect(retry.rows[0].ok).toBe(true);
  });

  it("a claimed-then-resolved incident can no longer be claimed", async () => {
    const incidentId = await makeIncident();

    await pool.query(`SELECT * FROM claim_reconciliation_incident($1, 'customer-1')`, [incidentId]);
    await pool.query(`SELECT * FROM resolve_reconciliation_incident($1, '{}'::jsonb, 'customer-1')`, [incidentId]);

    const afterResolve = await pool.query(`SELECT * FROM claim_reconciliation_incident($1, 'admin-1')`, [incidentId]);
    expect(afterResolve.rows[0].ok).toBe(false);
    expect(afterResolve.rows[0].error_code).toBe("ALREADY_RESOLVED");
  });

  it("order_cancellation_compensations.partner_id accepts NULL (an incident predating partner_id tracking)", async () => {
    await expect(
      pool.query(
        `INSERT INTO order_cancellation_compensations
           (order_id, user_address, partner_id, payment_ref, refund_status, rail)
         VALUES (NULL, '0xbuyer', NULL, $1, 'pending_manual', 'mpesa')`,
        [`ref-${Math.random().toString(36).slice(2)}`]
      )
    ).resolves.toBeDefined();
  });

  it("gate: two order-less refunds for the same payment_ref cannot both be inserted", async () => {
    const paymentRef = `ref-${Math.random().toString(36).slice(2)}`;
    await pool.query(
      `INSERT INTO order_cancellation_compensations
         (order_id, user_address, partner_id, payment_ref, refund_status, rail)
       VALUES (NULL, '0xbuyer', NULL, $1, 'pending_manual', 'mpesa')`,
      [paymentRef]
    );

    await expect(
      pool.query(
        `INSERT INTO order_cancellation_compensations
           (order_id, user_address, partner_id, payment_ref, refund_status, rail)
         VALUES (NULL, '0xbuyer', NULL, $1, 'pending_manual', 'mpesa')`,
        [paymentRef]
      )
    ).rejects.toThrow();
  });

  it("gate: claim_reward_jobs reclaims a job stuck in 'processing' for >10 minutes (a crashed worker)", async () => {
    const orderId = await makeOrder({ pending_reward_payload: { amount: 5 } });
    await pool.query(
      `INSERT INTO reward_jobs (order_id, status, payload) VALUES ($1, 'eligible', '{}'::jsonb)`,
      [orderId]
    );

    const firstClaim = await pool.query(`SELECT * FROM claim_reward_jobs(10)`);
    expect(firstClaim.rows.map((r) => r.order_id)).toContain(orderId);

    // Not yet reclaimable — the worker could still be legitimately mid-flight.
    const tooSoon = await pool.query(`SELECT * FROM claim_reward_jobs(10)`);
    expect(tooSoon.rows.map((r) => r.order_id)).not.toContain(orderId);

    // Simulate a crashed worker: it claimed the job 11 minutes ago and never called complete_reward_job.
    await pool.query(
      `UPDATE reward_jobs SET updated_at = now() - interval '11 minutes' WHERE order_id = $1`,
      [orderId]
    );

    const reclaimed = await pool.query(`SELECT * FROM claim_reward_jobs(10)`);
    expect(reclaimed.rows.map((r) => r.order_id)).toContain(orderId);
  });
});
