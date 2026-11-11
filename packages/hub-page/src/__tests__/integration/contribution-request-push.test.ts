/**
 * Integration tests for migration 123 (contribution request push).
 *
 * What matters is trigger behaviour, which a mock can't show: the new
 * template must reach web_push_jobs at all (it is whitelisted inside the
 * trigger), it must arrive held back 45 minutes, and every existing template
 * must still be claimable immediately.
 *
 * Requires a local PostgreSQL:
 *   pg_isready → should report "accepting connections"
 *   pnpm --filter @akibamiles/hub-page test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_NAME = "hub_contribution_request_push_test";

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const MIGRATION_123 = resolve(
  __dirname,
  "../../../../../supabase/migrations/123_contribution_request_push.sql",
);

// The columns 047/069 give these two tables that the trigger touches, and
// the trigger binding from 047 that 123 re-points by redefining the function.
const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE notification_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid,
  template    text NOT NULL,
  category    text
);

CREATE TABLE web_push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notification_outbox(id),
  hub_user_id     uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  available_at    timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION enqueue_web_push_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END $$;

CREATE TRIGGER trg_notification_outbox_enqueue_push
  AFTER INSERT ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION enqueue_web_push_job();
`;

let pool: pg.Pool;

async function withAdmin<T>(run: (admin: pg.Pool) => Promise<T>): Promise<T> {
  const admin = new Pool({ ...DB_CONFIG, database: "postgres" });
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

async function enqueue(template: string, category: string): Promise<{ delaySeconds: number } | null> {
  const { rows } = await pool.query<{ delay_seconds: string }>(
    `WITH n AS (
       INSERT INTO notification_outbox (hub_user_id, template, category)
       VALUES (gen_random_uuid(), $1, $2) RETURNING id
     )
     SELECT 1 FROM n`,
    [template, category],
  );
  expect(rows).toHaveLength(1);
  const { rows: jobs } = await pool.query<{ delay_seconds: string }>(
    `SELECT EXTRACT(EPOCH FROM (j.available_at - now()))::text AS delay_seconds
       FROM web_push_jobs j JOIN notification_outbox n ON n.id = j.notification_id
      WHERE n.template = $1`,
    [template],
  );
  return jobs[0] ? { delaySeconds: Number(jobs[0].delay_seconds) } : null;
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  });
  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(readFileSync(MIGRATION_123, "utf8"));
});

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

beforeEach(async () => {
  await pool.query("TRUNCATE web_push_jobs, notification_outbox");
});

describe("migration 123 — contribution_requested push", () => {
  it("queues the recommendation ask held back 45 minutes", async () => {
    const job = await enqueue("contribution_requested", "earnings");
    expect(job).not.toBeNull();
    expect(job!.delaySeconds).toBeGreaterThan(44 * 60);
    expect(job!.delaySeconds).toBeLessThanOrEqual(45 * 60);
  });

  it("keeps Miles-earned pushes immediate", async () => {
    const job = await enqueue("miles_earned", "earnings");
    expect(job).not.toBeNull();
    expect(job!.delaySeconds).toBeLessThanOrEqual(1);
  });

  it("keeps every previously whitelisted template", async () => {
    for (const template of ["voucher_ready", "referral_signup_released", "order_delivered"]) {
      const category = template.startsWith("referral") ? "rewards" : template.startsWith("order") ? "orders" : "vouchers";
      expect(await enqueue(template, category), template).not.toBeNull();
    }
  });

  it("still ignores templates that are not push-eligible", async () => {
    expect(await enqueue("feature_announcement", "marketing")).toBeNull();
  });
});
