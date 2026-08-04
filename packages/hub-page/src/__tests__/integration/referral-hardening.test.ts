import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;
const MIGRATION = resolve(__dirname, "../../../../../supabase/migrations/060_referral_launch_hardening.sql");

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "hub_phase1_test",
};

const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;

CREATE TABLE referral_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL UNIQUE,
  status text NOT NULL, signup_reward_miles integer NOT NULL, activation_reward_miles integer NOT NULL,
  attribution_window_days integer NOT NULL, activation_window_days integer NOT NULL,
  signup_hold_hours integer NOT NULL, activation_hold_hours integer NOT NULL,
  min_purchase_kes numeric NOT NULL, daily_signup_cap integer NOT NULL,
  rolling_30_day_referral_cap integer NOT NULL, total_budget_miles bigint NOT NULL,
  reserved_budget_miles bigint NOT NULL DEFAULT 0, released_budget_miles bigint NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL DEFAULT now(), rules jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE hub_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_version_id uuid NOT NULL REFERENCES referral_program_versions(id),
  referrer_user_id uuid NOT NULL, status text NOT NULL, rejection_reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE referral_reward_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_id uuid NOT NULL REFERENCES hub_referrals(id),
  status text NOT NULL, amount_miles integer NOT NULL, released_at timestamptz, reversed_at timestamptz,
  last_error_code text, last_error_detail text
);
CREATE TABLE hub_user_passes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_user_risk_flags (hub_user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true, flag_type text NOT NULL);
CREATE TABLE voucher_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issued_voucher_id uuid, hub_user_id uuid, user_address text,
  merchant_id uuid, discount_applied numeric, redemption_channel text, merchant_user_id uuid,
  external_reference text, redeemed_at timestamptz
);
CREATE TABLE merchant_transactions (id uuid PRIMARY KEY, user_address text);
CREATE TABLE reward_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text);
CREATE TABLE spend_voucher_templates (id uuid PRIMARY KEY, referral_qualifying boolean NOT NULL DEFAULT false);
CREATE TABLE issued_vouchers (
  id uuid PRIMARY KEY, redemption_token_hash text, status text, redemption_token_expires_at timestamptz,
  merchant_id uuid, expires_at timestamptz, rules_snapshot jsonb, hub_user_id uuid, user_address text,
  voucher_template_id uuid, acquisition_source text, redeemed_at timestamptz
);
CREATE TABLE voucher_events (issued_voucher_id uuid, event_type text, actor_id text, metadata jsonb);
CREATE TABLE merchant_audit_log (merchant_user_id uuid, partner_id uuid, action text, metadata jsonb);
CREATE TABLE internal_event_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, idempotency_key text NOT NULL UNIQUE,
  identities jsonb NOT NULL DEFAULT '[]'::jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION referral_flag_enabled(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE FUNCTION resolve_hub_user_id_from_address(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION calculate_voucher_discount(jsonb, numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 0::numeric $$;
CREATE FUNCTION create_voucher_payable(uuid, uuid, numeric, numeric, text, jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
`;

let pool: pg.Pool;

beforeAll(async () => {
  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(readFileSync(MIGRATION, "utf8"));
}, 30_000);

afterAll(async () => {
  await pool.end();
});

describe("referral launch hardening migration (060)", () => {
  it("keeps paused published terms immutable", async () => {
    const { rows: [program] } = await pool.query(`
      INSERT INTO referral_program_versions (
        version,status,signup_reward_miles,activation_reward_miles,attribution_window_days,
        activation_window_days,signup_hold_hours,activation_hold_hours,min_purchase_kes,
        daily_signup_cap,rolling_30_day_referral_cap,total_budget_miles
      ) VALUES (1,'paused',50,100,30,30,24,168,200,3,10,15000) RETURNING id
    `);
    await expect(pool.query(
      `UPDATE referral_program_versions SET signup_reward_miles=999 WHERE id=$1`,
      [program.id],
    )).rejects.toThrow(/immutable once published/);
  });

  it("moves a completed referral to review as soon as reversal is requested without a false budget discrepancy", async () => {
    const { rows: [program] } = await pool.query(`
      INSERT INTO referral_program_versions (
        version,status,signup_reward_miles,activation_reward_miles,attribution_window_days,
        activation_window_days,signup_hold_hours,activation_hold_hours,min_purchase_kes,
        daily_signup_cap,rolling_30_day_referral_cap,total_budget_miles,released_budget_miles
      ) VALUES (2,'active',50,100,30,30,24,168,200,3,10,15000,100) RETURNING id
    `);
    const { rows: [referral] } = await pool.query(
      `INSERT INTO hub_referrals(program_version_id,referrer_user_id,status) VALUES($1,gen_random_uuid(),'complete') RETURNING id`,
      [program.id],
    );
    const { rows: [job] } = await pool.query(
      `INSERT INTO referral_reward_jobs(referral_id,status,amount_miles,released_at) VALUES($1,'released',100,now()) RETURNING id`,
      [referral.id],
    );

    await pool.query(
      `UPDATE referral_reward_jobs SET status='reversal_pending',last_error_detail='order_refunded' WHERE id=$1`,
      [job.id],
    );

    const { rows: [state] } = await pool.query(`SELECT status FROM hub_referrals WHERE id=$1`, [referral.id]);
    expect(state.status).toBe("manual_review");
    const { rows: discrepancies } = await pool.query(
      `SELECT * FROM v_referral_budget_discrepancies WHERE program_version_id=$1`,
      [program.id],
    );
    expect(discrepancies).toHaveLength(0);
  });

  it("reports authoritative invite eligibility including budget and pass age", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    await pool.query(`INSERT INTO hub_user_passes(user_id,created_at) VALUES($1,now()-interval '8 days')`, [userId]);
    const { rows: [result] } = await pool.query(`SELECT * FROM get_referral_invite_eligibility($1)`, [userId]);
    expect(result).toMatchObject({ can_earn: true, reason: null });
    expect(result.remaining_rewarded_referrals).toBeGreaterThan(0);
  });

  it("queues qualification in the same RPC that commits an in-store redemption", async () => {
    const voucherId = "22222222-2222-2222-2222-222222222222";
    const templateId = "33333333-3333-3333-3333-333333333333";
    const partnerId = "44444444-4444-4444-4444-444444444444";
    const merchantUserId = "55555555-5555-5555-5555-555555555555";
    const hubUserId = "66666666-6666-6666-6666-666666666666";
    await pool.query(`INSERT INTO spend_voucher_templates(id,referral_qualifying) VALUES($1,true)`, [templateId]);
    await pool.query(`
      INSERT INTO issued_vouchers(
        id,redemption_token_hash,status,redemption_token_expires_at,merchant_id,rules_snapshot,
        hub_user_id,voucher_template_id,acquisition_source
      ) VALUES($1,'token-hash','issued',now()+interval '5 minutes',$2,'{"title":"Lunch"}',$3,$4,'purchase')
    `, [voucherId, partnerId, hubUserId, templateId]);

    const { rows: [result] } = await pool.query(
      `SELECT * FROM redeem_voucher_in_store_atomic('token-hash',$1,$2,10,NULL,1300)`,
      [partnerId, merchantUserId],
    );
    expect(result.ok).toBe(true);

    const { rows: [job] } = await pool.query(
      `SELECT event_type,metadata FROM internal_event_jobs WHERE idempotency_key=$1`,
      [`refqual:instore:${voucherId}`],
    );
    expect(job.event_type).toBe("referral_activation_candidate");
    expect(job.metadata).toMatchObject({
      referredUserId: hubUserId,
      qualificationType: "voucher_redemption",
      grossAmountKes: 1300,
    });
  });
});
