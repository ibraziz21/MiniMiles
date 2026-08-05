-- 053_referral_system.sql
-- Akiba Pass referral system (referral-system-spec.md) — Phase 0 core:
-- program policy, codes, anonymous clicks, bound referrals, reward jobs,
-- audit/risk tables, kill switches, and the atomic RPCs that bind a
-- referral at Pass creation, qualify activation from a completed purchase
-- or eligible voucher redemption, and run the leased reward-release
-- worker. Follows the same conventions as create_or_get_hub_pass
-- (044_internal_event_outbox.sql), the internal-event-jobs lease worker
-- (052_hub_quest_event_worker_leases.sql) and check_rate_limit
-- (050_shared_rate_limit_primitive.sql).
--
-- Tables are named hub_referral_codes / hub_referrals, not the shorter
-- referral_codes / referrals the spec's own §5 headings use — both plain
-- names already exist in production as an older, unrelated wallet-address-
-- keyed referral mechanism (user_address/referrer_address/referred_address
-- columns, no id/status/hub_user_id). This migration never touches those
-- legacy tables; every RPC/view/index below consistently uses the hub_
-- prefixed names instead, matching this schema's existing convention for
-- Hub-owned tables (hub_user_passes, hub_user_wallets, hub_user_risk_flags).
--
-- Not in this migration (spec sections deliberately deferred to a later
-- pass — see build order §19 steps 8/10): admin review-queue UI and the
-- §10.2/§10.3 soft risk-scoring/velocity engine (only the explicit §10.1
-- hard blocks are implemented here).
--
-- redeem_voucher_in_store_atomic (merchant-dashboard's in-store scan path)
-- is extended near the end of this file to surface hub_user_id/
-- gross_amount_cusd/referral_qualifying so that app's TS caller can convert
-- to KES with its own USD_TO_KES rate and call qualify_referral_activation
-- as a follow-up — the conversion itself stays in TS, matching how
-- orders/route.ts already does `Math.round(paidAmountUsd * usdRate)`
-- rather than duplicating a currency rate inside SQL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════
-- §5.1 Program policy
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_program_versions (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version                      integer     NOT NULL,
  status                       text        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  signup_reward_miles          integer     NOT NULL,
  activation_reward_miles      integer     NOT NULL,
  attribution_window_days      integer     NOT NULL,
  activation_window_days       integer     NOT NULL,
  signup_hold_hours            integer     NOT NULL,
  activation_hold_hours        integer     NOT NULL,
  min_purchase_kes             integer     NOT NULL,
  daily_signup_cap             integer     NOT NULL,
  rolling_30_day_referral_cap  integer     NOT NULL,
  total_budget_miles           bigint      NOT NULL,
  reserved_budget_miles        bigint      NOT NULL DEFAULT 0,
  released_budget_miles        bigint      NOT NULL DEFAULT 0,
  starts_at                    timestamptz NOT NULL DEFAULT now(),
  ends_at                      timestamptz,
  rules                        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by                   uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  published_at                 timestamptz,

  UNIQUE (version),
  CHECK (signup_reward_miles > 0 AND activation_reward_miles > 0),
  CHECK (attribution_window_days > 0 AND activation_window_days > 0),
  CHECK (signup_hold_hours >= 0 AND activation_hold_hours >= 0),
  CHECK (min_purchase_kes >= 0),
  CHECK (daily_signup_cap > 0 AND rolling_30_day_referral_cap > 0),
  CHECK (total_budget_miles >= 0),
  CHECK (reserved_budget_miles >= 0 AND released_budget_miles >= 0),
  CHECK (reserved_budget_miles + released_budget_miles <= total_budget_miles)
);

-- At most one version is 'active' — a unique index on a constant-valued
-- predicate column allows only one row where it matches.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_program_versions_single_active
  ON referral_program_versions (status) WHERE status = 'active';

ALTER TABLE referral_program_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referral_program_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON referral_program_versions TO service_role;

-- An active/paused/ended version's financial terms are immutable — once
-- published, pausing must not reopen the window to edit terms/rules (a
-- referral already bound to this version is permanently pinned to what its
-- rules said at bind time; letting a paused version's rules change would
-- retroactively change what an already-bound referral is being scored
-- against). Only status itself may keep moving between these three, and
-- the running budget counters may keep changing as jobs progress.
CREATE OR REPLACE FUNCTION enforce_referral_program_version_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('active', 'paused', 'ended') THEN
    IF NEW.status NOT IN ('active', 'paused', 'ended') THEN
      RAISE EXCEPTION 'referral_program_versions: invalid status transition' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.signup_reward_miles          IS DISTINCT FROM OLD.signup_reward_miles OR
       NEW.activation_reward_miles      IS DISTINCT FROM OLD.activation_reward_miles OR
       NEW.attribution_window_days      IS DISTINCT FROM OLD.attribution_window_days OR
       NEW.activation_window_days       IS DISTINCT FROM OLD.activation_window_days OR
       NEW.signup_hold_hours            IS DISTINCT FROM OLD.signup_hold_hours OR
       NEW.activation_hold_hours        IS DISTINCT FROM OLD.activation_hold_hours OR
       NEW.min_purchase_kes             IS DISTINCT FROM OLD.min_purchase_kes OR
       NEW.daily_signup_cap             IS DISTINCT FROM OLD.daily_signup_cap OR
       NEW.rolling_30_day_referral_cap  IS DISTINCT FROM OLD.rolling_30_day_referral_cap OR
       NEW.total_budget_miles           IS DISTINCT FROM OLD.total_budget_miles OR
       NEW.starts_at                    IS DISTINCT FROM OLD.starts_at OR
       NEW.rules                        IS DISTINCT FROM OLD.rules
    THEN
      RAISE EXCEPTION 'referral_program_versions: financial settings are immutable once active/paused/ended' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_program_versions_immutable ON referral_program_versions;
CREATE TRIGGER trg_referral_program_versions_immutable
  BEFORE UPDATE ON referral_program_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_referral_program_version_immutability();

-- Seed a draft policy with zero public budget (spec §16 Phase 0) using the
-- locked launch defaults from §2.1. An operator publishes it (status ->
-- 'active', a real total_budget_miles) once Finance/Risk sign off — no
-- admin UI ships in this pass, so that's a direct SQL UPDATE for now.
INSERT INTO referral_program_versions (
  version, status, signup_reward_miles, activation_reward_miles,
  attribution_window_days, activation_window_days,
  signup_hold_hours, activation_hold_hours, min_purchase_kes,
  daily_signup_cap, rolling_30_day_referral_cap, total_budget_miles
) VALUES (
  1, 'draft', 50, 100,
  30, 30,
  24, 24 * 7, 200,
  3, 10, 0
)
ON CONFLICT (version) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- §11.4 Kill switches — independent controls, no admin UI yet so an
-- operator flips these with a direct SQL UPDATE until one ships.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_system_flags (
  key         text        PRIMARY KEY,
  enabled     boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

INSERT INTO referral_system_flags (key, enabled) VALUES
  ('accept_clicks', true),
  ('bind_referrals', true),
  ('qualify_activations', true),
  ('release_rewards', true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE referral_system_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referral_system_flags FROM PUBLIC, anon, authenticated;
GRANT ALL ON referral_system_flags TO service_role;

CREATE OR REPLACE FUNCTION referral_flag_enabled(p_key text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT enabled FROM referral_system_flags WHERE key = p_key), true);
$$;

REVOKE ALL ON FUNCTION referral_flag_enabled(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION referral_flag_enabled(text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §5.2 Referral codes
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_referral_codes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'rotated', 'disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz,
  disabled_reason text,

  UNIQUE (code)
);

-- One active code per user. Codes are stored upper-cased; callers normalize
-- (upper + trim) before every lookup so matching stays case-insensitive
-- without a citext dependency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_one_active_per_user
  ON hub_referral_codes (hub_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_referral_codes_hub_user ON hub_referral_codes (hub_user_id);

ALTER TABLE hub_referral_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_referral_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON hub_referral_codes TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §5.3 Anonymous referral clicks
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_clicks (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id      uuid        NOT NULL REFERENCES hub_referral_codes(id),
  program_version_id    uuid        NOT NULL REFERENCES referral_program_versions(id),
  token_hash            text        NOT NULL,
  ip_hash               text,
  device_hash           text,
  user_agent_family     text,
  landing_path          text,
  status                text        NOT NULL DEFAULT 'accepted'
                          CHECK (status IN ('accepted', 'replaced', 'bound', 'expired', 'blocked')),
  accepted_at           timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  bound_at              timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_status_expiry ON referral_clicks (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_code ON referral_clicks (referral_code_id);

ALTER TABLE referral_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referral_clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON referral_clicks TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §5.4 Bound referrals (hub_referrals)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_referrals (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  program_version_id        uuid        NOT NULL REFERENCES referral_program_versions(id),
  referral_code_id          uuid        NOT NULL REFERENCES hub_referral_codes(id),
  referral_click_id         uuid        NOT NULL REFERENCES referral_clicks(id),
  referrer_user_id          uuid        NOT NULL REFERENCES auth.users(id),
  referred_user_id          uuid        NOT NULL REFERENCES auth.users(id),
  referred_pass_id          uuid        NOT NULL REFERENCES hub_user_passes(id),
  status                    text        NOT NULL DEFAULT 'pass_activated'
                               CHECK (status IN (
                                 'attributed', 'pass_activated', 'qualified', 'complete',
                                 'expired', 'rejected', 'manual_review'
                               )),
  signup_reward_miles       integer     NOT NULL,
  activation_reward_miles   integer     NOT NULL,
  min_purchase_kes          integer     NOT NULL,
  activation_expires_at     timestamptz NOT NULL,
  qualification_type        text        CHECK (qualification_type IN (
                               'hub_purchase', 'merchant_purchase', 'voucher_redemption'
                             )),
  qualification_reference   text,
  qualified_at              timestamptz,
  risk_score                integer     NOT NULL DEFAULT 0,
  risk_decision              text        NOT NULL DEFAULT 'allow'
                               CHECK (risk_decision IN ('allow', 'review', 'block')),
  risk_reason_codes          text[]      NOT NULL DEFAULT '{}',
  rejection_reason_code      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  UNIQUE (referred_user_id),
  UNIQUE (referred_pass_id),
  UNIQUE (qualification_type, qualification_reference)
);

CREATE INDEX IF NOT EXISTS idx_hub_referrals_referrer ON hub_referrals (referrer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_referrals_status ON hub_referrals (status);
CREATE INDEX IF NOT EXISTS idx_hub_referrals_activation_expiry
  ON hub_referrals (activation_expires_at) WHERE status = 'pass_activated';

ALTER TABLE hub_referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_referrals FROM PUBLIC, anon, authenticated;
GRANT ALL ON hub_referrals TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §5.5 Reward jobs
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_reward_jobs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id           uuid        NOT NULL REFERENCES hub_referrals(id),
  milestone             text        NOT NULL CHECK (milestone IN ('signup', 'activation')),
  recipient_user_id     uuid        NOT NULL REFERENCES auth.users(id),
  amount_miles          integer     NOT NULL CHECK (amount_miles > 0),
  idempotency_key       text        NOT NULL,
  status                text        NOT NULL DEFAULT 'pending_hold'
                          CHECK (status IN (
                            'pending_hold', 'eligible', 'processing', 'released',
                            'manual_review', 'voided', 'reversed'
                          )),
  eligible_at           timestamptz NOT NULL,
  lease_owner           text,
  lease_expires_at      timestamptz,
  attempts              integer     NOT NULL DEFAULT 0,
  next_retry_at         timestamptz,
  last_error_code       text,
  last_error_detail     text,
  platform_reference    text,
  released_at           timestamptz,
  voided_at             timestamptz,
  reversed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (idempotency_key),
  UNIQUE (referral_id, milestone)
);

CREATE INDEX IF NOT EXISTS idx_referral_reward_jobs_claimable
  ON referral_reward_jobs (eligible_at) WHERE status IN ('pending_hold', 'eligible');
CREATE INDEX IF NOT EXISTS idx_referral_reward_jobs_lease
  ON referral_reward_jobs (lease_expires_at) WHERE status = 'processing';

ALTER TABLE referral_reward_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referral_reward_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON referral_reward_jobs TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §5.6 Audit and risk evidence
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_events (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referral_id        uuid        REFERENCES hub_referrals(id),
  referral_click_id  uuid        REFERENCES referral_clicks(id),
  actor_type         text        NOT NULL CHECK (actor_type IN ('system', 'user', 'worker', 'admin')),
  actor_id           text,
  event_type         text        NOT NULL,
  from_state         text,
  to_state           text,
  reason_code        text,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_events_referral ON referral_events (referral_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_click ON referral_events (referral_click_id, created_at);

ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referral_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON referral_events TO service_role;

CREATE TABLE IF NOT EXISTS hub_user_risk_flags (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flag_type     text        NOT NULL CHECK (flag_type IN (
                   'suspicious_activity', 'blacklisted', 'rewards_disabled', 'manual_review'
                 )),
  reason_code   text        NOT NULL,
  notes         text,
  is_active     boolean     NOT NULL DEFAULT true,
  flagged_by    uuid,
  resolved_by   uuid,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_user_risk_flags_active
  ON hub_user_risk_flags (hub_user_id, flag_type) WHERE is_active;

ALTER TABLE hub_user_risk_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_user_risk_flags FROM PUBLIC, anon, authenticated;
GRANT ALL ON hub_user_risk_flags TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §2.4.3 Voucher programs are ineligible by default — Product/Ops opt each
-- spend_voucher_templates row in explicitly.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE spend_voucher_templates
  ADD COLUMN IF NOT EXISTS referral_qualifying boolean NOT NULL DEFAULT false;

-- ════════════════════════════════════════════════════════════════════════
-- Shared helper: resolve a Hub auth.users id from a merchant_transactions
-- .user_address value, which is a verified wallet address for crypto
-- checkouts or a raw email/user-id fallback for wallet-less checkouts
-- (orders/route.ts: `allAddresses[0] ?? (user.email ?? user.id)`).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION resolve_hub_user_id_from_address(p_address text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_address IS NULL OR btrim(p_address) = '' THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_user_id FROM hub_user_wallets
  WHERE lower(address) = lower(p_address) AND verification_status = 'verified'
  LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    RETURN v_user_id;
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_address) LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    RETURN v_user_id;
  END IF;

  BEGIN
    v_user_id := p_address::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RETURN v_user_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION resolve_hub_user_id_from_address(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_hub_user_id_from_address(text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §5.2 code generation — unambiguous uppercase Crockford Base32 (excludes
-- I, L, O, U), 8 chars = exactly 40 bits of entropy, no embedded identity.
-- ════════════════════════════════════════════════════════════════════════

-- SET search_path includes extensions: Supabase installs pgcrypto (which
-- provides gen_random_bytes) into the `extensions` schema, not `public`,
-- and this function has no SECURITY DEFINER of its own to otherwise pin a
-- search_path — without this, resolution depends on the calling session's
-- search_path, which is not guaranteed to include `extensions` (e.g. the
-- Supabase SQL editor's default session doesn't), producing an
-- intermittent "function gen_random_bytes(integer) does not exist" that
-- only reproduces in some call contexts, not others.
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS text
LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea := gen_random_bytes(5);
  v_bits     bigint;
  v_result   text := '';
  i          int;
  v_idx      int;
BEGIN
  v_bits := (get_byte(v_bytes, 0)::bigint << 32)
          | (get_byte(v_bytes, 1)::bigint << 24)
          | (get_byte(v_bytes, 2)::bigint << 16)
          | (get_byte(v_bytes, 3)::bigint << 8)
          |  get_byte(v_bytes, 4)::bigint;
  FOR i IN 0..7 LOOP
    v_idx := (v_bits >> ((7 - i) * 5)) & 31;
    v_result := v_result || substr(v_alphabet, v_idx + 1, 1);
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION generate_referral_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_referral_code() TO service_role;

CREATE OR REPLACE FUNCTION get_or_create_referral_code(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing  text;
  v_candidate text;
  v_attempt   int := 0;
BEGIN
  SELECT code INTO v_existing FROM hub_referral_codes
  WHERE hub_user_id = p_user_id AND status = 'active';
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not generate a unique referral code' USING ERRCODE = 'P0001';
    END IF;
    v_candidate := generate_referral_code();
    BEGIN
      INSERT INTO hub_referral_codes (hub_user_id, code) VALUES (p_user_id, v_candidate);
      RETURN v_candidate;
    EXCEPTION WHEN unique_violation THEN
      -- Either the random code collided (retry with a new one) or a
      -- concurrent caller already created this user's active code.
      SELECT code INTO v_existing FROM hub_referral_codes
      WHERE hub_user_id = p_user_id AND status = 'active';
      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_referral_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_referral_code(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §6.1 accept_referral_click
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION accept_referral_click(
  p_code               text,
  p_token_hash         text,
  p_ip_hash            text,
  p_device_hash        text,
  p_user_agent_family  text,
  p_landing_path       text
) RETURNS TABLE(ok boolean, error_code text, click_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_program  referral_program_versions%ROWTYPE;
  v_code     hub_referral_codes%ROWTYPE;
  v_click_id uuid;
  v_expires  timestamptz;
BEGIN
  IF NOT referral_flag_enabled('accept_clicks') THEN
    RETURN QUERY SELECT false, 'program_paused'::text, NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  IF p_ip_hash IS NOT NULL AND NOT check_rate_limit('referral_click:ip:' || p_ip_hash, 60, 3600) THEN
    RETURN QUERY SELECT false, 'rate_limited'::text, NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  SELECT * INTO v_code FROM hub_referral_codes
  WHERE code = upper(btrim(p_code))
  FOR UPDATE;

  IF NOT FOUND OR v_code.status <> 'active' THEN
    RETURN QUERY SELECT false, 'invalid_code'::text, NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  SELECT * INTO v_program FROM referral_program_versions
  WHERE status = 'active'
  FOR UPDATE;

  IF NOT FOUND
     OR v_program.starts_at > now()
     OR (v_program.ends_at IS NOT NULL AND v_program.ends_at <= now())
  THEN
    RETURN QUERY SELECT false, 'program_paused'::text, NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  IF v_program.total_budget_miles - v_program.reserved_budget_miles - v_program.released_budget_miles
     < (v_program.signup_reward_miles + v_program.activation_reward_miles)
  THEN
    RETURN QUERY SELECT false, 'budget_exhausted'::text, NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  v_expires := now() + make_interval(days => v_program.attribution_window_days);

  INSERT INTO referral_clicks (
    referral_code_id, program_version_id, token_hash,
    ip_hash, device_hash, user_agent_family, landing_path,
    status, accepted_at, expires_at
  ) VALUES (
    v_code.id, v_program.id, p_token_hash,
    p_ip_hash, p_device_hash, p_user_agent_family, p_landing_path,
    'accepted', now(), v_expires
  )
  RETURNING id INTO v_click_id;

  INSERT INTO referral_events (referral_click_id, actor_type, event_type, to_state, metadata)
  VALUES (
    v_click_id, 'system', 'referral_click_accepted', 'accepted',
    jsonb_build_object('referralCodeId', v_code.id, 'programVersionId', v_program.id)
  );

  RETURN QUERY SELECT true, NULL::text, v_click_id, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION accept_referral_click(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_referral_click(text, text, text, text, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §6.2 create_or_get_hub_pass_with_referral
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_or_get_hub_pass_with_referral(
  p_user_id              uuid,
  p_email                text,
  p_src                  text DEFAULT 'organic',
  p_referral_token_hash  text DEFAULT NULL
) RETURNS TABLE(public_pass_id uuid, is_new boolean, referral_outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing        uuid;
  v_inserted        uuid;
  v_pass_created_at timestamptz;
  v_outcome         text := 'none';
  v_click           referral_clicks%ROWTYPE;
  v_program         referral_program_versions%ROWTYPE;
  v_code            hub_referral_codes%ROWTYPE;
  v_referrer_id     uuid;
  v_referral_id     uuid;
  v_total_reserve   integer;
  v_signup_key      text;
BEGIN
  SELECT hup.public_pass_id INTO v_existing FROM hub_user_passes hup WHERE hup.user_id = p_user_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, false, 'none'::text;
    RETURN;
  END IF;

  INSERT INTO hub_user_passes (user_id, email, signup_src)
  VALUES (p_user_id, p_email, p_src)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING hub_user_passes.public_pass_id, hub_user_passes.created_at INTO v_inserted, v_pass_created_at;

  IF v_inserted IS NULL THEN
    -- Lost a race to a concurrent caller; fetch what it created.
    SELECT hup.public_pass_id INTO v_existing FROM hub_user_passes hup WHERE hup.user_id = p_user_id;
    RETURN QUERY SELECT v_existing, false, 'none'::text;
    RETURN;
  END IF;

  INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
  VALUES (
    'pass_activated',
    'pass:' || p_user_id::text,
    jsonb_build_array(jsonb_build_object('type', 'email', 'value', p_email)),
    jsonb_build_object('src', p_src, 'userId', p_user_id)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF p_referral_token_hash IS NULL THEN
    RETURN QUERY SELECT v_inserted, true, 'none'::text;
    RETURN;
  END IF;

  -- Referral binding is best-effort on top of Pass creation: a bug or a
  -- paused/exhausted program must never stop Pass creation from succeeding
  -- (spec §6.2 "Pass creation must still succeed if referral binding is
  -- invalid, paused or out of budget").
  BEGIN
    IF NOT referral_flag_enabled('bind_referrals') THEN
      v_outcome := 'program_paused';
    ELSE
      SELECT * INTO v_click FROM referral_clicks
      WHERE token_hash = p_referral_token_hash AND status = 'accepted'
      FOR UPDATE;

      IF NOT FOUND THEN
        v_outcome := 'not_eligible';
      ELSIF v_click.expires_at <= now() THEN
        UPDATE referral_clicks SET status = 'expired' WHERE id = v_click.id;
        v_outcome := 'not_eligible';
      ELSE
        SELECT * INTO v_program FROM referral_program_versions WHERE id = v_click.program_version_id FOR UPDATE;
        SELECT * INTO v_code FROM hub_referral_codes WHERE id = v_click.referral_code_id FOR UPDATE;
        v_referrer_id := v_code.hub_user_id;

        IF v_program.status <> 'active' THEN
          v_outcome := 'program_paused';
        ELSIF v_code.status <> 'active' THEN
          v_outcome := 'not_eligible';
        ELSIF v_referrer_id = p_user_id THEN
          v_outcome := 'not_eligible'; -- self-referral hard block (§10.1)
        ELSIF EXISTS (
          SELECT 1 FROM hub_user_wallets w1
          JOIN hub_user_wallets w2 ON lower(w1.address) = lower(w2.address)
          WHERE w1.user_id = p_user_id AND w1.verification_status = 'verified'
            AND w2.user_id = v_referrer_id AND w2.verification_status = 'verified'
        ) THEN
          v_outcome := 'not_eligible'; -- shared verified wallet hard block (§10.1)
        ELSIF NOT EXISTS (SELECT 1 FROM hub_user_passes WHERE user_id = v_referrer_id) THEN
          v_outcome := 'not_eligible'; -- referrer has no Pass (§2.2)
        ELSIF EXISTS (
          SELECT 1 FROM hub_user_risk_flags
          WHERE hub_user_id = v_referrer_id AND is_active
            AND flag_type IN ('blacklisted', 'rewards_disabled')
        ) THEN
          v_outcome := 'not_eligible'; -- referrer blacklisted/rewards_disabled (§2.2/§10.1)
        ELSIF (
          SELECT count(*) FROM hub_referrals
          WHERE referrer_user_id = v_referrer_id AND created_at >= now() - interval '24 hours'
        ) >= v_program.daily_signup_cap THEN
          v_outcome := 'not_eligible'; -- daily signup cap (§2.1)
        ELSIF (
          SELECT count(*) FROM hub_referrals
          WHERE referrer_user_id = v_referrer_id AND created_at >= now() - interval '30 days'
        ) >= v_program.rolling_30_day_referral_cap THEN
          v_outcome := 'not_eligible'; -- rolling 30-day cap (§2.1)
        ELSIF NOT (
          (SELECT created_at FROM hub_user_passes WHERE user_id = v_referrer_id) <= now() - interval '7 days'
          OR EXISTS (SELECT 1 FROM voucher_redemptions WHERE hub_user_id = v_referrer_id)
          OR EXISTS (
            SELECT 1 FROM reward_jobs rj JOIN merchant_transactions mt ON mt.id = rj.order_id
            WHERE rj.status = 'released' AND resolve_hub_user_id_from_address(mt.user_address) = v_referrer_id
          )
        ) THEN
          v_outcome := 'not_eligible'; -- new referrer with no verified activity yet (§2.2)
        ELSE
          v_total_reserve := v_program.signup_reward_miles + v_program.activation_reward_miles;
          IF v_program.total_budget_miles - v_program.reserved_budget_miles - v_program.released_budget_miles < v_total_reserve THEN
            v_outcome := 'budget_exhausted';
          ELSE
            UPDATE referral_program_versions
            SET reserved_budget_miles = reserved_budget_miles + v_total_reserve
            WHERE id = v_program.id;

            INSERT INTO hub_referrals (
              program_version_id, referral_code_id, referral_click_id,
              referrer_user_id, referred_user_id, referred_pass_id,
              status, signup_reward_miles, activation_reward_miles, min_purchase_kes,
              activation_expires_at
            ) VALUES (
              v_program.id, v_code.id, v_click.id,
              v_referrer_id, p_user_id, v_inserted,
              'pass_activated', v_program.signup_reward_miles, v_program.activation_reward_miles,
              v_program.min_purchase_kes,
              v_pass_created_at + make_interval(days => v_program.activation_window_days)
            )
            RETURNING id INTO v_referral_id;

            v_signup_key := 'hub-referral:' || v_program.version::text || ':' || v_referral_id::text || ':signup:referrer';

            INSERT INTO referral_reward_jobs (
              referral_id, milestone, recipient_user_id, amount_miles, idempotency_key, eligible_at
            ) VALUES (
              v_referral_id, 'signup', v_referrer_id, v_program.signup_reward_miles, v_signup_key,
              now() + make_interval(hours => v_program.signup_hold_hours)
            );

            UPDATE referral_clicks SET status = 'bound', bound_at = now() WHERE id = v_click.id;

            INSERT INTO referral_events (referral_id, referral_click_id, actor_type, event_type, to_state, metadata)
            VALUES (
              v_referral_id, v_click.id, 'system', 'referral_bound', 'pass_activated',
              jsonb_build_object('referrerUserId', v_referrer_id, 'programVersionId', v_program.id)
            );
            INSERT INTO referral_events (referral_id, actor_type, event_type, to_state)
            VALUES (v_referral_id, 'system', 'referral_signup_reward_held', 'pending_hold');

            v_outcome := 'bound';
          END IF;
        END IF;

        IF v_outcome <> 'bound' THEN
          UPDATE referral_clicks SET status = 'blocked' WHERE id = v_click.id AND status = 'accepted';
          INSERT INTO referral_events (referral_click_id, actor_type, event_type, reason_code)
          VALUES (v_click.id, 'system', 'referral_click_blocked', v_outcome);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral binding failed for user %: %', p_user_id, SQLERRM;
    v_outcome := 'none';
  END;

  RETURN QUERY SELECT v_inserted, true, v_outcome;
END;
$$;

REVOKE ALL ON FUNCTION create_or_get_hub_pass_with_referral(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_or_get_hub_pass_with_referral(uuid, text, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §6.3 qualify_referral_activation
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION qualify_referral_activation(
  p_referred_user_id          uuid,
  p_qualification_type        text,
  p_qualification_reference   text,
  p_gross_amount_kes          numeric,
  p_occurred_at               timestamptz DEFAULT now()
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral        hub_referrals%ROWTYPE;
  v_program         referral_program_versions%ROWTYPE;
  v_pass_created_at timestamptz;
  v_activation_key  text;
BEGIN
  IF NOT referral_flag_enabled('qualify_activations') THEN
    RETURN QUERY SELECT false, 'program_paused'::text; RETURN;
  END IF;

  IF p_qualification_type NOT IN ('hub_purchase', 'merchant_purchase', 'voucher_redemption') THEN
    RETURN QUERY SELECT false, 'invalid_type'::text; RETURN;
  END IF;

  SELECT * INTO v_referral FROM hub_referrals WHERE referred_user_id = p_referred_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_referral'::text; RETURN;
  END IF;

  IF v_referral.status IN ('qualified', 'complete') THEN
    -- Only the earliest eligible event qualifies (§2.4) — a later
    -- concurrent purchase/voucher event is a successful no-op, not an error.
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;

  IF v_referral.status <> 'pass_activated' THEN
    RETURN QUERY SELECT false, 'referral_not_eligible'::text; RETURN;
  END IF;

  SELECT created_at INTO v_pass_created_at FROM hub_user_passes WHERE id = v_referral.referred_pass_id;
  IF p_occurred_at < v_pass_created_at THEN
    RETURN QUERY SELECT false, 'predates_pass_creation'::text; RETURN;
  END IF;

  IF v_referral.activation_expires_at < now() THEN
    RETURN QUERY SELECT false, 'activation_window_expired'::text; RETURN;
  END IF;

  IF p_gross_amount_kes IS NULL OR p_gross_amount_kes < v_referral.min_purchase_kes THEN
    RETURN QUERY SELECT false, 'below_threshold'::text; RETURN;
  END IF;

  SELECT * INTO v_program FROM referral_program_versions WHERE id = v_referral.program_version_id;

  BEGIN
    UPDATE hub_referrals
    SET status = 'qualified',
        qualification_type = p_qualification_type,
        qualification_reference = p_qualification_reference,
        qualified_at = now(),
        updated_at = now()
    WHERE id = v_referral.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'duplicate_proof'::text; RETURN;
  END;

  v_activation_key := 'hub-referral:' || v_program.version::text || ':' || v_referral.id::text || ':activation:referrer';

  INSERT INTO referral_reward_jobs (
    referral_id, milestone, recipient_user_id, amount_miles, idempotency_key, eligible_at
  ) VALUES (
    v_referral.id, 'activation', v_referral.referrer_user_id, v_referral.activation_reward_miles, v_activation_key,
    now() + make_interval(hours => v_program.activation_hold_hours)
  )
  ON CONFLICT (referral_id, milestone) DO NOTHING;

  INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, metadata)
  VALUES (
    v_referral.id, 'system', 'referral_qualified', 'pass_activated', 'qualified',
    jsonb_build_object(
      'qualificationType', p_qualification_type,
      'qualificationReference', p_qualification_reference,
      'grossAmountKes', p_gross_amount_kes
    )
  );
  INSERT INTO referral_events (referral_id, actor_type, event_type, to_state)
  VALUES (v_referral.id, 'system', 'referral_activation_reward_held', 'pending_hold');

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION qualify_referral_activation(uuid, text, text, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualify_referral_activation(uuid, text, text, numeric, timestamptz) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §6.4 void_referral_activation_for_reversal — covers both a pre-release
-- void (refund during hold) and a post-release reversal (chargeback after
-- payout), matched by the qualification_reference the purchase/voucher
-- event carried.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION void_referral_activation_for_reversal(
  p_qualification_reference text,
  p_reason text
) RETURNS TABLE(ok boolean, voided_jobs integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral hub_referrals%ROWTYPE;
  v_job      referral_reward_jobs%ROWTYPE;
  v_voided   integer := 0;
BEGIN
  SELECT * INTO v_referral FROM hub_referrals
  WHERE qualification_reference = p_qualification_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0; RETURN;
  END IF;

  FOR v_job IN
    SELECT * FROM referral_reward_jobs
    WHERE referral_id = v_referral.id AND milestone = 'activation'
    FOR UPDATE
  LOOP
    IF v_job.status IN ('pending_hold', 'eligible', 'manual_review') THEN
      UPDATE referral_reward_jobs
      SET status = 'voided', voided_at = now(),
          last_error_code = 'reversed', last_error_detail = p_reason, updated_at = now()
      WHERE id = v_job.id;

      UPDATE referral_program_versions
      SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles
      WHERE id = v_referral.program_version_id;

      INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
      VALUES (
        v_referral.id, 'system', 'referral_reward_voided', p_reason,
        jsonb_build_object('jobId', v_job.id, 'qualificationReference', p_qualification_reference)
      );

      v_voided := v_voided + 1;

    ELSIF v_job.status = 'released' THEN
      -- Never delete or mutate the original credit (§3.5) — an idempotent
      -- debit row referencing it instead.
      UPDATE referral_reward_jobs
      SET status = 'reversed', reversed_at = now(), updated_at = now()
      WHERE id = v_job.id;

      UPDATE referral_program_versions
      SET released_budget_miles = released_budget_miles - v_job.amount_miles
      WHERE id = v_referral.program_version_id;

      INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
      VALUES (
        v_referral.id, 'system', 'referral_reward_reversed', p_reason,
        jsonb_build_object('jobId', v_job.id, 'qualificationReference', p_qualification_reference)
      );

      v_voided := v_voided + 1;
    END IF;
  END LOOP;

  IF v_voided > 0 AND v_referral.status <> 'complete' THEN
    UPDATE hub_referrals SET status = 'rejected', rejection_reason_code = p_reason, updated_at = now()
    WHERE id = v_referral.id;
  END IF;

  RETURN QUERY SELECT true, v_voided;
END;
$$;

REVOKE ALL ON FUNCTION void_referral_activation_for_reversal(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION void_referral_activation_for_reversal(text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §6.4 Reward worker primitives — same lease shape as
-- claim_internal_event_jobs/complete_internal_event_job
-- (052_hub_quest_event_worker_leases.sql).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION claim_referral_reward_jobs(
  p_limit          integer,
  p_worker_id      text,
  p_lease_seconds  integer
) RETURNS SETOF referral_reward_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT referral_flag_enabled('release_rewards') THEN
    RETURN;
  END IF;

  -- A reward can release only while its recipient is not currently
  -- blacklisted/rewards_disabled (§2.2) — route those to manual_review
  -- instead of claiming and paying them.
  UPDATE referral_reward_jobs j
  SET status = 'manual_review', updated_at = now()
  WHERE j.status IN ('pending_hold', 'eligible')
    AND j.eligible_at <= now()
    AND EXISTS (
      SELECT 1 FROM hub_user_risk_flags f
      WHERE f.hub_user_id = j.recipient_user_id AND f.is_active
        AND f.flag_type IN ('blacklisted', 'rewards_disabled')
    );

  RETURN QUERY
  UPDATE referral_reward_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM referral_reward_jobs
    WHERE (
      (status IN ('pending_hold', 'eligible') AND eligible_at <= now()
        AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
    )
    ORDER BY eligible_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_referral_reward_jobs(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_referral_reward_jobs(integer, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION complete_referral_reward_job(
  p_job_id             uuid,
  p_worker_id          text,
  p_ok                 boolean,
  p_retryable          boolean,
  p_platform_reference text DEFAULT NULL,
  p_error_code         text DEFAULT NULL,
  p_error_detail       text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job            referral_reward_jobs%ROWTYPE;
  v_referral       hub_referrals%ROWTYPE;
  v_max_attempts   constant integer := 10;
  v_detail         text := left(coalesce(p_error_detail, ''), 500);
  v_both_released  boolean;
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id AND status = 'processing' AND lease_expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_ok THEN
    UPDATE referral_reward_jobs
    SET status = 'released', released_at = now(), platform_reference = p_platform_reference,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = NULL, last_error_detail = NULL, updated_at = now()
    WHERE id = p_job_id;

    SELECT * INTO v_referral FROM hub_referrals WHERE id = v_job.referral_id FOR UPDATE;

    UPDATE referral_program_versions
    SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles,
        released_budget_miles = released_budget_miles + v_job.amount_miles
    WHERE id = v_referral.program_version_id;

    SELECT NOT EXISTS (
      SELECT 1 FROM referral_reward_jobs WHERE referral_id = v_referral.id AND status <> 'released'
    ) INTO v_both_released;

    UPDATE hub_referrals
    SET status = CASE WHEN v_both_released THEN 'complete' ELSE status END, updated_at = now()
    WHERE id = v_referral.id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, to_state, metadata)
    VALUES (
      v_referral.id, 'worker',
      CASE WHEN v_job.milestone = 'signup' THEN 'referral_signup_reward_released' ELSE 'referral_activation_reward_released' END,
      CASE WHEN v_both_released THEN 'complete' ELSE v_referral.status END,
      jsonb_build_object('jobId', v_job.id, 'amountMiles', v_job.amount_miles, 'platformReference', p_platform_reference)
    );

    RETURN true;
  END IF;

  IF p_retryable AND v_job.attempts < v_max_attempts THEN
    UPDATE referral_reward_jobs
    SET status = 'eligible',
        next_retry_at = now() + (LEAST(v_job.attempts, 6) * interval '5 minutes') + (random() * interval '30 seconds'),
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE referral_reward_jobs
    SET status = 'manual_review',
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
    VALUES (
      v_job.referral_id, 'worker', 'referral_manual_reviewed', p_error_code,
      jsonb_build_object('jobId', v_job.id, 'reason', 'max_attempts_exceeded')
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION complete_referral_reward_job(uuid, text, boolean, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_referral_reward_job(uuid, text, boolean, boolean, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION release_expired_referral_reward_leases()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  UPDATE referral_reward_jobs
  SET status = 'eligible', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE status = 'processing' AND lease_expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION release_expired_referral_reward_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_expired_referral_reward_leases() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §3.5 expire_referrals — lapsed anonymous clicks and lapsed activation
-- windows (the referral remains a valid 50-Mile signup; only the 100-Mile
-- reservation releases back to the budget pool).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION expire_referrals(p_batch_size integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral hub_referrals%ROWTYPE;
  v_count    integer := 0;
BEGIN
  FOR v_referral IN
    SELECT * FROM hub_referrals
    WHERE status = 'pass_activated' AND activation_expires_at <= now()
    ORDER BY activation_expires_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE hub_referrals SET status = 'expired', updated_at = now() WHERE id = v_referral.id;

    UPDATE referral_program_versions
    SET reserved_budget_miles = reserved_budget_miles - v_referral.activation_reward_miles
    WHERE id = v_referral.program_version_id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state)
    VALUES (v_referral.id, 'system', 'referral_expired', 'pass_activated', 'expired');

    v_count := v_count + 1;
  END LOOP;

  UPDATE referral_clicks
  SET status = 'expired'
  WHERE status = 'accepted' AND expires_at <= now();

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION expire_referrals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_referrals(integer) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- §2.4 Qualification hooks — additive changes to the existing order
-- lifecycle function (044_internal_event_outbox.sql is the last
-- redefinition; reproduced here in full with two small, isolated
-- insertions so every caller across every app — hub-page, admin-dashboard,
-- merchant-dashboard, react-app — gets referral qualification/void for
-- free through this one choke point). Both insertions are wrapped so a
-- referral-system failure can never block an order transition.
--
-- Not covered here: the merchant-dashboard in-store scan path
-- (redeem_voucher_in_store_atomic) — left untouched, see header note.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION advance_order_status(
  p_order_id  uuid,
  p_to_status text,
  p_actor     text,
  p_meta      jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order              merchant_transactions%ROWTYPE;
  v_allowed            text[];
  v_at_column          text;
  v_rail               text;
  v_voucher_reinstated boolean := false;
  v_redemption_id      uuid;
  v_settlement_entry   record;
  v_template           text;
  v_is_digital         boolean;
  v_reward_job         reward_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM merchant_transactions WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'; RETURN;
  END IF;

  SELECT allowed_actors INTO v_allowed
  FROM order_status_transitions
  WHERE from_status = v_order.status::text AND to_status = p_to_status;

  IF v_allowed IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_TRANSITION'; RETURN;
  END IF;
  IF NOT (p_actor = ANY(v_allowed)) THEN
    RETURN QUERY SELECT false, 'ACTOR_NOT_ALLOWED'; RETURN;
  END IF;

  v_at_column := CASE p_to_status
    WHEN 'accepted'         THEN 'accepted_at'
    WHEN 'packed'           THEN 'packed_at'
    WHEN 'out_for_delivery' THEN 'dispatched_at'
    WHEN 'delivered'        THEN 'delivered_at'
    WHEN 'received'         THEN 'received_at'
    WHEN 'completed'        THEN 'completed_at'
    WHEN 'cancelled'        THEN 'cancelled_at'
    WHEN 'provider_pending' THEN 'provider_pending_at'
    WHEN 'fulfil_failed'    THEN 'fulfil_failed_at'
    WHEN 'retrying'         THEN 'retrying_at'
    WHEN 'disputed'         THEN 'disputed_at'
    ELSE NULL
  END;

  PERFORM set_config('akiba.allow_status_change', 'true', true);

  IF v_at_column IS NOT NULL THEN
    EXECUTE format('UPDATE merchant_transactions SET status = $1::tx_status, %I = now() WHERE id = $2', v_at_column)
      USING p_to_status, p_order_id;
  ELSE
    UPDATE merchant_transactions SET status = p_to_status::tx_status WHERE id = p_order_id;
  END IF;

  INSERT INTO order_events (order_id, actor, from_status, to_status, meta)
  VALUES (p_order_id, p_actor, v_order.status::text, p_to_status, COALESCE(p_meta, '{}'::jsonb));

  -- Order completion makes an accrued reward eligible for release. The
  -- synchronous fast path (confirm route / digital completion) tries
  -- releasing it immediately after this call; the scheduled worker
  -- (process_reward_jobs) is what actually guarantees delivery.
  IF p_to_status = 'completed' THEN
    UPDATE reward_jobs SET status = 'eligible', updated_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

    -- Referral activation qualification (referral-system-spec.md
    -- §2.4.1/§2.4.3). Best-effort — never blocks order completion.
    DECLARE
      v_referred_user_id     uuid;
      v_referral_qualifying  boolean := false;
      v_qual_type            text;
    BEGIN
      v_referred_user_id := resolve_hub_user_id_from_address(v_order.user_address);

      IF v_referred_user_id IS NOT NULL THEN
        IF v_order.voucher_id IS NOT NULL THEN
          SELECT COALESCE(svt.referral_qualifying, false) INTO v_referral_qualifying
          FROM issued_vouchers iv
          JOIN spend_voucher_templates svt ON svt.id = iv.voucher_template_id
          WHERE iv.id = v_order.voucher_id;
        END IF;

        v_qual_type := CASE
          WHEN v_order.voucher_id IS NOT NULL AND v_referral_qualifying THEN 'voucher_redemption'
          ELSE 'hub_purchase'
        END;

        PERFORM qualify_referral_activation(
          v_referred_user_id,
          v_qual_type,
          'order:' || p_order_id::text,
          COALESCE(v_order.amount_kes, 0)::numeric,
          now()
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'referral qualification failed for order %: %', p_order_id, SQLERRM;
    END;
  END IF;

  -- ── Cancellation compensation, same transaction as the cancel ────────────
  IF p_to_status = 'cancelled' THEN

    -- Void the reward accrued at purchase — nothing to claw back, since
    -- release only ever happens after 'completed'. Capture the row first so
    -- a purchase_reversed event can be built from its stored payload (the
    -- same identity/metadata the original purchase event carried).
    SELECT * INTO v_reward_job FROM reward_jobs
    WHERE order_id = p_order_id AND status IN ('pending', 'eligible')
    FOR UPDATE;

    IF FOUND THEN
      UPDATE reward_jobs SET status = 'voided', voided_at = now(), updated_at = now()
      WHERE id = v_reward_job.id;

      INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
      VALUES (
        'purchase_reversed',
        'purchase_reversed:' || p_order_id::text,
        CASE
          WHEN v_reward_job.payload ? 'recipient'
            THEN jsonb_build_array(v_reward_job.payload->'recipient')
          ELSE '[]'::jsonb
        END,
        jsonb_build_object(
          'orderId', p_order_id,
          'reason', COALESCE(p_meta->>'reason', 'unspecified'),
          'originalIdempotencyKey', v_reward_job.payload->>'idempotencyKey'
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- Void/reverse a referral activation qualified from this order (§3.5
    -- "a qualifying order refunded before release voids the pending 100
    -- Miles"). Best-effort, same reasoning as the completion hook above.
    BEGIN
      PERFORM void_referral_activation_for_reversal(
        'order:' || p_order_id::text,
        COALESCE(p_meta->>'reason', 'order_cancelled')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'referral void-on-cancel failed for order %: %', p_order_id, SQLERRM;
    END;

    IF v_order.voucher_id IS NOT NULL THEN
      BEGIN
        UPDATE issued_vouchers
        SET status = 'issued',
            expires_at = CASE
              WHEN expires_at IS NOT NULL AND expires_at < now() THEN now() + interval '7 days'
              ELSE expires_at
            END
        WHERE id = v_order.voucher_id AND status = 'redeemed';

        IF FOUND THEN
          v_voucher_reinstated := true;

          INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
          VALUES (v_order.voucher_id, 'reinstated', p_actor, jsonb_build_object('order_id', p_order_id));

          SELECT id INTO v_redemption_id FROM voucher_redemptions WHERE order_id = p_order_id::text LIMIT 1;

          IF v_redemption_id IS NOT NULL THEN
            SELECT merchant_id, program_id, payable_amount, currency INTO v_settlement_entry
            FROM voucher_settlement_entries
            WHERE voucher_redemption_id = v_redemption_id AND entry_type = 'payable_created'
            LIMIT 1;

            IF FOUND THEN
              PERFORM add_settlement_adjustment(
                v_settlement_entry.merchant_id, v_settlement_entry.program_id,
                -v_settlement_entry.payable_amount, v_settlement_entry.currency,
                'order_cancelled:' || p_order_id::text,
                'cancel-adjustment:' || p_order_id::text,
                p_actor
              );
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'voucher/settlement compensation failed for order %: %', p_order_id, SQLERRM;
        INSERT INTO reconciliation_incidents (type, voucher_id, order_id, data)
        VALUES (
          'cancellation_compensation_failed', v_order.voucher_id, p_order_id,
          jsonb_build_object('error', SQLERRM, 'actor', p_actor)
        );
      END;
    END IF;

    IF COALESCE(v_order.amount_cusd, 0) > 0 AND v_order.payment_ref IS NOT NULL THEN
      v_rail := CASE
        WHEN v_order.payment_method::text LIKE 'crypto:%' OR v_order.payment_method::text = 'onchain_transfer' THEN 'crypto'
        ELSE 'mpesa'
      END;

      INSERT INTO order_cancellation_compensations (
        order_id, user_address, partner_id, amount_cusd, amount_kes, payment_ref, payment_currency,
        voucher_id, voucher_reinstated, refund_status, rail, reason
      ) VALUES (
        p_order_id, v_order.user_address, v_order.partner_id, v_order.amount_cusd,
        CASE WHEN v_rail = 'mpesa' THEN v_order.amount_kes ELSE NULL END,
        v_order.payment_ref, v_order.payment_currency,
        v_order.voucher_id, v_voucher_reinstated, 'pending_manual', v_rail,
        COALESCE(p_meta->>'reason', 'unspecified')
      )
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  -- ── Customer notifications (§5.2) ────────────────────────────────────────
  v_template := CASE p_to_status
    WHEN 'accepted'         THEN 'order_accepted'
    WHEN 'out_for_delivery' THEN 'order_dispatched'
    WHEN 'delivered'        THEN NULL
    WHEN 'cancelled'        THEN 'order_cancelled'
    ELSE NULL
  END;

  IF p_to_status = 'delivered' THEN
    SELECT EXISTS(SELECT 1 FROM fulfillment_jobs WHERE order_id = p_order_id) INTO v_is_digital;
    v_template := CASE WHEN v_is_digital THEN 'digital_delivered' ELSE 'order_delivered' END;
  END IF;

  IF v_template IS NOT NULL THEN
    INSERT INTO notification_outbox (user_ref, order_id, template, status, sent_at, dedupe_key, metadata)
    VALUES (
      v_order.user_address, p_order_id, v_template, 'sent', now(),
      'notif:' || p_order_id::text || ':' || v_template,
      jsonb_build_object('status', p_to_status)
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  IF p_to_status = 'cancelled' AND COALESCE(v_order.amount_cusd, 0) > 0 AND v_order.payment_ref IS NOT NULL THEN
    INSERT INTO notification_outbox (user_ref, order_id, template, dedupe_key, metadata)
    VALUES (v_order.user_address, p_order_id, 'refund_initiated', 'notif:' || p_order_id::text || ':refund_initiated', '{}'::jsonb)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- §2.4.2/§2.4.3 In-store merchant-verified purchase and in-store voucher
-- redemption. redeem_voucher_in_store_atomic's transactional body
-- (044_internal_event_outbox.sql, the last redefinition) is unchanged
-- below — only the RETURNS TABLE column set grows, so a DROP FUNCTION is
-- required first (Postgres won't let CREATE OR REPLACE change the return
-- shape). merchant-dashboard's caller converts gross_amount_cusd to KES
-- with its own rate and calls qualify_referral_activation as a follow-up;
-- this function does not call it directly, keeping the currency-conversion
-- decision in TS.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS redeem_voucher_in_store_atomic(text, uuid, uuid, numeric, text);

CREATE OR REPLACE FUNCTION redeem_voucher_in_store_atomic(
  p_token_hash text,
  p_partner_id uuid,
  p_merchant_user_id uuid,
  p_gross_amount_cusd numeric,
  p_external_reference text DEFAULT NULL
) RETURNS TABLE(
  ok boolean, voucher_id uuid, offer_title text, error_code text,
  hub_user_id uuid, gross_amount_cusd numeric, referral_qualifying boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_iv record; v_discount numeric; v_redemption_id uuid; v_title text; v_identities jsonb;
  v_referral_qualifying boolean := false;
BEGIN
  SELECT * INTO v_iv FROM issued_vouchers
   WHERE redemption_token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_iv.status<>'issued'
     OR v_iv.redemption_token_expires_at IS NULL
     OR v_iv.redemption_token_expires_at<now()
     OR v_iv.merchant_id IS DISTINCT FROM p_partner_id THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,'INVALID'::text,NULL::uuid,NULL::numeric,false; RETURN;
  END IF;
  IF v_iv.expires_at IS NOT NULL AND v_iv.expires_at<now() THEN
    UPDATE issued_vouchers SET status='expired' WHERE id=v_iv.id;
    INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id)
    VALUES(v_iv.id,'expired',p_merchant_user_id::text);
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,'INVALID'::text,NULL::uuid,NULL::numeric,false; RETURN;
  END IF;

  v_discount := calculate_voucher_discount(v_iv.rules_snapshot,p_gross_amount_cusd);
  v_title := v_iv.rules_snapshot->>'title';

  UPDATE issued_vouchers SET status='redeemed',redeemed_at=now() WHERE id=v_iv.id;
  INSERT INTO voucher_redemptions(
    issued_voucher_id,hub_user_id,user_address,merchant_id,discount_applied,
    redemption_channel,merchant_user_id,external_reference,redeemed_at
  ) VALUES(
    v_iv.id,v_iv.hub_user_id,v_iv.user_address,p_partner_id,v_discount,
    'merchant_scan',p_merchant_user_id,p_external_reference,now()
  ) RETURNING id INTO v_redemption_id;

  PERFORM create_voucher_payable(
    v_iv.id,v_redemption_id,p_gross_amount_cusd,v_discount,
    'redemption:'||v_redemption_id::text,
    jsonb_build_object('channel','merchant_scan','external_reference',p_external_reference)
  );

  INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id,metadata)
  VALUES(v_iv.id,'redeemed',p_merchant_user_id::text,
    jsonb_build_object('merchant_id',p_partner_id,'channel','merchant_scan',
                       'gross_amount_cusd',p_gross_amount_cusd,'discount_applied',v_discount));
  INSERT INTO merchant_audit_log(merchant_user_id,partner_id,action,metadata)
  VALUES(p_merchant_user_id,p_partner_id,'voucher.redeemed',
    jsonb_build_object('voucher_id',v_iv.id,'channel','merchant_scan','discount_applied',v_discount));

  IF v_iv.user_address IS NOT NULL THEN
    v_identities := jsonb_build_array(jsonb_build_object('type','wallet','value',lower(v_iv.user_address)));

    INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
    VALUES (
      'voucher_redeemed',
      'vredeem:' || v_iv.id::text,
      v_identities,
      jsonb_build_object(
        'voucher_id', v_iv.id,
        'merchant_id', p_partner_id,
        'acquisition_source', v_iv.acquisition_source
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  SELECT COALESCE(svt.referral_qualifying, false) INTO v_referral_qualifying
  FROM spend_voucher_templates svt
  WHERE svt.id = v_iv.voucher_template_id;

  RETURN QUERY SELECT true, v_iv.id, v_title, ''::text, v_iv.hub_user_id, p_gross_amount_cusd, v_referral_qualifying;
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text) TO service_role;

NOTIFY pgrst, 'reload schema';
