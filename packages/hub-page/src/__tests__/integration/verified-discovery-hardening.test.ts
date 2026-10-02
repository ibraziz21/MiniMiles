/**
 * Integration tests for the verified-discovery market-readiness hardening
 * migration (090), run against real PostgreSQL with migrations 081-090
 * applied in order (spec §3 "Database lifecycle tests", §11.1, §11.2).
 *
 * Requires postgres to be running against the disposable "hub_phase1_test"
 * database, same as migration.test.ts / referral-hardening.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
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
const MIGRATION_NUMBERS = ["081", "082", "083", "084", "085", "086", "087", "088", "089", "090"];

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

-- partners / partner_settings: owned by Akiba-Platform in production, not
-- by any migration in this repo. Minimal subset the verified-discovery
-- migrations and the hardening projection actually join against.
CREATE TABLE partners (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug   text,
  name   text NOT NULL DEFAULT 'Test Partner',
  type   text NOT NULL DEFAULT 'merchant',
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE partner_settings (
  partner_id      uuid PRIMARY KEY REFERENCES partners(id),
  directory_status text NOT NULL DEFAULT 'published'
);

-- Minimal stand-in for Supabase Storage's own schema — 082 inserts its two
-- private buckets as part of the migration. Dropped and recreated every run
-- (unlike public, it isn't covered by the DROP SCHEMA above) so a shape
-- change here can't be masked by a previous run's leftover table.
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
    const [file] = require("fs")
      .readdirSync(MIGRATIONS_DIR)
      .filter((name: string) => name.startsWith(`${number}_`));
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

type Fixture = {
  partnerId: string;
  earningEventId: string;
  requestId: string;
  contributionId: string;
};

async function makeEligibleFixture(overrides?: {
  structuredProofEnabled?: boolean;
  customerPhotosEnabled?: boolean;
  directoryStatus?: string;
  partnerStatus?: string;
}): Promise<Fixture> {
  const partnerId = randomUUID();
  const hubUserId = randomUUID();
  const earningEventId = randomUUID();
  const requestId = randomUUID();
  const contributionId = randomUUID();
  const templateId = randomUUID();

  await pool.query(`INSERT INTO partners (id, status) VALUES ($1, $2)`, [
    partnerId,
    overrides?.partnerStatus ?? "active",
  ]);
  await pool.query(
    `INSERT INTO partner_settings (partner_id, directory_status) VALUES ($1, $2)`,
    [partnerId, overrides?.directoryStatus ?? "published"],
  );
  await pool.query(
    `INSERT INTO merchant_discovery_settings (partner_id, contributions_enabled, structured_proof_enabled, customer_photos_enabled)
     VALUES ($1, true, $2, $3)`,
    [partnerId, overrides?.structuredProofEnabled ?? true, overrides?.customerPhotosEnabled ?? true],
  );
  await pool.query(
    `INSERT INTO discovery_question_templates (id, category_slug, version, recommendation_prompt, party_size_prompt, item_prompt, recommendation_item_prompt, photo_prompt, photo_safety_guidance)
     VALUES ($1, $2, 1, 'Would you recommend?', 'Party size?', 'What did you get?', 'Which to try?', 'Add a photo', 'Avoid faces')`,
    [templateId, `test-category-${templateId}`],
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

  return { partnerId, earningEventId, requestId, contributionId };
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

async function isVisitPublic(contributionId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM eligible_public_merchant_visits() WHERE contribution_id = $1`,
    [contributionId],
  );
  return rows.length > 0;
}

async function isPhotoPublic(photoId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM eligible_public_merchant_visit_photos() WHERE photo_id = $1`,
    [photoId],
  );
  return rows.length > 0;
}

describe("verified-discovery hardening migration (090)", () => {
  describe("eligibility lifecycle matrix (§11.2)", () => {
    it("publishes a visit and its photo when submitted, active and approved", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await expect(isVisitPublic(contributionId)).resolves.toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(true);
    });

    it("keeps the visit public but hides a pending/rejected/withdrawn photo", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = randomUUID();
      const hubUserId = randomUUID();
      await pool.query(
        `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version)
         VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'pending', 'v1')`,
        [photoId, contributionId, hubUserId, partnerId],
      );
      await expect(isVisitPublic(contributionId)).resolves.toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("hides both when the contribution is withdrawn", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`UPDATE merchant_discovery_contributions SET withdrawn_at = now() WHERE id = $1`, [contributionId]);
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("hides both when the earning event is reversed, and republishes on reinstatement", async () => {
      const { contributionId, partnerId, earningEventId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);

      await pool.query(
        `SELECT apply_verified_earning_status_change($1, $2, 'reversed')`,
        [`chg-${randomUUID()}`, earningEventId],
      );
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);

      await pool.query(
        `SELECT apply_verified_earning_status_change($1, $2, 'active')`,
        [`chg-${randomUUID()}`, earningEventId],
      );
      await expect(isVisitPublic(contributionId)).resolves.toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(true);
    });

    it("hides both when the earning event is disputed", async () => {
      const { contributionId, partnerId, earningEventId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(
        `SELECT apply_verified_earning_status_change($1, $2, 'disputed')`,
        [`chg-${randomUUID()}`, earningEventId],
      );
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("hides both when the merchant has structured proof disabled", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture({ structuredProofEnabled: false });
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("keeps the visit public but hides the photo when only customer photos are disabled", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture({ customerPhotosEnabled: false });
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await expect(isVisitPublic(contributionId)).resolves.toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("hides both when the merchant is suspended", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture({ partnerStatus: "suspended" });
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("hides both when the merchant is unpublished from the directory", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture({ directoryStatus: "hidden" });
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("keeps the visit public but hides an emergency-suppressed photo", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`UPDATE merchant_visit_photos SET suppressed_at = now() WHERE id = $1`, [photoId]);
      await expect(isVisitPublic(contributionId)).resolves.toBe(true);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });

    it("hides both when the contribution itself is suppressed", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = await addApprovedPhoto(contributionId, partnerId);
      await pool.query(`UPDATE merchant_discovery_contributions SET suppressed_at = now() WHERE id = $1`, [contributionId]);
      await expect(isVisitPublic(contributionId)).resolves.toBe(false);
      await expect(isPhotoPublic(photoId)).resolves.toBe(false);
    });
  });

  describe("atomic moderation audit (§5.6)", () => {
    it("commits the status transition and its audit event together on approve", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = randomUUID();
      const hubUserId = randomUUID();
      await pool.query(
        `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version)
         VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'pending', 'v1')`,
        [photoId, contributionId, hubUserId, partnerId],
      );

      const correlationId = `corr-${randomUUID()}`;
      const { rows: [result] } = await pool.query(
        `SELECT * FROM perform_visit_photo_transition($1, 'approve', NULL, 'admin-1', $2)`,
        [photoId, correlationId],
      );
      expect(result.ok).toBe(true);

      const { rows: [audit] } = await pool.query(
        `SELECT * FROM discovery_moderation_audit_events WHERE photo_id = $1`,
        [photoId],
      );
      expect(audit).toMatchObject({
        action: "approve",
        actor_id: "admin-1",
        before_status: "pending",
        after_status: "approved",
        request_correlation_id: correlationId,
      });
    });

    it("rejects an invalid reason code and writes no audit event or state change", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = randomUUID();
      const hubUserId = randomUUID();
      await pool.query(
        `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version)
         VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'pending', 'v1')`,
        [photoId, contributionId, hubUserId, partnerId],
      );

      const { rows: [result] } = await pool.query(
        `SELECT * FROM perform_visit_photo_transition($1, 'reject', 'not_a_real_reason', 'admin-1', 'corr-1')`,
        [photoId],
      );
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe("reason_required");

      const { rows: photoRows } = await pool.query(`SELECT moderation_status FROM merchant_visit_photos WHERE id = $1`, [photoId]);
      expect(photoRows[0].moderation_status).toBe("pending");
      const { rows: auditRows } = await pool.query(`SELECT 1 FROM discovery_moderation_audit_events WHERE photo_id = $1`, [photoId]);
      expect(auditRows).toHaveLength(0);
    });

    it("the audit table rejects mutation of an existing row", async () => {
      const { contributionId, partnerId } = await makeEligibleFixture();
      const photoId = randomUUID();
      const hubUserId = randomUUID();
      await pool.query(
        `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version)
         VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'pending', 'v1')`,
        [photoId, contributionId, hubUserId, partnerId],
      );
      await pool.query(`SELECT * FROM perform_visit_photo_transition($1, 'approve', NULL, 'admin-1', 'corr-2')`, [photoId]);

      await expect(
        pool.query(`UPDATE discovery_moderation_audit_events SET reason_code = 'tampered' WHERE photo_id = $1`, [photoId]),
      ).rejects.toThrow(/append-only/);
      await expect(
        pool.query(`DELETE FROM discovery_moderation_audit_events WHERE photo_id = $1`, [photoId]),
      ).rejects.toThrow(/append-only/);
    });

    it("rate-limits an actor performing more than 30 moderation actions in a minute", async () => {
      // A fresh contribution per photo — merchant_visit_photos caps three
      // non-rejected/withdrawn rows per contribution (082's
      // enforce_visit_photo_limit trigger), and every photo here gets
      // approved (an "active" status), so reusing one contribution across
      // 31 photos would hit that unrelated limit before the rate limit.
      const actorId = `rate-actor-${randomUUID()}`;
      let lastResult: { ok: boolean; error_code: string | null } | null = null;
      for (let i = 0; i < 31; i++) {
        const { contributionId, partnerId } = await makeEligibleFixture();
        const photoId = randomUUID();
        const hubUserId = randomUUID();
        await pool.query(
          `INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version)
           VALUES ($1, $2, $3, $4, 'src/key.jpg', 'thumb/key.webp', 'display/key.webp', 'pending', 'v1')`,
          [photoId, contributionId, hubUserId, partnerId],
        );
        const { rows: [result] } = await pool.query(
          `SELECT * FROM perform_visit_photo_transition($1, 'approve', NULL, $2, $3)`,
          [photoId, actorId, `corr-${i}`],
        );
        lastResult = result;
      }
      expect(lastResult?.ok).toBe(false);
      expect(lastResult?.error_code).toBe("rate_limited");
    });
  });

  describe("re-running the hardening migration (idempotency)", () => {
    it("applies cleanly a second time", async () => {
      const [file] = require("fs")
        .readdirSync(MIGRATIONS_DIR)
        .filter((name: string) => name.startsWith("090_"));
      await expect(
        pool.query(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8")),
      ).resolves.not.toThrow();
    });
  });
});
