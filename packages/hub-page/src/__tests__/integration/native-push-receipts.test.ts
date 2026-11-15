/**
 * Integration tests for migration 124 (native push receipts).
 *
 * Checks the migration against a real database: it applies on top of 101's
 * table, is safe to re-run, keeps existing rows readable as "not checked",
 * rejects an unknown receipt status, and gives the poller its partial index.
 *
 * Requires a local PostgreSQL:
 *   pg_isready → should report "accepting connections"
 *   pnpm --filter @akibamiles/hub-page test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_NAME = "hub_native_push_receipts_test";

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const MIGRATION_124 = readFileSync(
  resolve(__dirname, "../../../../../supabase/migrations/124_native_push_receipts.sql"),
  "utf8",
);

// 101's native_push_deliveries, with the foreign keys dropped (their parent
// tables aren't what 124 touches).
const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE native_push_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL,
  device_id        uuid NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'retry', 'gone', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  provider_status  integer,
  provider_ticket  text,
  last_error       text,
  accepted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, device_id)
);

INSERT INTO native_push_deliveries (job_id, device_id, status, provider_ticket, accepted_at)
VALUES (gen_random_uuid(), gen_random_uuid(), 'accepted', 'ticket-before-124', now() - interval '1 hour');
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

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  });
  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(MIGRATION_124);
});

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

describe("migration 124 — native push receipts", () => {
  it("is safe to apply twice", async () => {
    await expect(pool.query(MIGRATION_124)).resolves.toBeDefined();
  });

  it("leaves rows sent before it as receipt-not-checked", async () => {
    const { rows } = await pool.query(
      "SELECT receipt_status, receipt_error, receipt_checked_at FROM native_push_deliveries WHERE provider_ticket = 'ticket-before-124'",
    );
    expect(rows).toEqual([{ receipt_status: null, receipt_error: null, receipt_checked_at: null }]);
  });

  it("accepts the poller's statuses and rejects anything else", async () => {
    for (const status of ["ok", "error", "expired"]) {
      await expect(
        pool.query("UPDATE native_push_deliveries SET receipt_status = $1", [status]),
      ).resolves.toBeDefined();
    }
    await expect(pool.query("UPDATE native_push_deliveries SET receipt_status = 'delivered'")).rejects.toThrow(
      /check constraint/,
    );
  });

  it("indexes the poller's queue of unchecked accepted sends", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_native_push_deliveries_receipt_pending'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/receipt_checked_at IS NULL/);
    expect(rows[0].indexdef).toMatch(/status = 'accepted'/);
  });
});
