/**
 * Integration tests for the emergency-suppression and eligibility-index
 * migration (092), run against real PostgreSQL with migrations 081-092
 * applied in order (hardening spec §7.1, §8.3, §9).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

const { Pool } = pg;

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "hub_phase1_test",
};

const MIGRATIONS_DIR = resolve(__dirname, "../../../../../supabase/migrations");
const MIGRATION_NUMBERS = ["081", "082", "083", "084", "085", "086", "087", "088", "089", "090", "091", "092"];

const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE partners (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug   text,
  name   text NOT NULL DEFAULT 'Test Partner',
  type   text NOT NULL DEFAULT 'merchant',
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE partner_settings (
  partner_id       uuid PRIMARY KEY REFERENCES partners(id),
  directory_status text NOT NULL DEFAULT 'published'
);

DROP SCHEMA IF EXISTS storage CASCADE;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean NOT NULL DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
`;

let pool: pg.Pool;

async function applyMigrations() {
  for (const number of MIGRATION_NUMBERS) {
    const [file] = readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith(`${number}_`));
    if (!file) throw new Error(`migration ${number} not found in ${MIGRATIONS_DIR}`);
    await pool.query(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
}

beforeAll(async () => {
  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await applyMigrations();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function makeEligibleFixture(): Promise<{ partnerId: string; contributionId: string }> {
  const partnerId = randomUUID();
  const hubUserId = randomUUID();
  const earningEventId = randomUUID();
  const requestId = randomUUID();
  const contributionId = randomUUID();
  const templateId = randomUUID();

  await pool.query(`INSERT INTO partners (id) VALUES ($1)`, [partnerId]);
  await pool.query(`INSERT INTO partner_settings (partner_id) VALUES ($1)`, [partnerId]);
  await pool.query(
    `INSERT INTO merchant_discovery_settings (partner_id, contributions_enabled, structured_proof_enabled, customer_photos_enabled)
     VALUES ($1, true, true, true)`,
    [partnerId],
  );
  await pool.query(
    `INSERT INTO discovery_question_templates (id, category_slug, version, recommendation_prompt, party_size_prompt, item_prompt, recommendation_item_prompt, photo_prompt, photo_safety_guidance)
     VALUES ($1, $2, 1, 'Would you recommend?', 'Party size?', 'What did you get?', 'Which to try?', 'Add a photo', 'Avoid faces')`,
    [templateId, `cat-${templateId}`],
  );
  await pool.query(
    `INSERT INTO verified_earning_events (id, event_id, hub_user_id, partner_id, source, channel, occurred_at, verification_status)
     VALUES ($1, $2, $3, $4, 'merchant_scan', 'in_store', now(), 'active')`,
    [earningEventId, `evt-${earningEventId}`, hubUserId, partnerId],
  );
  await pool.query(
    `INSERT INTO discovery_contribution_requests (id, earning_event_id, hub_user_id, partner_id, template_id, template_version, template_snapshot, state, expires_at, submitted_at)
     VALUES ($1, $2, $3, $4, $5, 1, '{}'::jsonb, 'submitted', now() + interval '14 days', now())`,
    [requestId, earningEventId, hubUserId, partnerId, templateId],
  );
  await pool.query(
    `INSERT INTO merchant_discovery_contributions (id, request_id, hub_user_id, partner_id, would_recommend, experience_option_ids, submitted_at)
     VALUES ($1, $2, $3, $4, true, '{}', now())`,
    [contributionId, requestId, hubUserId, partnerId],
  );

  return { partnerId, contributionId };
}

async function addApprovedPhoto(contributionId: string, partnerId: string): Promise<string> {
  const photoId = randomUUID();
  const hubUserId = randomUUID();
  await pool.query(
    `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version, approved_at)
     VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'approved', 'v1', now())`,
    [photoId, contributionId, hubUserId, partnerId],
  );
  return photoId;
}

async function isPhotoPublic(photoId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM eligible_public_merchant_visit_photos() WHERE photo_id = $1`, [photoId]);
  return rows.length > 0;
}

describe("verified-discovery suppression and index migration (092)", () => {
  describe("set_visit_photo_suppression (§7.1, §8.3)", () => {
    it("suppresses an already-approved (publicly eligible) photo immediately", async () => {
      const { partnerId, contributionId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await expect(isPhotoPublic(photoId)).resolves.toBe(true);

      const { rows: [result] } = await pool.query(
        `SELECT * FROM set_visit_photo_suppression($1, true, 'admin-1', 'corr-1', 'legal_request')`,
        [photoId],
      );
      expect(result.ok).toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);

      const { rows: [audit] } = await pool.query(
        `SELECT * FROM discovery_moderation_audit_events WHERE photo_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [photoId],
      );
      expect(audit).toMatchObject({
        action: "suppress", actor_id: "admin-1", reason_code: "legal_request",
        before_status: "unsuppressed", after_status: "suppressed",
      });
    });

    it("unsuppresses and restores public eligibility", async () => {
      const { partnerId, contributionId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`SELECT set_visit_photo_suppression($1, true, 'admin-1', 'corr-1')`, [photoId]);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);

      const { rows: [result] } = await pool.query(
        `SELECT * FROM set_visit_photo_suppression($1, false, 'admin-1', 'corr-2')`,
        [photoId],
      );
      expect(result.ok).toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(true);
    });

    it("rejects a redundant suppress/unsuppress call as invalid_transition", async () => {
      const { partnerId, contributionId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);

      const { rows: [result] } = await pool.query(
        `SELECT * FROM set_visit_photo_suppression($1, false, 'admin-1', 'corr-1')`,
        [photoId],
      );
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("invalid_transition");
    });

    it("enqueues a projection refresh for the photo's merchant", async () => {
      const { partnerId, contributionId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1`, [partnerId]);

      await pool.query(`SELECT set_visit_photo_suppression($1, true, 'admin-1', 'corr-1')`, [photoId]);

      const { rows } = await pool.query(
        `SELECT 1 FROM merchant_discovery_projection_jobs WHERE partner_id = $1 AND status = 'pending'`,
        [partnerId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("404s on an unknown photo id", async () => {
      const { rows: [result] } = await pool.query(
        `SELECT * FROM set_visit_photo_suppression($1, true, 'admin-1', 'corr-1')`,
        [randomUUID()],
      );
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("not_found");
    });
  });

  describe("eligibility-predicate indexes (§9)", () => {
    it("creates the partial indexes used by the canonical eligibility predicates", async () => {
      const { rows } = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename IN ('merchant_discovery_contributions', 'merchant_visit_photos')`,
      );
      const names = rows.map((r: { indexname: string }) => r.indexname);
      expect(names).toContain("idx_merchant_discovery_contributions_eligible");
      expect(names).toContain("idx_merchant_visit_photos_eligible");
    });

    it("the partial index is usable for the exact predicate shape eligibility queries use", async () => {
      // At pilot/CI data volumes (a handful of rows) the planner correctly
      // prefers a sequential scan no matter what indexes exist — that's not
      // what's under test. `enable_seqscan = off` forces it to use any
      // available index instead, which proves the index's column/predicate
      // shape actually matches this query (the thing that would otherwise
      // only show up once the table were production-sized).
      const { partnerId } = await makeEligibleFixture();
      // A dedicated client (not the pool's query() helper, which may hand
      // different calls to different connections) so the session-level
      // enable_seqscan setting actually applies to the EXPLAIN below.
      const client = await pool.connect();
      try {
        await client.query(`SET enable_seqscan = off`);
        const { rows } = await client.query(
          `EXPLAIN (FORMAT JSON) SELECT * FROM merchant_discovery_contributions
           WHERE partner_id = $1 AND withdrawn_at IS NULL AND suppressed_at IS NULL AND would_recommend = true
           ORDER BY submitted_at DESC`,
          [partnerId],
        );
        const plan = JSON.stringify(rows[0]["QUERY PLAN"]);
        expect(plan).toContain("idx_merchant_discovery_contributions_eligible");
      } finally {
        await client.query(`SET enable_seqscan = on`);
        client.release();
      }
    });
  });

  describe("re-running the suppression/index migration (idempotency)", () => {
    it("applies cleanly a second time", async () => {
      const [file] = readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith("092_"));
      await expect(pool.query(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"))).resolves.not.toThrow();
    });
  });
});
