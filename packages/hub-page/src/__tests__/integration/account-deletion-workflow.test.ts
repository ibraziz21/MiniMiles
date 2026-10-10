/**
 * Integration tests for migration 097 (account deletion workflow).
 *
 * These cover what the mocked route and worker tests structurally cannot:
 * the database's own guarantees. First-request-wins, the challenge
 * lifecycle, lease claiming, constrained status transitions and the
 * completion-email queue are all enforced by indexes, constraints and
 * plpgsql — a fake query builder has none of those, so a bug in any of them
 * passes the unit tests and fails in production.
 *
 * Requires a local PostgreSQL:
 *   pg_isready → should report "accepting connections"
 *   pnpm --filter @akibamiles/hub-page test:integration
 *
 * The database "hub_account_deletion_test" is created and torn down here.
 * 097 only needs auth.users and public.touch_updated_at(), both stubbed
 * below, so this file does not have to replay the whole migration history.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_NAME = "hub_account_deletion_test";

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const MIGRATION_097 = resolve(
  __dirname,
  "../../../../../supabase/migrations/097_account_deletion_workflow.sql",
);

const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

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
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text,
  deleted_at timestamptz
);

-- The shared trigger function 097 attaches to its requests table.
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
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

async function seedUser(email = "member@example.com"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO auth.users (email) VALUES ($1) RETURNING id",
    [email],
  );
  return rows[0].id;
}

async function issueChallenge(userId: string, ttlSeconds = 600): Promise<string> {
  const { rows } = await pool.query<{ challenge_id: string }>(
    "SELECT * FROM create_account_deletion_challenge($1, $2)",
    [userId, ttlSeconds],
  );
  return rows[0].challenge_id;
}

type RequestResult = {
  ok: boolean;
  error_code: string | null;
  request_id: string | null;
  status: string | null;
  requested_at: string | null;
  target_completion_at: string | null;
  already_requested: boolean;
};

async function createRequest(
  userId: string,
  challengeId: string,
  opts: { policyVersion?: string; source?: string; contact?: string | null } = {},
): Promise<RequestResult> {
  const { rows } = await pool.query<RequestResult>(
    `SELECT * FROM create_account_deletion_request($1, $2, $3, $4, 14, $5, $6)`,
    [
      userId,
      challengeId,
      opts.policyVersion ?? "2026-10-10.1",
      opts.source ?? "native_ios",
      opts.contact ?? null,
      opts.contact ? "v1" : null,
    ],
  );
  return rows[0];
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  });

  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(readFileSync(MIGRATION_097, "utf8"));
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

beforeEach(async () => {
  await pool.query("TRUNCATE account_deletion_events, account_deletion_requests, account_deletion_challenges CASCADE");
  await pool.query("DELETE FROM auth.users");
});

describe("migration 097 — structure", () => {
  it("creates the three tables with RLS enabled", async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('account_deletion_challenges','account_deletion_requests','account_deletion_events')
       ORDER BY relname`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.relrowsecurity).toBe(true);
  });

  it("denies anon and authenticated any access to the tables", async () => {
    for (const table of [
      "account_deletion_challenges",
      "account_deletion_requests",
      "account_deletion_events",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await pool.query<{ has: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS has`,
          [role, table],
        );
        expect(rows[0].has).toBe(false);
      }
    }
  });

  it("grants execute on every RPC to service_role only", async () => {
    const functions = [
      "create_account_deletion_challenge",
      "record_account_deletion_challenge_attempt",
      "create_account_deletion_request",
      "claim_account_deletion_requests",
      "finish_account_deletion_request",
      "claim_account_deletion_completion_emails",
      "record_account_deletion_completion_email_failure",
      "purge_account_deletion_contact",
    ];
    for (const name of functions) {
      const { rows } = await pool.query<{ oid: string }>(
        `SELECT p.oid::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = $1`,
        [name],
      );
      expect(rows.length, `${name} should exist`).toBeGreaterThan(0);

      const { rows: grants } = await pool.query<{ anon: boolean; service: boolean }>(
        `SELECT has_function_privilege('anon', $1::oid, 'EXECUTE') AS anon,
                has_function_privilege('service_role', $1::oid, 'EXECUTE') AS service`,
        [rows[0].oid],
      );
      expect(grants[0].anon, `${name} must be closed to anon`).toBe(false);
      expect(grants[0].service, `${name} must be open to service_role`).toBe(true);
    }
  });
});

describe("challenge lifecycle", () => {
  it("allows only one live challenge per user, replacing the previous one", async () => {
    const userId = await seedUser();
    const first = await issueChallenge(userId);
    const second = await issueChallenge(userId);

    expect(second).not.toBe(first);
    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) FROM account_deletion_challenges WHERE hub_user_id = $1 AND consumed_at IS NULL",
      [userId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("burns one attempt per call and refuses once the budget is gone", async () => {
    const userId = await seedUser();
    const challengeId = await issueChallenge(userId);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const { rows } = await pool.query<{ ok: boolean; attempts_remaining: number }>(
        "SELECT * FROM record_account_deletion_challenge_attempt($1, $2, 5)",
        [challengeId, userId],
      );
      expect(rows[0].ok).toBe(true);
      expect(rows[0].attempts_remaining).toBe(5 - attempt);
    }

    const { rows } = await pool.query<{ ok: boolean; error_code: string }>(
      "SELECT * FROM record_account_deletion_challenge_attempt($1, $2, 5)",
      [challengeId, userId],
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "challenge_attempts_exhausted" });
  });

  it("refuses another user's challenge with the same answer as a missing one", async () => {
    const owner = await seedUser("owner@example.com");
    const other = await seedUser("other@example.com");
    const challengeId = await issueChallenge(owner);

    const { rows } = await pool.query<{ ok: boolean; error_code: string }>(
      "SELECT * FROM record_account_deletion_challenge_attempt($1, $2, 5)",
      [challengeId, other],
    );
    // Identical to the not-found answer: a caller must not be able to probe
    // for other users' challenge ids.
    expect(rows[0]).toMatchObject({ ok: false, error_code: "challenge_not_found" });
  });

  it("refuses an expired challenge", async () => {
    const userId = await seedUser();
    const challengeId = await issueChallenge(userId, 1);
    await pool.query(
      "UPDATE account_deletion_challenges SET expires_at = now() - interval '1 second' WHERE id = $1",
      [challengeId],
    );

    const { rows } = await pool.query<{ error_code: string }>(
      "SELECT * FROM record_account_deletion_challenge_attempt($1, $2, 5)",
      [challengeId, userId],
    );
    expect(rows[0].error_code).toBe("challenge_expired");
  });
});

describe("request creation — first request wins", () => {
  it("creates a request, consumes the challenge and writes one audit event", async () => {
    const userId = await seedUser();
    const challengeId = await issueChallenge(userId);

    const result = await createRequest(userId, challengeId);
    expect(result.ok).toBe(true);
    expect(result.already_requested).toBe(false);
    expect(result.status).toBe("requested");

    const { rows: challenge } = await pool.query<{ consumed_at: string | null }>(
      "SELECT consumed_at FROM account_deletion_challenges WHERE id = $1",
      [challengeId],
    );
    expect(challenge[0].consumed_at).not.toBeNull();

    const { rows: events } = await pool.query<{ event_type: string; actor_kind: string }>(
      "SELECT event_type, actor_kind FROM account_deletion_events WHERE request_id = $1",
      [result.request_id],
    );
    expect(events).toEqual([{ event_type: "requested", actor_kind: "member" }]);
  });

  it("returns the original receipt for a second submission, unchanged", async () => {
    const userId = await seedUser();
    const first = await createRequest(userId, await issueChallenge(userId));
    const second = await createRequest(userId, await issueChallenge(userId));

    expect(second.request_id).toBe(first.request_id);
    expect(second.requested_at).toEqual(first.requested_at);
    expect(second.target_completion_at).toEqual(first.target_completion_at);
    expect(second.already_requested).toBe(true);
  });

  it("produces exactly one request under concurrent submissions", async () => {
    // The advisory lock plus the partial unique index are what make this
    // true; application-level sequencing cannot.
    const userId = await seedUser();
    const challenges = await Promise.all([
      issueChallenge(userId),
      // Only one challenge can be live, so both calls race over the same row.
      issueChallenge(userId),
    ]);

    const results = await Promise.all([
      createRequest(userId, challenges[1]),
      createRequest(userId, challenges[1]),
      createRequest(userId, challenges[1]),
    ]);

    const succeeded = results.filter((result) => result.ok);
    expect(succeeded.length).toBeGreaterThan(0);
    const ids = new Set(succeeded.map((result) => result.request_id));
    expect(ids.size).toBe(1);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) FROM account_deletion_requests WHERE hub_user_id = $1",
      [userId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("enforces one open request per user at the index level", async () => {
    const userId = await seedUser();
    const first = await createRequest(userId, await issueChallenge(userId));

    await expect(
      pool.query(
        `INSERT INTO account_deletion_requests (hub_user_id, source, policy_version, target_completion_at)
         VALUES ($1, 'web', '2026-10-10.1', now() + interval '14 days')`,
        [userId],
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    // Cancelling is the only state that frees the user to request again.
    await pool.query("UPDATE account_deletion_requests SET status = 'cancelled' WHERE id = $1", [
      first.request_id,
    ]);
    await expect(
      pool.query(
        `INSERT INTO account_deletion_requests (hub_user_id, source, policy_version, target_completion_at)
         VALUES ($1, 'web', '2026-10-10.1', now() + interval '14 days')`,
        [userId],
      ),
    ).resolves.toBeTruthy();
  });

  it("rejects a source outside the three the contract allows", async () => {
    const userId = await seedUser();
    await expect(
      createRequest(userId, await issueChallenge(userId), { source: "curl" }),
    ).rejects.toThrow(/source/i);
  });

  it("refuses a consumed challenge", async () => {
    const userId = await seedUser();
    const challengeId = await issueChallenge(userId);
    const first = await createRequest(userId, challengeId);
    await pool.query("UPDATE account_deletion_requests SET status = 'cancelled' WHERE id = $1", [
      first.request_id,
    ]);

    const replay = await createRequest(userId, challengeId);
    expect(replay).toMatchObject({ ok: false, error_code: "challenge_consumed" });
  });
});

describe("worker claiming and transitions", () => {
  it("claims a requested row, leases it, and skips it on a second claim", async () => {
    const userId = await seedUser();
    await createRequest(userId, await issueChallenge(userId));

    const { rows: firstClaim } = await pool.query<{ id: string; status: string; attempts: number }>(
      "SELECT * FROM claim_account_deletion_requests(5, 900)",
    );
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0].status).toBe("processing");
    expect(firstClaim[0].attempts).toBe(1);

    const { rows: secondClaim } = await pool.query(
      "SELECT * FROM claim_account_deletion_requests(5, 900)",
    );
    expect(secondClaim).toHaveLength(0);
  });

  it("reclaims a row whose lease lapsed, so a dead worker cannot wedge the queue", async () => {
    const userId = await seedUser();
    await createRequest(userId, await issueChallenge(userId));
    await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    await pool.query(
      "UPDATE account_deletion_requests SET lease_expires_at = now() - interval '1 minute'",
    );

    const { rows } = await pool.query<{ attempts: number }>(
      "SELECT * FROM claim_account_deletion_requests(5, 900)",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(2);
  });

  it("never claims a legal_hold row", async () => {
    const userId = await seedUser();
    const request = await createRequest(userId, await issueChallenge(userId));
    await pool.query("SELECT * FROM finish_account_deletion_request($1, 'legal_hold', 'court_order')", [
      request.request_id,
    ]);

    const { rows } = await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    expect(rows).toHaveLength(0);
  });

  it("re-arms a failed row with backoff and claims it again once due", async () => {
    const userId = await seedUser();
    const request = await createRequest(userId, await issueChallenge(userId));
    await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    await pool.query(
      "SELECT * FROM finish_account_deletion_request($1, 'failed', 'step_failed:profile_contact', 300)",
      [request.request_id],
    );

    const { rows: tooSoon } = await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    expect(tooSoon).toHaveLength(0);

    await pool.query("UPDATE account_deletion_requests SET next_retry_at = now() - interval '1 second'");
    const { rows: due } = await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    expect(due).toHaveLength(1);
  });

  it("treats completed as terminal and idempotent", async () => {
    const userId = await seedUser();
    const request = await createRequest(userId, await issueChallenge(userId));
    await pool.query("SELECT * FROM finish_account_deletion_request($1, 'completed', NULL)", [
      request.request_id,
    ]);

    const { rows: repeat } = await pool.query<{ ok: boolean; status: string }>(
      "SELECT * FROM finish_account_deletion_request($1, 'completed', NULL)",
      [request.request_id],
    );
    expect(repeat[0]).toMatchObject({ ok: true, status: "completed" });

    // A completed row must never be dragged back into processing.
    const { rows: claims } = await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    expect(claims).toHaveLength(0);

    const { rows: downgrade } = await pool.query<{ status: string }>(
      "SELECT * FROM finish_account_deletion_request($1, 'failed', 'whatever')",
      [request.request_id],
    );
    expect(downgrade[0].status).toBe("completed");
  });

  it("survives a soft-deleted Auth user, and blocks a hard delete", async () => {
    // The worker soft-deletes; the evidence row must outlive that. A hard
    // delete has to be refused rather than orphaning the record.
    const userId = await seedUser();
    await createRequest(userId, await issueChallenge(userId));

    await expect(
      pool.query("UPDATE auth.users SET deleted_at = now() WHERE id = $1", [userId]),
    ).resolves.toBeTruthy();

    await expect(pool.query("DELETE FROM auth.users WHERE id = $1", [userId])).rejects.toThrow(
      /foreign key|violates/i,
    );
  });
});

describe("completion-email queue", () => {
  async function completedRequestWithContact(): Promise<string> {
    const userId = await seedUser();
    const request = await createRequest(userId, await issueChallenge(userId), {
      contact: "\\x0102030405060708090a0b0c0d0e0f10",
    });
    await pool.query("SELECT * FROM finish_account_deletion_request($1, 'completed', NULL)", [
      request.request_id,
    ]);
    return request.request_id!;
  }

  it("claims a completed request whose email has not gone out", async () => {
    const requestId = await completedRequestWithContact();

    const { rows } = await pool.query<{ id: string; completion_email_attempts: number }>(
      "SELECT * FROM claim_account_deletion_completion_emails(5, 300)",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(requestId);
    expect(rows[0].completion_email_attempts).toBe(1);

    // Leased — a second worker must not pick it up.
    const { rows: again } = await pool.query(
      "SELECT * FROM claim_account_deletion_completion_emails(5, 300)",
    );
    expect(again).toHaveLength(0);
  });

  it("never claims a completed request for processing, only for delivery", async () => {
    await completedRequestWithContact();
    const { rows } = await pool.query("SELECT * FROM claim_account_deletion_requests(5, 900)");
    expect(rows).toHaveLength(0);
  });

  it("backs off after a failure and becomes claimable again when due", async () => {
    const requestId = await completedRequestWithContact();
    await pool.query("SELECT * FROM claim_account_deletion_completion_emails(5, 300)");
    await pool.query(
      "SELECT * FROM record_account_deletion_completion_email_failure($1, 'smtp_unavailable', 3600, 10)",
      [requestId],
    );

    const { rows: tooSoon } = await pool.query(
      "SELECT * FROM claim_account_deletion_completion_emails(5, 300)",
    );
    expect(tooSoon).toHaveLength(0);

    await pool.query(
      "UPDATE account_deletion_requests SET completion_email_next_retry_at = now() - interval '1 second'",
    );
    const { rows: due } = await pool.query(
      "SELECT * FROM claim_account_deletion_completion_emails(5, 300)",
    );
    expect(due).toHaveLength(1);
  });

  it("gives up at the attempt limit and purges the contact rather than keeping it forever", async () => {
    const requestId = await completedRequestWithContact();
    await pool.query(
      "UPDATE account_deletion_requests SET completion_email_attempts = 10 WHERE id = $1",
      [requestId],
    );

    const { rows } = await pool.query<{ gave_up: boolean }>(
      "SELECT * FROM record_account_deletion_completion_email_failure($1, 'smtp_unavailable', 3600, 10)",
      [requestId],
    );
    expect(rows[0].gave_up).toBe(true);

    const { rows: row } = await pool.query<{
      completion_contact_ciphertext: Buffer | null;
      completion_email_sent_at: string | null;
    }>(
      "SELECT completion_contact_ciphertext, completion_email_sent_at FROM account_deletion_requests WHERE id = $1",
      [requestId],
    );
    expect(row[0].completion_contact_ciphertext).toBeNull();
    expect(row[0].completion_email_sent_at).toBeNull();

    // With no contact left there is nothing to deliver, so it stops being claimable.
    const { rows: claims } = await pool.query(
      "SELECT * FROM claim_account_deletion_completion_emails(5, 300)",
    );
    expect(claims).toHaveLength(0);
  });

  it("purges the contact on successful delivery and stamps the sent time", async () => {
    const requestId = await completedRequestWithContact();
    await pool.query("SELECT purge_account_deletion_contact($1, true)", [requestId]);

    const { rows } = await pool.query<{
      completion_contact_ciphertext: Buffer | null;
      completion_contact_key_version: string | null;
      completion_email_sent_at: string | null;
    }>(
      `SELECT completion_contact_ciphertext, completion_contact_key_version, completion_email_sent_at
       FROM account_deletion_requests WHERE id = $1`,
      [requestId],
    );
    expect(rows[0].completion_contact_ciphertext).toBeNull();
    expect(rows[0].completion_contact_key_version).toBeNull();
    expect(rows[0].completion_email_sent_at).not.toBeNull();
  });
});

describe("reconciliation view", () => {
  it("reports counts and ages without exposing any user identifier", async () => {
    const userId = await seedUser();
    await createRequest(userId, await issueChallenge(userId));

    const { rows, fields } = await pool.query(
      "SELECT * FROM account_deletion_reconciliation WHERE status = 'requested'",
    );
    expect(rows).toHaveLength(1);
    const columns = fields.map((field) => field.name);
    expect(columns).toContain("request_count");
    expect(columns).toContain("overdue_count");
    // Nothing that could re-identify a member may appear in an operator view.
    expect(columns).not.toContain("hub_user_id");
    expect(columns).not.toContain("completion_contact_ciphertext");
  });
});
