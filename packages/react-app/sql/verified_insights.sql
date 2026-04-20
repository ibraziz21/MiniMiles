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
  -- Future Self Protocol verification metadata
  verification_source     text,                  -- e.g. "self_protocol" or NULL
  trait_verification_status text                 -- e.g. "verified" / "unverified" / NULL
                CHECK (trait_verification_status IN ('verified', 'unverified', NULL)),
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_poll_responses_wallet  ON poll_responses (wallet_address);
CREATE INDEX IF NOT EXISTS idx_poll_responses_poll_id ON poll_responses (poll_id);


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


-- ── 8. Seed — Merchant / Voucher Launch Survey ───────────────────────────
-- One sample poll with a richer set of market-research questions
-- for the internal pilot.
-- Run this block once after the schema migration.

DO $$
DECLARE
  v_poll_id    uuid;
  v_q1_id      uuid;
  v_q2_id      uuid;
  v_q3_id      uuid;
  v_q4_id      uuid;
  v_q5_id      uuid;
  v_q6_id      uuid;
  v_q7_id      uuid;
  v_q8_id      uuid;
BEGIN
  -- Upsert poll so seed content can evolve during development.
  INSERT INTO polls (slug, title, description, reward_points, status)
  VALUES (
    'merchant-vouchers-launch-2026',
    'Merchant & Voucher Launch Survey',
    'Help shape Akiba''s upcoming merchant and voucher experience. Tell us how you shop, what discounts matter, and how delivery and redemption should work. Takes ~3 min.',
    50,
    'active'
  )
  ON CONFLICT (slug) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        reward_points = EXCLUDED.reward_points,
        status = EXCLUDED.status
  RETURNING id INTO v_poll_id;

  -- Clear existing seeded questions/options so reruns keep content in sync.
  DELETE FROM poll_questions WHERE poll_id = v_poll_id;

  -- Question 1: single choice
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 1, 'Which voucher reward would make you most likely to redeem with an Akiba merchant partner?', 'single_choice')
  RETURNING id INTO v_q1_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q1_id, 1, 'Percentage discount voucher'),
    (v_q1_id, 2, 'Fixed amount off voucher'),
    (v_q1_id, 3, 'Buy-one-get-one offer'),
    (v_q1_id, 4, 'Free delivery / convenience perk'),
    (v_q1_id, 5, 'Cashback in Akiba Miles');

  -- Question 2: single choice
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 2, 'What matters most when redeeming a voucher at a merchant?', 'single_choice')
  RETURNING id INTO v_q2_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q2_id, 1, 'Fast checkout and simple redemption'),
    (v_q2_id, 2, 'Big discount value'),
    (v_q2_id, 3, 'Long expiry window'),
    (v_q2_id, 4, 'Usable at many merchants'),
    (v_q2_id, 5, 'Clear terms with no surprises');

  -- Question 3: multi select (max 3 picks)
  INSERT INTO poll_questions (poll_id, position, question, kind, max_choices)
  VALUES (v_poll_id, 3, 'Which 3 merchant categories should Akiba prioritize first for vouchers?', 'multi_select', 3)
  RETURNING id INTO v_q3_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q3_id, 1, 'Supermarkets and groceries'),
    (v_q3_id, 2, 'Restaurants and cafes'),
    (v_q3_id, 3, 'Pharmacies and health shops'),
    (v_q3_id, 4, 'Transport and delivery'),
    (v_q3_id, 5, 'Airtime and utilities'),
    (v_q3_id, 6, 'Fashion and beauty'),
    (v_q3_id, 7, 'Electronics'),
    (v_q3_id, 8, 'Entertainment');

  -- Question 4: single choice
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 4, 'How much would you typically spend in one order if you had a strong Akiba voucher?', 'single_choice')
  RETURNING id INTO v_q4_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q4_id, 1, 'Under $5 / 5 USDT'),
    (v_q4_id, 2, '$5 - $10 / 5-10 USDT'),
    (v_q4_id, 3, '$11 - $25 / 11-25 USDT'),
    (v_q4_id, 4, '$26 - $50 / 26-50 USDT'),
    (v_q4_id, 5, 'Above $50 / 50+ USDT');

  -- Question 5: single choice
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 5, 'What is the maximum delivery fee you would pay for a discounted or free item ordered through Akiba?', 'single_choice')
  RETURNING id INTO v_q5_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q5_id, 1, 'I would only redeem if delivery is free'),
    (v_q5_id, 2, 'Up to $1 / 1 USDT'),
    (v_q5_id, 3, 'Up to $2 / 2 USDT'),
    (v_q5_id, 4, 'Up to $5 / 5 USDT'),
    (v_q5_id, 5, 'I prefer pickup instead of paying delivery');

  -- Question 6: single choice
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 6, 'What minimum discount would make a voucher feel worth using?', 'single_choice')
  RETURNING id INTO v_q6_id;

  INSERT INTO poll_options (question_id, position, label) VALUES
    (v_q6_id, 1, '5% off'),
    (v_q6_id, 2, '10% off'),
    (v_q6_id, 3, '15% off'),
    (v_q6_id, 4, '20% off'),
    (v_q6_id, 5, 'I care more about a fixed cash amount than a percentage');

  -- Question 7: short text
  INSERT INTO poll_questions (poll_id, position, question, kind)
  VALUES (v_poll_id, 7, 'If Akiba launched merchant vouchers next month, what would make you trust and use them regularly?', 'short_text')
  RETURNING id INTO v_q7_id;

  RAISE NOTICE 'Seed complete — poll id: %', v_poll_id;
END
$$;
