-- ─────────────────────────────────────────────────────────────────────────
-- Verified Insights — Schema
-- Merchant / voucher launch survey feature.
--
-- Designed to support future Self Protocol ZK-verified traits by including
-- verification_source and trait_verification_status placeholder columns.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1. polls ─────────────────────────────────────────────────────────────
-- One row per poll campaign (e.g. a merchant / voucher launch survey).

CREATE TABLE IF NOT EXISTS polls (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        NOT NULL UNIQUE,          -- e.g. "akiba-census-q1-2026"
  title           text        NOT NULL,
  description     text,
  reward_points   int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'closed')),
  -- Targeting: future audience rules live in poll_audience_rules.
  -- Simple built-in gates are columns here for MVP.
  require_session bool        NOT NULL DEFAULT true,
  require_country text,          -- ISO-3166-1 alpha-2 or NULL (any)
  require_stablecoin_holder bool NOT NULL DEFAULT false,
  -- Future Self Protocol gate placeholders
  require_verification_source text,        -- e.g. "self_protocol", NULL = none
  require_trait_verified_age   bool NOT NULL DEFAULT false,
  require_trait_verified_country bool NOT NULL DEFAULT false,
  --
  starts_at       timestamptz,
  ends_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polls_status ON polls (status);
CREATE INDEX IF NOT EXISTS idx_polls_slug   ON polls (slug);


-- ── 2. poll_questions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS poll_questions (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     uuid    NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  position    int     NOT NULL DEFAULT 0,
  question    text    NOT NULL,
  kind        text    NOT NULL
                CHECK (kind IN ('single_choice', 'multi_select', 'short_text')),
  required    bool    NOT NULL DEFAULT true,
  -- For multi_select: max number of choices allowed (NULL = unlimited)
  max_choices int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poll_questions_poll_id ON poll_questions (poll_id, position);


-- ── 3. poll_options ──────────────────────────────────────────────────────
-- Rows only for single_choice / multi_select questions.

CREATE TABLE IF NOT EXISTS poll_options (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid    NOT NULL REFERENCES poll_questions (id) ON DELETE CASCADE,
  position    int     NOT NULL DEFAULT 0,
  label       text    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poll_options_question_id ON poll_options (question_id, position);


-- ── 4. poll_responses ────────────────────────────────────────────────────
-- One row per wallet per poll. UNIQUE enforces single submission.

CREATE TABLE IF NOT EXISTS poll_responses (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id                 uuid        NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  wallet_address          text        NOT NULL,   -- lowercase 0x…
  reward_queued           bool        NOT NULL DEFAULT false,
  reward_points_awarded   int,
  accepted_terms          bool        NOT NULL DEFAULT false,
  terms_version           text,
  accepted_terms_at       timestamptz,
  -- Future Self Protocol verification metadata
  verification_source     text,                  -- e.g. "self_protocol" or NULL
  trait_verification_status text                 -- e.g. "verified" / "unverified" / NULL
                CHECK (trait_verification_status IN ('verified', 'unverified', NULL)),
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_poll_responses_wallet  ON poll_responses (wallet_address);
CREATE INDEX IF NOT EXISTS idx_poll_responses_poll_id ON poll_responses (poll_id);

-- Existing environments may already have poll_responses from an earlier draft.
ALTER TABLE poll_responses
  ADD COLUMN IF NOT EXISTS accepted_terms bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz;


-- ── 5. poll_response_answers ─────────────────────────────────────────────
-- Individual answers per question within a response.
-- For single_choice: one row with selected_option_id set.
-- For multi_select:  one row per selected option.
-- For short_text:    one row with text_answer set.

CREATE TABLE IF NOT EXISTS poll_response_answers (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id        uuid    NOT NULL REFERENCES poll_responses (id) ON DELETE CASCADE,
  question_id        uuid    NOT NULL REFERENCES poll_questions (id) ON DELETE CASCADE,
  selected_option_id uuid    REFERENCES poll_options (id) ON DELETE SET NULL,
  text_answer        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poll_response_answers_response_id ON poll_response_answers (response_id);


-- ── 6. poll_audience_rules ───────────────────────────────────────────────
-- Extensible targeting rules attached to a poll.
-- MVP: unused — targeting is handled by simple columns on polls.
-- Future: add rows here for verified demographic segments, spending tiers, etc.

CREATE TABLE IF NOT EXISTS poll_audience_rules (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     uuid    NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  rule_kind   text    NOT NULL,   -- e.g. "country_in", "age_band", "spending_tier"
  rule_value  jsonb   NOT NULL,   -- flexible payload per rule_kind
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poll_audience_rules_poll_id ON poll_audience_rules (poll_id);


-- ── 7. Row Level Security ────────────────────────────────────────────────
-- Follow the same server-only pattern as claw_batch_plays.
-- All reads/writes go through API routes using SUPABASE_SERVICE_KEY.
-- Anon / authenticated roles have zero access to raw response data.

ALTER TABLE polls                ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_responses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_response_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_audience_rules  ENABLE ROW LEVEL SECURITY;

-- Drop any accidental permissive policies
DROP POLICY IF EXISTS "service_role_all" ON polls;
DROP POLICY IF EXISTS "service_role_all" ON poll_questions;
DROP POLICY IF EXISTS "service_role_all" ON poll_options;
DROP POLICY IF EXISTS "service_role_all" ON poll_responses;
DROP POLICY IF EXISTS "service_role_all" ON poll_response_answers;
DROP POLICY IF EXISTS "service_role_all" ON poll_audience_rules;

-- No policies defined → anon/authenticated roles cannot access.
-- Service role (server-side API) bypasses RLS by design.


-- ── 8. Seed — Akiba Verified Insights Poll v1 ─────────────────────────────
-- One production-ready poll that captures demographics, reward preferences,
-- merchant/voucher demand, game direction, Dice feedback, and claw/voucher
-- validation.
-- Run this block once after the schema migration.

DO $$
DECLARE
  v_poll_id    uuid;
  v_q_id       uuid;
BEGIN
  -- Retire the older seed campaign so only this v1 poll is active by default.
  UPDATE polls
  SET status = 'closed', updated_at = now()
  WHERE slug = 'merchant-vouchers-launch-2026';

  -- Upsert poll so seed content can evolve during development.
  INSERT INTO polls (slug, title, description, reward_points, status)
  VALUES (
    'akiba-verified-insights-v1',
    'Akiba Verified Insights Poll',
    'Help shape Akiba''s vouchers, games, rewards, and next product direction. Takes about 3 minutes.',
    50,
    'active'
  )
  ON CONFLICT (slug) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        reward_points = EXCLUDED.reward_points,
        status = EXCLUDED.status
  RETURNING id INTO v_poll_id;

  -- Safely reseed questions/options ONLY when no responses exist yet.
  -- Once real submissions exist, DELETE FROM poll_questions would cascade to
  -- poll_response_answers via ON DELETE CASCADE and permanently destroy survey
  -- data. In that case, skip the content update and raise a notice instead.
  -- To update questions on a live poll: close the old poll (status='closed'),
  -- create a new poll with a versioned slug, and seed the new one.
  IF EXISTS (SELECT 1 FROM poll_responses WHERE poll_id = v_poll_id LIMIT 1) THEN
    RAISE NOTICE 'Seed skipped for poll % — responses already exist. To change questions, create a new poll slug.', v_poll_id;
    RETURN;
  END IF;

  -- No responses yet — safe to clear and reseed questions/options.
  DELETE FROM poll_questions WHERE poll_id = v_poll_id;

  -- Question 1: age group
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 1, 'Which age group are you in?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, '18-24'),
    (v_q_id, 2, '25-34'),
    (v_q_id, 3, '35-44'),
    (v_q_id, 4, '45+'),
    (v_q_id, 5, 'Prefer not to say');

  -- Question 2: country
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 2, 'Which country are you currently based in?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Kenya'),
    (v_q_id, 2, 'Nigeria'),
    (v_q_id, 3, 'Ghana'),
    (v_q_id, 4, 'Uganda'),
    (v_q_id, 5, 'Tanzania'),
    (v_q_id, 6, 'South Africa'),
    (v_q_id, 7, 'Other');

  -- Question 3: reward preference
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 3, 'What type of rewards are most useful to you?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Cash / stablecoins'),
    (v_q_id, 2, 'Airtime or data'),
    (v_q_id, 3, 'Grocery discounts'),
    (v_q_id, 4, 'Food / restaurant vouchers'),
    (v_q_id, 5, 'Transport discounts'),
    (v_q_id, 6, 'Electronics / gadget raffles'),
    (v_q_id, 7, 'AkibaMiles points');

  -- Question 4: referral motivation
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 4, 'What reward would make you invite friends?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'USDT bonus'),
    (v_q_id, 2, 'AkibaMiles bonus'),
    (v_q_id, 3, 'Voucher reward'),
    (v_q_id, 4, 'Free game entries'),
    (v_q_id, 5, 'Raffle tickets');

  -- Question 5: voucher type
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 5, 'Which voucher type would make you most likely to use an Akiba merchant?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Fixed amount off'),
    (v_q_id, 2, 'Percentage discount'),
    (v_q_id, 3, 'Buy-one-get-one'),
    (v_q_id, 4, 'Free delivery'),
    (v_q_id, 5, 'Cashback in AkibaMiles'),
    (v_q_id, 6, 'Mystery reward');

  -- Question 6: merchant categories
  INSERT INTO poll_questions (poll_id, position, question, kind, max_choices)
  VALUES (v_poll_id, 6, 'What merchant categories should Akiba prioritize?', 'multi_select', 3)
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Groceries / supermarkets'),
    (v_q_id, 2, 'Restaurants / cafes'),
    (v_q_id, 3, 'Airtime / data'),
    (v_q_id, 4, 'Transport / delivery'),
    (v_q_id, 5, 'Electronics'),
    (v_q_id, 6, 'Fashion / beauty'),
    (v_q_id, 7, 'Pharmacies / health');

  -- Question 7: voucher blocker
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 7, 'What would stop you from using a voucher?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Voucher value is too low'),
    (v_q_id, 2, 'Merchant is too far'),
    (v_q_id, 3, 'Redemption is confusing'),
    (v_q_id, 4, 'Too many conditions'),
    (v_q_id, 5, 'I prefer cash rewards'),
    (v_q_id, 6, 'I do not trust the merchant');

  -- Question 8: skill games
  INSERT INTO poll_questions (poll_id, position, question, kind, max_choices)
  VALUES (v_poll_id, 8, 'Which skill-based games would you play most?', 'multi_select', 2)
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Click Tile (fast tapping)'),
    (v_q_id, 2, 'Memory Match'),
    (v_q_id, 3, 'Flappy-style game'),
    (v_q_id, 4, 'Subway runner'),
    (v_q_id, 5, 'Trivia / quiz'),
    (v_q_id, 6, 'Prediction game');

  -- Question 9: game reward style
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 9, 'What reward style motivates you most in games?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Stablecoin prizes'),
    (v_q_id, 2, 'Winner-takes-all pools'),
    (v_q_id, 3, 'Guaranteed small rewards'),
    (v_q_id, 4, 'Leaderboards'),
    (v_q_id, 5, 'Voucher rewards'),
    (v_q_id, 6, 'Raffle entries');

  -- Question 10: weather prediction game
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 10, 'Would you play a monthly prediction game (10 Miles entry, 20 Miles if correct, plus prizes)?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Yes, definitely'),
    (v_q_id, 2, 'Maybe (if prizes are good)'),
    (v_q_id, 3, 'Maybe (if simple to understand)'),
    (v_q_id, 4, 'No, prefer fast games');

  -- Question 11: Dice feedback
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 11, 'What is the biggest issue with Dice today?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Waiting for players'),
    (v_q_id, 2, 'Slow result / randomness'),
    (v_q_id, 3, 'Prize not attractive'),
    (v_q_id, 4, 'Entry cost too high'),
    (v_q_id, 5, 'Do not trust results'),
    (v_q_id, 6, 'Do not understand it');

  -- Question 12: claw voucher game
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 12, 'Would you play a claw-style game for vouchers?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Yes'),
    (v_q_id, 2, 'Maybe (if cheap)'),
    (v_q_id, 3, 'Maybe (if vouchers are useful)'),
    (v_q_id, 4, 'No');

  -- Question 13: product direction
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 13, 'Which feature should Akiba build next?', 'single_choice')
  RETURNING id INTO v_q_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q_id, 1, 'Merchant vouchers'),
    (v_q_id, 2, 'More skill games'),
    (v_q_id, 3, 'Improve Dice'),
    (v_q_id, 4, 'Claw voucher game'),
    (v_q_id, 5, 'Better rewards marketplace'),
    (v_q_id, 6, 'Leaderboards');

  -- Question 14: open insight
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 14, 'If you could change one thing about Akiba, what would it be?', 'short_text')
  RETURNING id INTO v_q_id;

  RAISE NOTICE 'Seed complete — Akiba Verified Insights Poll v1 id: %', v_poll_id;
END
$$;
