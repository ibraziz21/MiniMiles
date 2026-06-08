-- ================================================================
-- Performance indexes — fixes upstream request timeout errors
-- Run in Supabase SQL editor
-- Each CREATE INDEX works inside a transaction (no CONCURRENTLY)
-- ================================================================

-- ── skill_game_sessions (leaderboard) ────────────────────────────
-- Query: game_type = ? AND accepted = true AND created_at BETWEEN ? ORDER BY score DESC
CREATE INDEX IF NOT EXISTS idx_sgs_leaderboard
  ON skill_game_sessions (game_type, accepted, created_at, score DESC)
  WHERE accepted = true;

-- ── crackpot_cycles ───────────────────────────────────────────────
-- Query: status = 'active' AND version = ?
CREATE INDEX IF NOT EXISTS idx_crackpot_cycles_active_version
  ON crackpot_cycles (status, version)
  WHERE status = 'active';

-- ── crackpot_attempts ─────────────────────────────────────────────
-- Query: cycle_id = ? AND player_address = ? ORDER BY attempt_number
CREATE INDEX IF NOT EXISTS idx_crackpot_attempts_cycle_player
  ON crackpot_attempts (cycle_id, player_address, attempt_number);

-- ── crackpot_guesses ──────────────────────────────────────────────
-- Query A: attempt_id = ? ORDER BY guess_number
CREATE INDEX IF NOT EXISTS idx_crackpot_guesses_attempt
  ON crackpot_guesses (attempt_id, guess_number);

-- Query B: cycle_id = ? AND player_address = ? (best guess count)
CREATE INDEX IF NOT EXISTS idx_crackpot_guesses_cycle_player
  ON crackpot_guesses (cycle_id, player_address);

-- ── users ─────────────────────────────────────────────────────────
-- user_address is likely already indexed via unique constraint,
-- but make sure it exists explicitly for the upsert + select pattern
CREATE INDEX IF NOT EXISTS idx_users_address
  ON users (user_address);

-- ── minipoint_mint_jobs ───────────────────────────────────────────
-- Query: user_address = ? AND status IN (?) AND created_at >= ?
CREATE INDEX IF NOT EXISTS idx_mint_jobs_user_status
  ON minipoint_mint_jobs (user_address, status, created_at DESC);

-- ── daily_engagements ─────────────────────────────────────────────
-- Query: user_address = ? AND quest_id IN (?) AND claimed_at BETWEEN ?
CREATE INDEX IF NOT EXISTS idx_daily_engagements_user_date
  ON daily_engagements (user_address, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_engagements_quest
  ON daily_engagements (quest_id, claimed_at DESC);

-- ── matchmaking_queue ─────────────────────────────────────────────
-- Query: mode_key = ? AND status = 'waiting' ORDER BY queued_at
CREATE INDEX IF NOT EXISTS idx_mmqueue_lookup
  ON matchmaking_queue (mode_key, status, queued_at)
  WHERE status = 'waiting';

-- ── streaks ───────────────────────────────────────────────────────
-- Query: user_address = ? AND quest_id IN (?)
CREATE INDEX IF NOT EXISTS idx_streaks_user_quest
  ON streaks (user_address, quest_id);

-- ── partner_engagements ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_partner_eng_user
  ON partner_engagements (user_address, partner_quest_id);

-- ── referrals ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_referrals_referred
  ON referrals (referred_address);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals (referrer_address);
