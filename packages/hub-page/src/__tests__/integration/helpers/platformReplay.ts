/**
 * Replays migrations into a disposable database so financial assertions run
 * against the real Miles award chain rather than stubs that would only agree
 * with themselves.
 *
 * SCOPE, AND WHAT IS NOT PROVEN
 * -----------------------------
 * This replays the FULL Akiba-Platform history plus the three MiniMiles
 * migrations that make up the funded-voucher work (110, 112, 113). That set
 * applies cleanly, whole-file, with no partial application — 157 migrations,
 * with two documented skips that belong to other repositories.
 *
 * It does NOT replay MiniMiles' full migration history, because that history
 * is not self-contained: 001_voucher_platform_phase1.sql states its
 * prerequisites as tables that "must already exist in live Supabase"
 * (issued_vouchers, spend_voucher_templates, merchant_transactions,
 * merchant_products), created outside the migrations directory. 56 MiniMiles
 * migrations cannot apply from the repository alone and no ordering fixes
 * that — a retry-to-convergence pass makes zero progress on them.
 *
 * So what these suites prove is bounded: the voucher, funding and Miles
 * engine as Akiba-Platform defines it, plus the funded-voucher changes layered
 * on top. They do not prove behaviour of MiniMiles-side order, referral,
 * dispute or reconciliation migrations that touch the same tables. That is a
 * real verification gap, recorded in
 * docs/multi-merchant-funded-vouchers-launch-spec.md, and it is why a staging
 * run against a real database remains a launch requirement rather than a
 * formality.
 *
 * ORDER COMES FROM A REVIEWED MANIFEST, NOT FROM GIT
 * --------------------------------------------------
 * The two repositories number independently and deploy against one database
 * (docs/BDR-005), so filename order is not apply order. An earlier version
 * derived the order from each file's latest commit date; that is a proxy, not
 * evidence — `%cI` moves whenever an old migration is edited for an unrelated
 * reason, so the order could change silently without anyone touching this
 * file. The order now lives in `migration-order.json`: explicit, diffable,
 * reviewable, and drift-checked against what is on disk.
 *
 * ⚠️ THE MANIFEST IS NOT VERIFIED AGAINST PRODUCTION. Before these suites
 * count as evidence of production behaviour, the order must be reconciled
 * against the live database's applied-migration records and
 * MIGRATION_ORDER_VERIFIED_AGAINST_PRODUCTION flipped to true.
 */
import pg from "pg";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

export const REPO_ROOT = resolve(__dirname, "../../../../../..");
export const PLATFORM_ROOT = resolve(REPO_ROOT, "../Akiba-Platform");
export const PLATFORM_AVAILABLE = existsSync(PLATFORM_ROOT);

/**
 * False until the manifest has been reconciled with the live database's
 * applied-migration records. Suites surface this rather than implying the
 * replay order is proven.
 */
export const MIGRATION_ORDER_VERIFIED_AGAINST_PRODUCTION = false;

type ManifestEntry = { repo: "platform" | "minimiles"; file: string };

/**
 * Supabase-managed objects the migrations reference but never create. Kept
 * minimal and inert — anything that influenced voucher behaviour would
 * undermine the point of replaying the real history.
 */
const SUPABASE_SCAFFOLD = `
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
-- Mirror Supabase's broad public-relation defaults. Without this, local view
-- ACL tests can pass only because the dangerous production grants are absent.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT 'service_role'::text $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;

-- ── MEMBER-IDENTITY FIXTURES, NOT REPLAYED ─────────────────────────────────
-- These four tables are defined here rather than by their migrations, and
-- that is a real limit on what these suites prove.
--
-- The funded claim path reads all of them (country eligibility, pass
-- activation, the username recorded on a claim). They are created by
-- MiniMiles migrations that cannot apply from the repository alone, because
-- MiniMiles' history depends on a pre-existing live schema — so replaying
-- them is not an option and these shapes are hand-written.
--
-- What that does NOT touch: the voucher, funding and Miles engine. Every one
-- of issued_vouchers, spend_voucher_templates, voucher_funding_*,
-- voucher_redemptions, purchase_events, miles_ledger and
-- award_purchase_reward_v2 comes from the replayed Akiba-Platform history.
-- So the financial assertions run against real code; what is stubbed is who
-- the member is, not what happens to the money.
CREATE TABLE IF NOT EXISTS hub_user_canonicals (
  hub_user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  canonical_id uuid NOT NULL
);
-- Shape copied from MiniMiles 049 plus the columns 073/094 add, so the
-- replayed functions see the columns they actually read.
CREATE TABLE IF NOT EXISTS hub_user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country text,
  country_code text,
  phone text,
  phone_verified boolean NOT NULL DEFAULT false,
  city text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hub_user_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Legacy MiniMiles member table, still read by replayed identity triggers.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address text,
  wallet_address text,
  email text,
  country text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leaderboard_profiles (
  canonical_id uuid PRIMARY KEY,
  username text NOT NULL
);

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb
);
`;

/**
 * Migrations that cannot apply from the repositories alone, generated
 * alongside the order and committed as `migration-excluded.json`.
 *
 * These are not "allowed to fail" — they are never attempted, and the list is
 * explicit so nothing hides in it. The dominant cause is that MiniMiles'
 * migration history is not self-contained:
 * 001_voucher_platform_phase1.sql names its prerequisites as tables that
 * "must already exist in live Supabase" (issued_vouchers,
 * spend_voucher_templates, merchant_transactions, merchant_products), created
 * outside the migrations directory. A retry-to-convergence pass makes zero
 * progress on them, so no ordering fixes it.
 *
 * Several touch voucher, funding or Miles tables. That bounds what these
 * suites prove and is recorded as a verification gap in
 * docs/multi-merchant-funded-vouchers-launch-spec.md.
 */
function loadExclusions(): Array<{ repo: string; file: string; error: string }> {
  return JSON.parse(readFileSync(resolve(__dirname, "migration-excluded.json"), "utf8"));
}

export type ReplayReport = {
  applied: number;
  /** Failures NOT covered by EXPECTED_SKIPS. Suites must assert this is empty. */
  failures: Array<{ file: string; error: string }>;
  /** Files on disk missing from the manifest, or listed files no longer on disk. */
  manifestDrift: string[];
  /** Retained for callers; always empty now that exclusions are never attempted. */
  staleSkips: string[];
};

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    const count = (line.match(/\$\$/g) ?? []).length;
    buffer += line + "\n";
    if (count % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trimEnd().endsWith(";")) {
      if (buffer.trim()) out.push(buffer);
      buffer = "";
    }
  }
  if (buffer.trim()) out.push(buffer);
  return out;
}

async function applyFile(pool: pg.Pool, path: string): Promise<string | null> {
  const sql = readFileSync(path, "utf8");
  const client = await pool.connect();
  try {
    // One transaction per migration, with NO statement-level fallback. An
    // earlier version fell back to applying statements individually so a
    // single unsupported statement would not discard the rest — but that
    // partially applies a migration and leaves a schema matching no real
    // deployment, which is exactly how 56 unapplicable migrations once looked
    // like 7. A migration now either applies whole or not at all.
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    return null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return (error as Error).message;
  } finally {
    client.release();
  }
}

function rootFor(repo: ManifestEntry["repo"]): string {
  return repo === "platform" ? PLATFORM_ROOT : REPO_ROOT;
}

function loadManifest(): ManifestEntry[] {
  return JSON.parse(
    readFileSync(resolve(__dirname, "migration-order.json"), "utf8"),
  ) as ManifestEntry[];
}

/**
 * Files on disk the manifest does not list, or listed files that no longer
 * exist. A new migration must be placed in the manifest deliberately rather
 * than slotting itself in wherever a sort happens to put it.
 */
function detectManifestDrift(manifest: ManifestEntry[]): string[] {
  const drift: string[] = [];
  const accounted = new Set([
    ...manifest.map((m) => `${m.repo}/${m.file}`),
    ...loadExclusions().map((e) => `${e.repo}/${e.file}`),
  ]);

  for (const repo of ["platform", "minimiles"] as const) {
    const dir = resolve(rootFor(repo), "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      if (accounted.has(`${repo}/${file}`)) continue;
      drift.push(
        `${repo}/${file} is on disk but in neither migration-order.json nor migration-excluded.json — place it in one`,
      );
    }
  }
  for (const entry of manifest) {
    if (!existsSync(resolve(rootFor(entry.repo), "supabase/migrations", entry.file))) {
      drift.push(`${entry.repo}/${entry.file} is in migration-order.json but not on disk`);
    }
  }
  return drift;
}

export async function replayAll(dbName: string, adminConfig: pg.PoolConfig): Promise<{
  pool: pg.Pool;
  report: ReplayReport;
}> {
  const manifest = loadManifest();
  const manifestDrift = detectManifestDrift(manifest);

  const admin = new Pool(adminConfig);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ ...adminConfig, database: dbName });
  await pool.query(SUPABASE_SCAFFOLD);

  const report: ReplayReport = { applied: 0, failures: [], manifestDrift, staleSkips: [] };

  for (const entry of manifest) {
    const path = resolve(rootFor(entry.repo), "supabase/migrations", entry.file);
    if (!existsSync(path)) continue; // already reported as drift
    const error = await applyFile(pool, path);
    if (error) {
      // Every migration in the order is expected to apply. An exclusion
      // belongs in migration-excluded.json, where it is visible.
      report.failures.push({ file: `${entry.repo}/${entry.file}`, error });
    } else {
      report.applied += 1;
    }
  }

  return { pool, report };
}

/**
 * Functions the financial assertions depend on, each with a fragment its
 * CURRENT definition must contain.
 *
 * Existence alone proves nothing. If a migration that REPLACES a function
 * fails, the older definition survives under the same name — the suite would
 * pass while exercising the wrong code. Pinning a fragment of each body ties
 * the name to the version this work expects.
 */
const REQUIRED_DEFINITIONS: Record<string, string> = {
  // the widened merchant gate, Akiba-Platform 154
  redeem_kes_voucher_and_award_atomic: "voucher_redeemable_by_partner",
  inspect_kes_voucher_presentation: "voucher_redeemable_by_partner",
  // the shared gate itself
  voucher_redeemable_by_partner: "eligible_merchant_ids",
  // the eligible set
  voucher_allocation_eligible_merchants: "voucher_allocation_merchants",
  // set-wide new-customer rule, MiniMiles 113
  claim_akiba_funded_voucher_atomic: "voucher_allocation_eligible_merchants",
  // the real award chain rather than a stub
  award_purchase_reward_v2: "miles_ledger",
  // publication readiness, Akiba-Platform 156
  voucher_allocation_merchant_readiness: "partner_subscriptions",
};

/** Names absent entirely, or present only at an older definition. */
export async function assertAwardChainPresent(pool: pg.Pool): Promise<string[]> {
  const problems: string[] = [];
  for (const [name, fragment] of Object.entries(REQUIRED_DEFINITIONS)) {
    const { rows } = await pool.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname=$1",
      [name],
    );
    if (rows.length === 0) {
      problems.push(`${name} is missing`);
      continue;
    }
    if (!rows.some((row) => (row.def as string).includes(fragment))) {
      problems.push(
        `${name} exists but no definition contains "${fragment}" — a stale version survived a failed replacement`,
      );
    }
  }
  return problems;
}
