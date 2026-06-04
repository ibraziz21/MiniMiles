-- ─────────────────────────────────────────────────────────────────────────
-- Akiba Claw Game — Required Supabase Tables
-- Run in Supabase SQL editor (Settings → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1. claw_batch_plays ───────────────────────────────────────────────────
-- Each row maps one on-chain session to its pre-generated outcome in a batch.
-- Written by the backend when a batch is opened and assigned to a session.
-- Read by /api/claw/settle to build the Merkle proof for commitOutcome().

CREATE TABLE IF NOT EXISTS claw_batch_plays (
  id              bigserial        PRIMARY KEY,

  -- On-chain session id (uint256 from AkibaClawGame.nextSessionId)
  session_id      text             NOT NULL UNIQUE,

  -- Batch this play belongs to (matches MerkleBatchRng.activeBatchId at play time)
  batch_id        text             NOT NULL,

  -- Index of this play within the batch (0-based, used for Merkle leaf construction)
  play_index      bigint           NOT NULL,

  -- Reward class assigned to this slot:
  --   0 = NONE, 1 = LOSE, 2 = COMMON, 3 = RARE, 4 = EPIC, 5 = LEGENDARY
  reward_class    smallint         NOT NULL CHECK (reward_class BETWEEN 0 AND 5),

  -- Merkle proof: JSON array of bytes32 hex strings, e.g. ["0xabc...", "0xdef..."]
  merkle_proof    jsonb            NOT NULL DEFAULT '[]',

  -- Timestamps
  created_at      timestamptz      NOT NULL DEFAULT now(),
  settled_at      timestamptz
);

-- Index for fast settle lookups by session
CREATE INDEX IF NOT EXISTS idx_claw_batch_plays_session_id
  ON claw_batch_plays (session_id);

-- Index for batch-level queries (rotate/ensure)
CREATE INDEX IF NOT EXISTS idx_claw_batch_plays_batch_id
  ON claw_batch_plays (batch_id);


-- ── 2. claw_settle_logs ───────────────────────────────────────────────────
-- Append-only audit log for every step the relayer takes when settling a session.
-- Stages: load_play | commit_outcome | claim_reward | unexpected
-- Written by /api/claw/settle (and /api/claw/rotate on retries).

CREATE TABLE IF NOT EXISTS claw_settle_logs (
  id              bigserial        PRIMARY KEY,

  -- Session being settled
  session_id      text             NOT NULL,

  -- Stage within the settle flow
  stage           text             NOT NULL,
  -- e.g. "load_play", "commit_outcome", "claim_reward", "autoclaim", "unexpected"

  -- Free-text detail: tx hash on success, error message on failure
  detail          text,

  -- Whether this stage succeeded
  success         boolean          NOT NULL DEFAULT false,

  created_at      timestamptz      NOT NULL DEFAULT now()
);

-- Index for per-session log tailing
CREATE INDEX IF NOT EXISTS idx_claw_settle_logs_session_id
  ON claw_settle_logs (session_id);

-- Index for failure monitoring queries
CREATE INDEX IF NOT EXISTS idx_claw_settle_logs_success
  ON claw_settle_logs (success, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────
-- Optional: Row Level Security
-- If you use RLS on other tables, mirror the pattern here.
-- Service role (SUPABASE_SERVICE_KEY) bypasses RLS, so the API routes
-- will work without enabling it. Only enable if you want anon reads too.
-- ─────────────────────────────────────────────────────────────────────────

-- ALTER TABLE claw_batch_plays ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE claw_settle_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (already granted by default in Supabase)
-- CREATE POLICY "service_role_all" ON claw_batch_plays FOR ALL USING (true);
-- CREATE POLICY "service_role_all" ON claw_settle_logs FOR ALL USING (true);


-- ─────────────────────────────────────────────────────────────────────────
-- Quick verification queries (run after creating tables)
-- ─────────────────────────────────────────────────────────────────────────

-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('claw_batch_plays', 'claw_settle_logs');

-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'claw_batch_plays'
--   ORDER BY ordinal_position;

-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'claw_settle_logs'
--   ORDER BY ordinal_position;
