/**
 * Integration tests for migration 127 (audit fixes).
 *
 *  - native_push_deliveries gains push_token and purpose; a test-push
 *    delivery may have no job, a notification delivery may not.
 *  - Two offer scans running at the same moment can't both send the same
 *    member an alert: the second waits for the first and then sees its
 *    outbox row. Only real concurrent transactions can show this.
 *
 * Requires a local PostgreSQL:
 *   pnpm --filter @akibamiles/hub-page test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_NAME = "hub_push_delivery_tokens_test";
const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const migration = (file: string) =>
  readFileSync(resolve(__dirname, "../../../../../supabase/migrations", file), "utf8");
const MIGRATION_125 = migration("125_saved_place_offers_and_voucher_expiry_push.sql");
const MIGRATION_127 = migration("127_push_delivery_tokens_and_scan_locks.sql");

// The tables 125 and 127 touch, as 036/047/074/086/101 define them (only the
// columns used here), with real foreign keys.
const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
GRANT ALL ON SCHEMA public TO public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE spend_voucher_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid, title text);
CREATE TABLE issued_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid REFERENCES auth.users(id),
  voucher_template_id uuid REFERENCES spend_voucher_templates(id),
  status text NOT NULL DEFAULT 'issued',
  expires_at timestamptz, redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hub_user_saved_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_user_id, merchant_id)
);
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref text NOT NULL,
  hub_user_id uuid REFERENCES auth.users(id),
  template text NOT NULL, category text, deep_link text,
  dedupe_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_push_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notification_outbox(id),
  hub_user_id uuid NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION enqueue_web_push_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_notification_outbox_enqueue_push
  AFTER INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION enqueue_web_push_job();

CREATE TABLE hub_user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text,
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE native_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES web_push_jobs(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES hub_user_devices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'retry', 'gone', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  provider_ticket text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, device_id)
);
`;

// 12:00 Nairobi.
const NOON = "2026-11-10T09:00:00Z";

let pool: pg.Pool;

async function withAdmin<T>(run: (admin: pg.Pool) => Promise<T>): Promise<T> {
  const admin = new Pool({ ...DB_CONFIG, database: "postgres" });
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await pool.query(sql, params)).rows[0] as T;
}

async function device() {
  const { id: user } = await one<{ id: string }>("INSERT INTO auth.users DEFAULT VALUES RETURNING id");
  const { id } = await one<{ id: string }>(
    "INSERT INTO hub_user_devices (hub_user_id, expo_push_token) VALUES ($1, 'ExponentPushToken[a]') RETURNING id",
    [user],
  );
  return { user, device: id };
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  });
  pool = new Pool({ ...DB_CONFIG, max: 4 });
  await pool.query(SETUP_SQL);
  await pool.query(MIGRATION_125);
  // A delivery recorded before 127, to check it survives with the defaults.
  const { user, device: deviceId } = await device();
  const { id: notification } = await one<{ id: string }>(
    "INSERT INTO notification_outbox (user_ref, hub_user_id, template) VALUES ($1::text, $1::uuid, 'miles_earned') RETURNING id",
    [user],
  );
  const { id: job } = await one<{ id: string }>(
    "INSERT INTO web_push_jobs (notification_id, hub_user_id) VALUES ($1, $2) RETURNING id",
    [notification, user],
  );
  await pool.query("INSERT INTO native_push_deliveries (job_id, device_id, status) VALUES ($1, $2, 'accepted')", [job, deviceId]);
  await pool.query(MIGRATION_127);
});

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

describe("migration 127 — push deliveries", () => {
  it("applies twice without error", async () => {
    await pool.query(MIGRATION_127);
  });

  it("keeps earlier deliveries as notifications with no recorded token", async () => {
    const rows = (await pool.query("SELECT purpose, push_token FROM native_push_deliveries")).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toEqual({ purpose: "notification", push_token: null });
  });

  it("records a test push with no job, but never a notification without one", async () => {
    const { device: deviceId } = await device();
    await pool.query(
      `INSERT INTO native_push_deliveries (job_id, device_id, purpose, push_token, status, provider_ticket)
       VALUES (NULL, $1, 'test', 'ExponentPushToken[a]', 'accepted', 'ticket-1')`,
      [deviceId],
    );
    await expect(
      pool.query("INSERT INTO native_push_deliveries (job_id, device_id, status) VALUES (NULL, $1, 'accepted')", [deviceId]),
    ).rejects.toThrow(/chk_native_push_deliveries_job/);
    const { job } = await one<{ job: string }>("SELECT job_id AS job FROM native_push_deliveries WHERE job_id IS NOT NULL LIMIT 1");
    await expect(
      pool.query("INSERT INTO native_push_deliveries (job_id, device_id, purpose) VALUES ($1, $2, 'marketing')", [job, deviceId]),
    ).rejects.toThrow(/chk_native_push_deliveries_purpose/);
  });

  it("removes a device's test deliveries with the device", async () => {
    const { device: deviceId } = await device();
    await pool.query(
      "INSERT INTO native_push_deliveries (job_id, device_id, purpose) VALUES (NULL, $1, 'test')",
      [deviceId],
    );
    await pool.query("DELETE FROM hub_user_devices WHERE id = $1", [deviceId]);
    const { n } = await one<{ n: string }>("SELECT count(*) n FROM native_push_deliveries WHERE device_id = $1", [deviceId]);
    expect(Number(n)).toBe(0);
  });
});

describe("migration 127 — overlapping offer scans", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE notification_outbox, hub_offer_sightings, hub_offer_sighting_sources CASCADE");
  });

  it("send one alert per member even when two scans run at the same moment", async () => {
    const { id: user } = await one<{ id: string }>("INSERT INTO auth.users DEFAULT VALUES RETURNING id");
    const { id: merchant } = await one<{ id: string }>("INSERT INTO partners (name) VALUES ('Kahawa Corner') RETURNING id");
    await pool.query(
      "INSERT INTO hub_user_saved_merchants (hub_user_id, merchant_id, created_at) VALUES ($1, $2, '2026-11-01')",
      [user, merchant],
    );
    const offer = (key: string) =>
      JSON.stringify([{ key, title: "20% off brunch", merchants: [{ id: merchant, name: "Kahawa Corner", slug: "kahawa" }] }]);
    await pool.query("SELECT record_offer_sightings('funded', '[]'::jsonb, $1)", [NOON]);
    await pool.query("SELECT record_offer_sightings('template', '[]'::jsonb, $1)", [NOON]);

    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await first.query("SELECT record_offer_sightings('funded', $1::jsonb, $2)", [offer("funded:a"), NOON]);

      // A different offer, same member, while the first scan hasn't committed.
      await second.query("BEGIN");
      let secondDone = false;
      const secondScan = second
        .query("SELECT record_offer_sightings('template', $1::jsonb, $2)", [offer("template:b"), NOON])
        .then(() => {
          secondDone = true;
        });

      await new Promise((settle) => setTimeout(settle, 300));
      expect(secondDone).toBe(false);

      await first.query("COMMIT");
      await secondScan;
      await second.query("COMMIT");
    } finally {
      first.release();
      second.release();
    }

    const { n } = await one<{ n: string }>(
      "SELECT count(*) n FROM notification_outbox WHERE template = 'saved_place_offer' AND hub_user_id = $1",
      [user],
    );
    expect(Number(n)).toBe(1);
  });
});
