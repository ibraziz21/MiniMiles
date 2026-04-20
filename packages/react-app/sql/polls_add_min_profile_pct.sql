-- Migration: add min_profile_pct to polls
-- Adds a profile-completion gate to each poll.
--
-- Thresholds:
--   0   — no gate (informational / zero-point polls)
--   50  — standard reward-bearing survey (default for new polls)
--   100 — premium / partner-facing surveys
--
-- Run this against the production database once.

ALTER TABLE polls
  ADD COLUMN IF NOT EXISTS min_profile_pct integer NOT NULL DEFAULT 50
    CHECK (min_profile_pct >= 0 AND min_profile_pct <= 100);

-- Back-fill existing polls: reward-bearing polls get the 50% gate,
-- zero-point polls remain open (0).
UPDATE polls
SET min_profile_pct = CASE
  WHEN reward_points > 0 THEN 50
  ELSE 0
END;

COMMENT ON COLUMN polls.min_profile_pct IS
  'Minimum profile completion % (0–100) required to earn a reward from this poll. '
  '0 = no gate. 50 = standard. 100 = premium/partner.';
