-- ─────────────────────────────────────────────────────────────────────────
-- Akiba Claw Game — Schema Migration v2
-- Removes plaintext reward_class and merkle_proof from claw_batch_plays.
-- Run this against your Supabase project after deploying the updated API.
--
-- IMPORTANT: This is a destructive migration. Back up data before running.
-- The old reward_class + merkle_proof columns are dropped because outcome
-- material is now derived server-side from the batch store, not Supabase.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1. Migrate claw_batch_plays ───────────────────────────────────────────
-- If you are applying this to an existing table, use ALTER TABLE.
-- If starting fresh, use the CREATE TABLE block below instead.

-- ── Option A: Alter existing table (production upgrade path) ─────────────
ALTER TABLE claw_batch_plays DROP COLUMN IF EXISTS reward_class;
ALTER TABLE claw_batch_plays DROP COLUMN IF EXISTS merkle_proof;

-- Add settlement status column to track relayer progress without re-reading chain
ALTER TABLE claw_batch_plays
  ADD COLUMN IF NOT EXISTS commit_status text NOT NULL DEFAULT 'pending'
    CHECK (commit_status IN ('pending', 'committed', 'claimed', 'failed'));

ALTER TABLE claw_batch_plays
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- Optional: add an index on commit_status to speed up the rotate cron
CREATE INDEX IF NOT EXISTS idx_claw_batch_plays_commit_status
  ON claw_batch_plays (commit_status);


-- ── Option B: Fresh table (use if starting from scratch) ──────────────────
-- Run this block INSTEAD of Option A if the table does not exist yet.
--
-- CREATE TABLE IF NOT EXISTS claw_batch_plays (
--   id             bigserial   PRIMARY KEY,
--   session_id     text        NOT NULL UNIQUE,
--   batch_id       text        NOT NULL,
--   play_index     bigint      NOT NULL,
--   commit_status  text        NOT NULL DEFAULT 'pending'
--                    CHECK (commit_status IN ('pending', 'committed', 'claimed', 'failed')),
--   created_at     timestamptz NOT NULL DEFAULT now(),
--   settled_at     timestamptz
-- );
-- CREATE INDEX IF NOT EXISTS idx_claw_batch_plays_session_id ON claw_batch_plays (session_id);
-- CREATE INDEX IF NOT EXISTS idx_claw_batch_plays_batch_id   ON claw_batch_plays (batch_id);
-- CREATE INDEX IF NOT EXISTS idx_claw_batch_plays_commit_status ON claw_batch_plays (commit_status);


-- ── 2. claw_settle_logs (unchanged — no migration needed) ─────────────────
-- This table is append-only and does not store outcome material.
-- No changes required.


-- ── 3. Row Level Security ─────────────────────────────────────────────────
-- Enable RLS so anon / authenticated roles cannot read batch assignment data.
-- The API routes use SUPABASE_SERVICE_KEY which bypasses RLS by design.

ALTER TABLE claw_batch_plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE claw_settle_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing permissive policies if any
DROP POLICY IF EXISTS "service_role_all" ON claw_batch_plays;
DROP POLICY IF EXISTS "service_role_all" ON claw_settle_logs;

-- No policies = no access for anon/authenticated roles.
-- Service role (used by server-side API) always bypasses RLS.
-- This means: the table is effectively server-only.


-- ── 4. Verification ───────────────────────────────────────────────────────
-- Run after migration to confirm schema:
--
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'claw_batch_plays'
--   ORDER BY ordinal_position;
--
-- Expected columns: id, session_id, batch_id, play_index,
--                   commit_status, created_at, settled_at
-- (reward_class and merkle_proof should NOT appear)
