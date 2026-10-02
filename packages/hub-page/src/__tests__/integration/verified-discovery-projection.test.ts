/**
 * Integration tests for the verified-discovery public-snapshot and
 * projection-queue migration (091), run against real PostgreSQL with
 * migrations 081-091 applied in order (hardening spec §5.2-§5.4, §12 Phase
 * B — this infrastructure is computed in shadow, not yet served publicly).
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
const MIGRATION_NUMBERS = ["081", "082", "083", "084", "085", "086", "087", "088", "089", "090", "091"];

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

async function makeMerchant(overrides?: { directoryStatus?: string; partnerStatus?: string }): Promise<string> {
  const partnerId = randomUUID();
  await pool.query(`INSERT INTO partners (id, status) VALUES ($1, $2)`, [
    partnerId,
    overrides?.partnerStatus ?? "active",
  ]);
  await pool.query(`INSERT INTO partner_settings (partner_id, directory_status) VALUES ($1, $2)`, [
    partnerId,
    overrides?.directoryStatus ?? "published",
  ]);
  await pool.query(
    `INSERT INTO merchant_discovery_settings (partner_id, contributions_enabled, structured_proof_enabled, customer_photos_enabled)
     VALUES ($1, true, true, true)`,
    [partnerId],
  );
  return partnerId;
}

async function makeContributor(
  partnerId: string,
  labels: Array<{ id: string; publicLabel: string }> = [],
): Promise<{ contributionId: string; earningEventId: string }> {
  const hubUserId = randomUUID();
  const earningEventId = randomUUID();
  const requestId = randomUUID();
  const contributionId = randomUUID();
  const templateId = randomUUID();

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
     VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, 'submitted', now() + interval '14 days', now())`,
    [requestId, earningEventId, hubUserId, partnerId, templateId, JSON.stringify({ experience_options: labels })],
  );
  await pool.query(
    `INSERT INTO merchant_discovery_contributions (id, request_id, hub_user_id, partner_id, would_recommend, experience_option_ids, submitted_at)
     VALUES ($1, $2, $3, $4, true, $5, now())`,
    [contributionId, requestId, hubUserId, partnerId, labels.map((l) => l.id)],
  );

  return { contributionId, earningEventId };
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

describe("verified-discovery projection queue migration (091)", () => {
  describe("recompute_merchant_discovery_snapshot (§5.3 Ranking V1)", () => {
    it("computes unique count, band, qualified labels and cover photo once thresholds clear", async () => {
      const partnerId = await makeMerchant();
      const label = { id: "friendly", publicLabel: "Friendly staff" };
      let firstContributionId = "";
      for (let i = 0; i < 5; i++) {
        const { contributionId } = await makeContributor(partnerId, [label]);
        if (i === 0) firstContributionId = contributionId;
      }
      const photoId = await addApprovedPhoto(firstContributionId, partnerId);

      await pool.query(`SELECT recompute_merchant_discovery_snapshot($1)`, [partnerId]);

      const { rows: [snapshot] } = await pool.query(
        `SELECT * FROM merchant_discovery_public_snapshots WHERE partner_id = $1`,
        [partnerId],
      );
      expect(snapshot.active_positive_unique_count).toBe(5);
      expect(snapshot.public_count_band).toBe("5");
      expect(snapshot.qualified_experience_labels).toEqual(["Friendly staff"]);
      expect(snapshot.cover_photo_id).toBe(photoId);
      expect(snapshot.suppression_reason).toBeNull();
    });

    it("bands below the five-contributor threshold as 'new' and withholds the label", async () => {
      const partnerId = await makeMerchant();
      const label = { id: "friendly", publicLabel: "Friendly staff" };
      const { contributionId } = await makeContributor(partnerId, [label]);
      await addApprovedPhoto(contributionId, partnerId);

      await pool.query(`SELECT recompute_merchant_discovery_snapshot($1)`, [partnerId]);

      const { rows: [snapshot] } = await pool.query(
        `SELECT * FROM merchant_discovery_public_snapshots WHERE partner_id = $1`,
        [partnerId],
      );
      expect(snapshot.public_count_band).toBe("new");
      expect(snapshot.qualified_experience_labels).toEqual([]);
    });

    it("suppresses with no cover photo when there is no eligible approved photo", async () => {
      const partnerId = await makeMerchant();
      await makeContributor(partnerId);

      await pool.query(`SELECT recompute_merchant_discovery_snapshot($1)`, [partnerId]);

      const { rows: [snapshot] } = await pool.query(
        `SELECT * FROM merchant_discovery_public_snapshots WHERE partner_id = $1`,
        [partnerId],
      );
      expect(snapshot.cover_photo_id).toBeNull();
      expect(snapshot.suppression_reason).toBe("no_eligible_photo");
    });

    it("suppresses an unpublished merchant", async () => {
      const partnerId = await makeMerchant({ directoryStatus: "hidden" });
      const { contributionId } = await makeContributor(partnerId);
      await addApprovedPhoto(contributionId, partnerId);

      await pool.query(`SELECT recompute_merchant_discovery_snapshot($1)`, [partnerId]);

      const { rows: [snapshot] } = await pool.query(
        `SELECT * FROM merchant_discovery_public_snapshots WHERE partner_id = $1`,
        [partnerId],
      );
      expect(snapshot.suppression_reason).toBe("merchant_not_published");
    });
  });

  describe("projection job queue (§5.4)", () => {
    it("coalesces repeated enqueues for one partner into a single pending job", async () => {
      const partnerId = await makeMerchant();
      await pool.query(`SELECT enqueue_merchant_discovery_projection_refresh($1, 'test-a')`, [partnerId]);
      await pool.query(`SELECT enqueue_merchant_discovery_projection_refresh($1, 'test-b')`, [partnerId]);

      const { rows } = await pool.query(
        `SELECT * FROM merchant_discovery_projection_jobs WHERE partner_id = $1 AND status = 'pending'`,
        [partnerId],
      );
      expect(rows).toHaveLength(1);
    });

    it("auto-enqueues on contribution submit, settings change, directory publish change and partner status change", async () => {
      const partnerId = await makeMerchant();
      const countPending = async () => {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM merchant_discovery_projection_jobs WHERE partner_id = $1 AND status = 'pending'`,
          [partnerId],
        );
        return rows[0].n as number;
      };

      await makeContributor(partnerId);
      expect(await countPending()).toBeGreaterThanOrEqual(1);
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1`, [partnerId]);

      await pool.query(`UPDATE merchant_discovery_settings SET customer_photos_enabled = false WHERE partner_id = $1`, [partnerId]);
      expect(await countPending()).toBe(1);
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1`, [partnerId]);

      await pool.query(`UPDATE partner_settings SET directory_status = 'hidden' WHERE partner_id = $1`, [partnerId]);
      expect(await countPending()).toBe(1);
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1`, [partnerId]);

      await pool.query(`UPDATE partners SET status = 'suspended' WHERE id = $1`, [partnerId]);
      expect(await countPending()).toBe(1);
    });

    it("enqueues from the atomic moderation transition and the earning status change RPC", async () => {
      const partnerId = await makeMerchant();
      const { contributionId, earningEventId } = await makeContributor(partnerId);
      const photoId = randomUUID();
      const hubUserId = randomUUID();
      await pool.query(
        `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version)
         VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'pending', 'v1')`,
        [photoId, contributionId, hubUserId, partnerId],
      );
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1`, [partnerId]);

      await pool.query(`SELECT * FROM perform_visit_photo_transition($1, 'approve', NULL, 'admin-1', 'corr-1')`, [photoId]);
      const { rows: afterApprove } = await pool.query(
        `SELECT 1 FROM merchant_discovery_projection_jobs WHERE partner_id = $1 AND status = 'pending'`,
        [partnerId],
      );
      expect(afterApprove.length).toBeGreaterThanOrEqual(1);
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1`, [partnerId]);

      await pool.query(`SELECT apply_verified_earning_status_change($1, $2, 'reversed')`, [`chg-${randomUUID()}`, earningEventId]);
      const { rows: afterReverse } = await pool.query(
        `SELECT 1 FROM merchant_discovery_projection_jobs WHERE partner_id = $1 AND status = 'pending'`,
        [partnerId],
      );
      expect(afterReverse.length).toBeGreaterThanOrEqual(1);
    });

    it("claims and processes pending jobs, writing a snapshot and marking the job done", async () => {
      const partnerId = await makeMerchant();
      const { contributionId } = await makeContributor(partnerId);
      await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`DELETE FROM merchant_discovery_public_snapshots WHERE partner_id = $1`, [partnerId]);
      await pool.query(`UPDATE merchant_discovery_projection_jobs SET status = 'done' WHERE partner_id = $1 AND status != 'done'`, [partnerId]);
      await pool.query(`SELECT enqueue_merchant_discovery_projection_refresh($1, 'test')`, [partnerId]);

      const { rows: [result] } = await pool.query(`SELECT * FROM process_pending_merchant_discovery_projection_jobs(25)`);
      expect(result.succeeded).toBeGreaterThanOrEqual(1);

      const { rows: [snapshot] } = await pool.query(
        `SELECT * FROM merchant_discovery_public_snapshots WHERE partner_id = $1`,
        [partnerId],
      );
      expect(snapshot).toBeTruthy();
      const { rows: [job] } = await pool.query(
        `SELECT status FROM merchant_discovery_projection_jobs WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [partnerId],
      );
      expect(job.status).toBe("done");
    });
  });

  describe("shadow read path revalidation (§5.4, §11.2 stale-snapshot row)", () => {
    it("never serves a snapshot whose cover photo has since become ineligible", async () => {
      const partnerId = await makeMerchant();
      const { contributionId, earningEventId } = await makeContributor(partnerId);
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`SELECT recompute_merchant_discovery_snapshot($1)`, [partnerId]);

      const { rows: beforeReversal } = await pool.query(
        `SELECT * FROM get_public_merchant_discovery_snapshots(50) WHERE partner_id = $1`,
        [partnerId],
      );
      expect(beforeReversal).toHaveLength(1);
      expect(beforeReversal[0].cover_photo_id).toBe(photoId);

      // Reverse the earning event WITHOUT recomputing the snapshot — this is
      // exactly the "stale snapshot referencing now-ineligible photo"
      // scenario the lifecycle matrix (§11.2) requires fail closed.
      await pool.query(`SELECT apply_verified_earning_status_change($1, $2, 'reversed')`, [`chg-${randomUUID()}`, earningEventId]);

      const { rows: afterReversal } = await pool.query(
        `SELECT * FROM get_public_merchant_discovery_snapshots(50) WHERE partner_id = $1`,
        [partnerId],
      );
      expect(afterReversal).toHaveLength(0);
    });
  });

  describe("re-running the projection-queue migration (idempotency)", () => {
    it("applies cleanly a second time", async () => {
      const [file] = readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith("091_"));
      await expect(pool.query(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"))).resolves.not.toThrow();
    });
  });
});
