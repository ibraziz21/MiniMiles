/**
 * Integration tests for migration 102 (immediate push dispatch).
 *
 * The property under test is a safety one, and it is the whole reason the
 * trigger is written the way it is: **a dispatch failure must never block a
 * notification from being enqueued**. The trigger fires on INSERT into
 * web_push_jobs, which itself fires from an INSERT into notification_outbox,
 * which happens inside a caller's request. An exception anywhere in that
 * chain would abort the caller's transaction — turning "the notification is
 * a minute late" into "the notification never existed, and the request
 * failed". That is a far worse outcome than the latency this optimises.
 *
 * A mocked test cannot show this: the guarantee is entirely about PostgreSQL
 * trigger and exception semantics. So these run against a real database with
 * pg_net and Vault *deliberately absent*, which is precisely the environment
 * that would break a naive implementation — and is also what a local or
 * preview database actually looks like.
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

const DB_NAME = "hub_push_dispatch_test";

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const MIGRATION_102 = resolve(
  __dirname,
  "../../../../../supabase/migrations/102_push_job_immediate_dispatch.sql",
);

// Only what 102's trigger attaches to. The real queue semantics come from
// 047 and are covered by the dispatcher's own tests.
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

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS web_push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid,
  hub_user_id     uuid,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now()
);
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
  // The migration itself must survive a database with neither pg_net nor
  // Vault — if this throws, the test fails here and that is the point.
  await pool.query(readFileSync(MIGRATION_102, "utf8"));
});

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

beforeEach(async () => {
  await pool.query("TRUNCATE web_push_jobs");
});

describe("migration 102 applies without pg_net", () => {
  it("creates the dispatch trigger on web_push_jobs", async () => {
    const { rows } = await pool.query<{ tgname: string; tgtype: number }>(
      `SELECT tgname, tgtype FROM pg_trigger
        WHERE tgrelid = 'web_push_jobs'::regclass AND NOT tgisinternal`,
    );
    expect(rows.map((row) => row.tgname)).toContain("trg_web_push_jobs_dispatch");
  });

  it("fires per statement, not per row", async () => {
    // tgtype bit 0 is "row-level". A row-level trigger would send one HTTP
    // request per inserted row, so a backfill of 10k jobs would become 10k
    // POSTs at the worker. One nudge is enough — it claims 25 per run.
    const { rows } = await pool.query<{ tgtype: number }>(
      `SELECT tgtype FROM pg_trigger
        WHERE tgrelid = 'web_push_jobs'::regclass AND tgname = 'trg_web_push_jobs_dispatch'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tgtype & 1).toBe(0);
  });

  it("keeps the function unreachable from client roles", async () => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT has_function_privilege('anon', 'fn_dispatch_push_jobs()', 'EXECUTE') AS ok`,
    );
    expect(rows[0].ok).toBe(false);
  });
});

describe("a dispatch failure never blocks the notification", () => {
  it("inserts a job even though pg_net and Vault are absent", async () => {
    // The core guarantee. Without the inner exception block this INSERT
    // raises 'schema "vault" does not exist' and the caller's transaction
    // dies with it.
    await expect(
      pool.query("INSERT INTO web_push_jobs (notification_id) VALUES (gen_random_uuid())"),
    ).resolves.toBeTruthy();

    const { rows } = await pool.query("SELECT status FROM web_push_jobs");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("leaves the transaction usable afterwards", async () => {
    // A swallowed exception that still poisoned the transaction would show
    // up here as "current transaction is aborted".
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO web_push_jobs (notification_id) VALUES (gen_random_uuid())");
      await client.query("INSERT INTO web_push_jobs (notification_id) VALUES (gen_random_uuid())");
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM web_push_jobs");
    expect(rows[0].n).toBe(2);
  });

  it("survives a bulk insert", async () => {
    await expect(
      pool.query(
        `INSERT INTO web_push_jobs (notification_id)
         SELECT gen_random_uuid() FROM generate_series(1, 500)`,
      ),
    ).resolves.toBeTruthy();

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM web_push_jobs");
    expect(rows[0].n).toBe(500);
  });

  it("is unaffected by rolling the insert back", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO web_push_jobs (notification_id) VALUES (gen_random_uuid())");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM web_push_jobs");
    expect(rows[0].n).toBe(0);
  });
});
