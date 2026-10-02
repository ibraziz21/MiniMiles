#!/usr/bin/env node
// One-off performance verification for the verified-discovery canonical
// eligibility projection (verified-discovery-market-readiness-hardening-
// spec.md §9: "A load fixture with at least 100,000 contributions, 10,000
// photos and 1,000 merchants" and "the server-side spotlight data query has
// p95 below 250 ms"). Deliberately NOT part of `pnpm test`/`test:integration`
// — seeding 100k+ rows on every test run would make the regular suite slow
// for no ongoing benefit. Run by hand (or from a separate nightly job) when
// you want to re-verify the eligibility predicate's indexes still hold up:
//
//   node scripts/verified-discovery-perf-check.mjs
//
// Reuses the same disposable `hub_phase1_test` database the integration
// suite uses. It resets the schema before seeding and leaves the seeded
// data behind afterwards — harmless, since every integration test file
// drops and recreates the schema itself before it runs.
import pg from "pg";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: "hub_phase1_test",
};

const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");
const MIGRATION_NUMBERS = ["081", "082", "083", "084", "085", "086", "087", "088", "089", "090", "091", "092"];

const PARTNER_COUNT = 1000;
const CONTRIBUTION_COUNT = 100_000;
const PHOTO_COUNT = 10_000;
const P95_BUDGET_MS = 250;

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

async function applyMigrations(pool) {
  for (const number of MIGRATION_NUMBERS) {
    const [file] = readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith(`${number}_`));
    if (!file) throw new Error(`migration ${number} not found in ${MIGRATIONS_DIR}`);
    await pool.query(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
}

async function seed(pool) {
  console.log(`Seeding ${PARTNER_COUNT} merchants, ${CONTRIBUTION_COUNT} contributions, ${PHOTO_COUNT} photos...`);
  const start = Date.now();

  await pool.query(`
    INSERT INTO partners (id, name)
    SELECT gen_random_uuid(), 'Perf Merchant ' || i
    FROM generate_series(1, ${PARTNER_COUNT}) AS i;
  `);
  await pool.query(`INSERT INTO partner_settings (partner_id) SELECT id FROM partners;`);
  await pool.query(`
    INSERT INTO merchant_discovery_settings (partner_id, contributions_enabled, structured_proof_enabled, customer_photos_enabled)
    SELECT id, true, true, true FROM partners;
  `);
  await pool.query(`
    INSERT INTO discovery_question_templates (id, category_slug, version, recommendation_prompt, party_size_prompt, item_prompt, recommendation_item_prompt, photo_prompt, photo_safety_guidance)
    VALUES (gen_random_uuid(), 'perf-template', 1, 'Would you recommend?', 'Party size?', 'What did you get?', 'Which to try?', 'Add a photo', 'Avoid faces');
  `);

  // Bulk-generate contributions with a stable per-row ordinal so earning
  // events, requests and contributions can all be joined back together by
  // that ordinal instead of needing 100k round trips. Partners are assigned
  // via a join against a numbered CTE (not a per-row correlated subquery —
  // that would scan the 1,000-row partners table once per contribution).
  await pool.query(`
    CREATE TEMP TABLE perf_seed AS
    WITH numbered_partners AS (
      SELECT id, (row_number() OVER ()) - 1 AS idx FROM partners
    )
    SELECT
      i AS ordinal,
      np.id AS partner_id,
      gen_random_uuid() AS hub_user_id,
      gen_random_uuid() AS earning_event_id,
      gen_random_uuid() AS request_id,
      gen_random_uuid() AS contribution_id,
      now() - (random() * interval '120 days') AS submitted_at
    FROM generate_series(1, ${CONTRIBUTION_COUNT}) AS i
    JOIN numbered_partners np ON np.idx = (i % ${PARTNER_COUNT});
    CREATE INDEX ON perf_seed (partner_id);
  `);

  await pool.query(`
    INSERT INTO verified_earning_events (id, event_id, hub_user_id, partner_id, source, channel, occurred_at, verification_status)
    SELECT earning_event_id, 'perf-evt-' || ordinal, hub_user_id, partner_id, 'merchant_scan', 'in_store', submitted_at, 'active'
    FROM perf_seed;
  `);
  const { rows: [{ id: templateId }] } = await pool.query(
    `SELECT id FROM discovery_question_templates WHERE category_slug = 'perf-template' LIMIT 1;`,
  );
  await pool.query(`
    INSERT INTO discovery_contribution_requests (id, earning_event_id, hub_user_id, partner_id, template_id, template_version, template_snapshot, state, expires_at, submitted_at)
    SELECT request_id, earning_event_id, hub_user_id, partner_id, $1, 1, '{}'::jsonb, 'submitted', submitted_at + interval '14 days', submitted_at
    FROM perf_seed;
  `, [templateId]);
  await pool.query(`
    INSERT INTO merchant_discovery_contributions (id, request_id, hub_user_id, partner_id, would_recommend, experience_option_ids, submitted_at)
    SELECT contribution_id, request_id, hub_user_id, partner_id, true, '{}', submitted_at
    FROM perf_seed;
  `);
  await pool.query(`
    INSERT INTO merchant_visit_photos (id, contribution_id, hub_user_id, partner_id, private_source_key, thumbnail_key, display_key, moderation_status, consent_version, approved_at)
    SELECT gen_random_uuid(), contribution_id, hub_user_id, partner_id, 'src/' || ordinal || '.jpg', 'thumb/' || ordinal || '.webp', 'display/' || ordinal || '.webp', 'approved', 'v1', submitted_at
    FROM perf_seed
    WHERE ordinal % (${CONTRIBUTION_COUNT} / ${PHOTO_COUNT}) = 0;
  `);

  await pool.query(`ANALYZE partners, partner_settings, merchant_discovery_settings, verified_earning_events, discovery_contribution_requests, merchant_discovery_contributions, merchant_visit_photos;`);

  console.log(`Seed complete in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function timedExplain(pool, label, sql, params = []) {
  const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const plan = rows[0]["QUERY PLAN"][0];
  const timeMs = plan["Execution Time"];
  const usesSeqScan = JSON.stringify(plan).includes("Seq Scan");
  console.log(`\n--- ${label} ---`);
  console.log(`Execution time: ${timeMs.toFixed(1)}ms ${timeMs > P95_BUDGET_MS ? `(OVER the ${P95_BUDGET_MS}ms budget)` : "(within budget)"}`);
  console.log(`Sequential scan present: ${usesSeqScan ? "YES — investigate" : "no"}`);
  return { label, timeMs, usesSeqScan };
}

async function main() {
  const pool = new Pool(DB_CONFIG);
  try {
    console.log(`Connecting to ${DB_CONFIG.database}@${DB_CONFIG.host}:${DB_CONFIG.port}...`);
    await pool.query(SETUP_SQL);
    console.log("Applying migrations 081-092...");
    await applyMigrations(pool);
    await seed(pool);

    const { rows: [{ id: samplePartnerId }] } = await pool.query(`SELECT partner_id AS id FROM partner_settings LIMIT 1`);

    const results = [];
    results.push(await timedExplain(
      pool, "Spotlight: global eligible visits (uncapped, 90-day window)",
      `SELECT * FROM eligible_public_merchant_visits() WHERE submitted_at >= now() - interval '90 days'`,
    ));
    results.push(await timedExplain(
      pool, "Spotlight: global eligible photos",
      `SELECT * FROM eligible_public_merchant_visit_photos()`,
    ));
    results.push(await timedExplain(
      pool, "Merchant page: one partner's eligible visits",
      `SELECT * FROM eligible_public_merchant_visits($1)`, [samplePartnerId],
    ));
    results.push(await timedExplain(
      pool, "Merchant page: one partner's eligible photos",
      `SELECT * FROM eligible_public_merchant_visit_photos($1)`, [samplePartnerId],
    ));

    const overBudget = results.filter((r) => r.timeMs > P95_BUDGET_MS);
    const seqScans = results.filter((r) => r.usesSeqScan);
    console.log("\n=== Summary ===");
    console.log(`${results.length} quer(ies) run against ${PARTNER_COUNT} merchants / ${CONTRIBUTION_COUNT} contributions / ${PHOTO_COUNT} photos.`);
    console.log(overBudget.length === 0 ? "All queries within the 250ms budget." : `${overBudget.length} quer(ies) over budget: ${overBudget.map((r) => r.label).join(", ")}`);
    console.log(seqScans.length === 0 ? "No sequential scans." : `Sequential scan in: ${seqScans.map((r) => r.label).join(", ")}`);

    process.exitCode = overBudget.length > 0 || seqScans.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
