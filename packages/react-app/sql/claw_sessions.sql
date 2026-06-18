-- ─────────────────────────────────────────────────────────────────────────
-- Akiba Claw Game — App-owned session index
--
-- Stores only the session IDs needed by the app UI and server recovery paths.
-- On-chain AkibaClawGame.getSession(session_id) remains the source of truth
-- for status, rewards, and voucher IDs.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claw_sessions (
  id          bigserial   PRIMARY KEY,
  session_id  text        NOT NULL UNIQUE,
  player      text        NOT NULL,
  tier_id     smallint    NOT NULL,
  tx_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claw_sessions_player
  ON claw_sessions (player);

CREATE INDEX IF NOT EXISTS idx_claw_sessions_created_at
  ON claw_sessions (created_at DESC);

ALTER TABLE claw_sessions ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon/authenticated roles.
-- Server routes use SUPABASE_SERVICE_KEY, which bypasses RLS.
