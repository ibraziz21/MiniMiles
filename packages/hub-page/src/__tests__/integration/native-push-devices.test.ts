/**
 * Integration tests for migration 101 (native push devices).
 *
 * These cover what the mocked device tests structurally cannot: the
 * database's own guarantees. The registration path in src/lib/push/devices.ts
 * depends on three constraints interacting correctly — a UNIQUE on the token,
 * a UNIQUE on (member, installation), and a CHECK that an *active* row must
 * be sendable — and a fake query builder has none of them. In particular the
 * token-handover sequence (one phone, member A signs out, member B signs in
 * and Expo hands them the same token) nulls both token columns on A's row,
 * which would violate a naive "must always have a token" CHECK and break
 * registration for the second member on any shared device.
 *
 * Requires a local PostgreSQL:
 *   pg_isready → should report "accepting connections"
 *   pnpm --filter @akibamiles/hub-page test:integration
 *
 * The database "hub_native_push_test" is created and torn down here. 101
 * only needs auth.users, fn_touch_updated_at() and web_push_jobs as an FK
 * target, all stubbed below, so this file does not replay migration history.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_NAME = "hub_native_push_test";

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const MIGRATION_101 = resolve(__dirname, "../../../../../supabase/migrations/101_native_push_devices.sql");

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

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- The shared trigger function 101 attaches to both of its tables.
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Only needed as native_push_deliveries' FK target. The real table and its
-- queue semantics come from 047 and are exercised by the dispatcher tests.
CREATE TABLE IF NOT EXISTS web_push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid,
  hub_user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
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

async function seedUser(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO auth.users (email) VALUES ($1) RETURNING id",
    [email],
  );
  return rows[0].id;
}

async function seedJob(hubUserId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO web_push_jobs (hub_user_id) VALUES ($1) RETURNING id",
    [hubUserId],
  );
  return rows[0].id;
}

/**
 * The exact sequence src/lib/push/devices.ts performs, in SQL: release the
 * token from any other member, then upsert on (member, installation).
 * Written out here rather than imported so the test exercises the database
 * rather than the Supabase client.
 */
async function registerDevice(
  hubUserId: string,
  installationId: string,
  token: string,
  platform: "ios" | "android" = "ios",
): Promise<string> {
  await pool.query(
    `UPDATE hub_user_devices
        SET expo_push_token = NULL, native_device_token = NULL,
            status = 'revoked', revoked_at = now()
      WHERE expo_push_token = $1 AND hub_user_id <> $2`,
    [token, hubUserId],
  );

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO hub_user_devices
       (hub_user_id, installation_id, platform, expo_push_token, status, failure_count, revoked_at)
     VALUES ($1, $2, $3, $4, 'active', 0, NULL)
     ON CONFLICT (hub_user_id, installation_id) DO UPDATE
       SET expo_push_token = EXCLUDED.expo_push_token,
           platform = EXCLUDED.platform,
           status = 'active',
           failure_count = 0,
           revoked_at = NULL,
           last_seen_at = now()
     RETURNING id`,
    [hubUserId, installationId, platform, token],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  });

  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(readFileSync(MIGRATION_101, "utf8"));
});

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

beforeEach(async () => {
  await pool.query("TRUNCATE native_push_deliveries, hub_user_devices, web_push_jobs CASCADE");
  await pool.query("DELETE FROM auth.users");
});

describe("migration 101 applies and locks the tables down", () => {
  it("creates both tables with RLS enabled", async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('hub_user_devices', 'native_push_deliveries') ORDER BY relname`,
    );

    expect(rows).toEqual([
      { relname: "hub_user_devices", relrowsecurity: true },
      { relname: "native_push_deliveries", relrowsecurity: true },
    ]);
  });

  it.each(["anon", "authenticated"])("denies %s every privilege on the device registry", async (role) => {
    // Push tokens are member data behind a service-role-only API; a client
    // key must never be able to read or write them.
    const { rows } = await pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'hub_user_devices' AND grantee = $1`,
      [role],
    );
    expect(rows).toEqual([]);
  });

  it("grants service_role what the dispatcher and the deletion worker need", async () => {
    const { rows } = await pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'hub_user_devices' AND grantee = 'service_role'
        ORDER BY privilege_type`,
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });
});

describe("device registration", () => {
  it("re-registering the same installation updates the row instead of adding one", async () => {
    const user = await seedUser("a@example.com");
    const installation = "11111111-1111-4111-8111-111111111111";

    const first = await registerDevice(user, installation, "ExponentPushToken[one]");
    const second = await registerDevice(user, installation, "ExponentPushToken[two]");

    expect(second).toBe(first);
    const { rows } = await pool.query("SELECT expo_push_token FROM hub_user_devices WHERE hub_user_id = $1", [user]);
    expect(rows).toHaveLength(1);
    expect(rows[0].expo_push_token).toBe("ExponentPushToken[two]");
  });

  it("lets one member hold several installations", async () => {
    const user = await seedUser("a@example.com");
    await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[phone]");
    await registerDevice(user, "22222222-2222-4222-8222-222222222222", "ExponentPushToken[tablet]", "android");

    const { rows } = await pool.query("SELECT id FROM hub_user_devices WHERE hub_user_id = $1 AND status = 'active'", [user]);
    expect(rows).toHaveLength(2);
  });

  it("refuses two active rows holding the same token", async () => {
    const user = await seedUser("a@example.com");
    await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[dup]");

    // Without the release step, this is what a second registration hits.
    await expect(
      pool.query(
        `INSERT INTO hub_user_devices (hub_user_id, installation_id, platform, expo_push_token)
         VALUES ($1, '22222222-2222-4222-8222-222222222222', 'ios', 'ExponentPushToken[dup]')`,
        [user],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("rejects an active registration with no token at all", async () => {
    const user = await seedUser("a@example.com");
    await expect(
      pool.query(
        `INSERT INTO hub_user_devices (hub_user_id, installation_id, platform)
         VALUES ($1, '11111111-1111-4111-8111-111111111111', 'ios')`,
        [user],
      ),
    ).rejects.toThrow(/chk_hub_user_devices_active_has_token/);
  });

  it("rejects a platform the app cannot be running on", async () => {
    const user = await seedUser("a@example.com");
    await expect(
      pool.query(
        `INSERT INTO hub_user_devices (hub_user_id, installation_id, platform, expo_push_token)
         VALUES ($1, '11111111-1111-4111-8111-111111111111', 'web', 'ExponentPushToken[x]')`,
        [user],
      ),
    ).rejects.toThrow(/platform/);
  });

  it("touches updated_at on every write", async () => {
    const user = await seedUser("a@example.com");
    const installation = "11111111-1111-4111-8111-111111111111";
    await registerDevice(user, installation, "ExponentPushToken[one]");

    const before = await pool.query<{ updated_at: Date }>("SELECT updated_at FROM hub_user_devices");
    await new Promise((done) => setTimeout(done, 10));
    await registerDevice(user, installation, "ExponentPushToken[two]");
    const after = await pool.query<{ updated_at: Date }>("SELECT updated_at FROM hub_user_devices");

    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(before.rows[0].updated_at.getTime());
  });
});

describe("token handover between accounts on one phone", () => {
  // The scenario the conditional CHECK exists for. If an active-or-not
  // "must have a token" CHECK were used instead, this whole sequence fails
  // and the second member on any shared phone silently gets no push.
  it("moves the token to the new member and keeps the old row as an audit trail", async () => {
    const memberA = await seedUser("a@example.com");
    const memberB = await seedUser("b@example.com");
    const installationA = "11111111-1111-4111-8111-111111111111";
    const installationB = "22222222-2222-4222-8222-222222222222";
    const token = "ExponentPushToken[shared-phone]";

    const deviceA = await registerDevice(memberA, installationA, token);
    const deviceB = await registerDevice(memberB, installationB, token);

    expect(deviceB).not.toBe(deviceA);

    const { rows } = await pool.query<{
      hub_user_id: string;
      status: string;
      expo_push_token: string | null;
    }>("SELECT hub_user_id, status, expo_push_token FROM hub_user_devices ORDER BY created_at");

    // A's row survives, tokenless and revoked...
    expect(rows[0]).toMatchObject({ hub_user_id: memberA, status: "revoked", expo_push_token: null });
    // ...and only B is now sendable.
    expect(rows[1]).toMatchObject({ hub_user_id: memberB, status: "active", expo_push_token: token });
  });

  it("leaves exactly one active target for that token", async () => {
    const memberA = await seedUser("a@example.com");
    const memberB = await seedUser("b@example.com");
    const token = "ExponentPushToken[shared-phone]";

    await registerDevice(memberA, "11111111-1111-4111-8111-111111111111", token);
    await registerDevice(memberB, "22222222-2222-4222-8222-222222222222", token);

    // This is the dispatcher's own query. Two rows here would mean member A
    // receiving member B's Miles notifications.
    const { rows } = await pool.query(
      "SELECT hub_user_id FROM hub_user_devices WHERE status = 'active' AND expo_push_token = $1",
      [token],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hub_user_id).toBe(memberB);
  });

  it("lets the original member re-register and take the token back", async () => {
    const memberA = await seedUser("a@example.com");
    const memberB = await seedUser("b@example.com");
    const installationA = "11111111-1111-4111-8111-111111111111";
    const token = "ExponentPushToken[shared-phone]";

    await registerDevice(memberA, installationA, token);
    await registerDevice(memberB, "22222222-2222-4222-8222-222222222222", token);
    await registerDevice(memberA, installationA, token);

    const { rows } = await pool.query(
      "SELECT hub_user_id FROM hub_user_devices WHERE status = 'active' AND expo_push_token = $1",
      [token],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hub_user_id).toBe(memberA);
  });
});

describe("delivery audit", () => {
  it("records one row per job and device, and upserts on retry", async () => {
    const user = await seedUser("a@example.com");
    const device = await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[x]");
    const job = await seedJob(user);

    await pool.query(
      `INSERT INTO native_push_deliveries (job_id, device_id, status, attempts) VALUES ($1, $2, 'retry', 1)`,
      [job, device],
    );
    await pool.query(
      `INSERT INTO native_push_deliveries (job_id, device_id, status, attempts, provider_ticket)
       VALUES ($1, $2, 'accepted', 2, 'ticket-1')
       ON CONFLICT (job_id, device_id) DO UPDATE
         SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, provider_ticket = EXCLUDED.provider_ticket`,
      [job, device],
    );

    const { rows } = await pool.query("SELECT status, attempts, provider_ticket FROM native_push_deliveries");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "accepted", attempts: 2, provider_ticket: "ticket-1" });
  });

  it("rejects a delivery status outside the shared vocabulary", async () => {
    const user = await seedUser("a@example.com");
    const device = await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[x]");
    const job = await seedJob(user);

    await expect(
      pool.query(`INSERT INTO native_push_deliveries (job_id, device_id, status) VALUES ($1, $2, 'delivered')`, [
        job,
        device,
      ]),
    ).rejects.toThrow(/status/);
  });

  it("cascades away with the job", async () => {
    const user = await seedUser("a@example.com");
    const device = await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[x]");
    const job = await seedJob(user);
    await pool.query(`INSERT INTO native_push_deliveries (job_id, device_id) VALUES ($1, $2)`, [job, device]);

    await pool.query("DELETE FROM web_push_jobs WHERE id = $1", [job]);

    const { rows } = await pool.query("SELECT 1 FROM native_push_deliveries");
    expect(rows).toHaveLength(0);
  });

  it("cascades away with the device", async () => {
    const user = await seedUser("a@example.com");
    const device = await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[x]");
    const job = await seedJob(user);
    await pool.query(`INSERT INTO native_push_deliveries (job_id, device_id) VALUES ($1, $2)`, [job, device]);

    await pool.query("DELETE FROM hub_user_devices WHERE id = $1", [device]);

    const { rows } = await pool.query("SELECT 1 FROM native_push_deliveries");
    expect(rows).toHaveLength(0);
  });
});

describe("account deletion", () => {
  it("leaves no device or delivery row behind when the member is deleted", async () => {
    // The worker deletes these explicitly and in order; this asserts the
    // schema would not strand anything even so.
    const user = await seedUser("a@example.com");
    const device = await registerDevice(user, "11111111-1111-4111-8111-111111111111", "ExponentPushToken[x]");
    const job = await seedJob(user);
    await pool.query(`INSERT INTO native_push_deliveries (job_id, device_id) VALUES ($1, $2)`, [job, device]);

    await pool.query("DELETE FROM auth.users WHERE id = $1", [user]);

    const devices = await pool.query("SELECT 1 FROM hub_user_devices");
    const deliveries = await pool.query("SELECT 1 FROM native_push_deliveries");
    expect(devices.rows).toHaveLength(0);
    expect(deliveries.rows).toHaveLength(0);
  });
});
