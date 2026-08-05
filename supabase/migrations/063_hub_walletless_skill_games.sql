-- Walletless Pass skill games — Slice 2 (canonical Web2 game backend).
-- packages/hub-page/docs/walletless-pass-skill-games-spec.md §9, §10.1-10.3.
--
-- Adds canonical-identity ownership to the existing skill-game session
-- tables, a daily play-reservation table + atomic reservation RPC, an
-- idempotent action-receipt table for flip/tap retries, and a short-lived
-- replay guard for signed Pass-to-Backend service assertions.
--
-- Reward delivery (skill_game_reward_deliveries, finalize_hub_skill_game_session)
-- is out of scope here — that lands in the Slice 3 migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Canonical ownership on the existing session tables (§10.1) ──────────

ALTER TABLE public.skill_game_server_sessions
  DROP CONSTRAINT IF EXISTS skill_game_server_sessions_wallet_hex,
  ALTER COLUMN wallet_address DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical_id uuid,
  ADD COLUMN IF NOT EXISTS hub_user_id uuid,
  ADD COLUMN IF NOT EXISTS source_app text NOT NULL DEFAULT 'react-app';

ALTER TABLE public.skill_game_server_sessions
  ADD CONSTRAINT skill_game_server_sessions_wallet_hex
    CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-fA-F]{40}$');

ALTER TABLE public.skill_game_server_sessions
  DROP CONSTRAINT IF EXISTS skill_game_server_sessions_owner_by_source;
ALTER TABLE public.skill_game_server_sessions
  ADD CONSTRAINT skill_game_server_sessions_owner_by_source
    CHECK (
      (source_app = 'react-app' AND wallet_address IS NOT NULL)
      OR
      (source_app = 'hub-page' AND canonical_id IS NOT NULL AND hub_user_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_skill_game_server_sessions_canonical
  ON public.skill_game_server_sessions (canonical_id, game_type)
  WHERE canonical_id IS NOT NULL;

-- §10.2 — same ownership shape on the finalized-result log.
ALTER TABLE public.skill_game_sessions
  ALTER COLUMN wallet_address DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical_id uuid,
  ADD COLUMN IF NOT EXISTS hub_user_id uuid,
  ADD COLUMN IF NOT EXISTS source_app text NOT NULL DEFAULT 'react-app';

ALTER TABLE public.skill_game_sessions
  DROP CONSTRAINT IF EXISTS skill_game_sessions_owner_by_source;
ALTER TABLE public.skill_game_sessions
  ADD CONSTRAINT skill_game_sessions_owner_by_source
    CHECK (
      (source_app = 'react-app' AND wallet_address IS NOT NULL)
      OR
      (source_app = 'hub-page' AND canonical_id IS NOT NULL AND hub_user_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_skill_game_sessions_canonical_game_date
  ON public.skill_game_sessions (canonical_id, game_type, created_at)
  WHERE canonical_id IS NOT NULL;

-- ── 2. Daily play reservations (§9.2) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hub_skill_game_play_reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       text NOT NULL UNIQUE,
  canonical_id     uuid NOT NULL,
  hub_user_id      uuid NOT NULL,
  game_type        text NOT NULL CHECK (game_type IN ('rule_tap', 'memory_flip')),
  play_date        date NOT NULL,
  status           text NOT NULL CHECK (status IN ('reserved', 'started', 'finalized', 'voided')),
  idempotency_key  text NOT NULL UNIQUE,
  reserved_at      timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finalized_at     timestamptz,
  expires_at       timestamptz NOT NULL,
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_skill_game_play_reservations_lookup
  ON public.hub_skill_game_play_reservations (canonical_id, game_type, play_date, status);

CREATE OR REPLACE FUNCTION public.touch_hub_skill_game_play_reservations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hub_skill_game_play_reservations_touch ON public.hub_skill_game_play_reservations;
CREATE TRIGGER trg_hub_skill_game_play_reservations_touch
  BEFORE UPDATE ON public.hub_skill_game_play_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_hub_skill_game_play_reservations_updated_at();

ALTER TABLE public.hub_skill_game_play_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_skill_game_play_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.hub_skill_game_play_reservations TO service_role;

-- ── 3. Atomic reservation RPC (§9.3) ────────────────────────────────────────
--
-- Resolves the canonical participant itself (via the existing
-- resolve_partner_quest_canonical) rather than trusting a pre-resolved id,
-- so a reservation can never be created for an identity that didn't go
-- through the canonical resolver. Concurrency safety comes from an advisory
-- transaction lock keyed by (canonical_id, game_type, play_date) — two
-- concurrent "5th play" requests for the same player/game/day serialize
-- through this lock rather than racing the count.
CREATE OR REPLACE FUNCTION public.reserve_hub_skill_game_play(
  p_hub_user_id         uuid,
  p_email               text,
  p_game_type           text,
  p_idempotency_key     text,
  p_daily_cap           integer DEFAULT 5,
  p_init_window_seconds integer DEFAULT 120
)
RETURNS TABLE(
  ok               boolean,
  error_code       text,
  session_id       text,
  canonical_id     uuid,
  status           text,
  plays_today      integer,
  plays_remaining  integer,
  expires_at       timestamptz,
  next_reset_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical      uuid;
  v_play_date      date;
  v_next_reset     timestamptz;
  v_existing       hub_skill_game_play_reservations%ROWTYPE;
  v_count          integer;
  v_session_id     text;
  v_expires_at     timestamptz;
BEGIN
  IF p_game_type NOT IN ('rule_tap', 'memory_flip') THEN
    RETURN QUERY SELECT false, 'invalid-game-type', NULL::text, NULL::uuid, NULL::text, NULL::integer, NULL::integer, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  v_canonical := resolve_partner_quest_canonical(p_hub_user_id, p_email, NULL);

  v_play_date  := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_next_reset := ((v_play_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_canonical::text || '|' || p_game_type || '|' || v_play_date::text, 0
  ));

  -- Idempotent replay: same key returns the same reservation untouched,
  -- but only for the same participant/game — otherwise it's a conflict.
  SELECT * INTO v_existing
  FROM hub_skill_game_play_reservations
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.canonical_id <> v_canonical OR v_existing.game_type <> p_game_type THEN
      RETURN QUERY SELECT false, 'idempotency-conflict', NULL::text, v_canonical, NULL::text, NULL::integer, NULL::integer, NULL::timestamptz, v_next_reset;
      RETURN;
    END IF;

    SELECT count(*) INTO v_count
    FROM hub_skill_game_play_reservations
    WHERE canonical_id = v_canonical AND game_type = p_game_type AND play_date = v_play_date
      AND status IN ('reserved', 'started', 'finalized');

    RETURN QUERY SELECT true, NULL::text, v_existing.session_id, v_canonical, v_existing.status,
      v_count, greatest(0, p_daily_cap - v_count), v_existing.expires_at, v_next_reset;
    RETURN;
  END IF;

  -- Void reserved rows whose short init window lapsed without ever reaching
  -- `started` — they never consumed a real play (§9.3 step 3).
  UPDATE hub_skill_game_play_reservations
  SET status = 'voided', void_reason = 'init-window-expired'
  WHERE canonical_id = v_canonical AND game_type = p_game_type AND play_date = v_play_date
    AND status = 'reserved' AND expires_at < now();

  SELECT count(*) INTO v_count
  FROM hub_skill_game_play_reservations
  WHERE canonical_id = v_canonical AND game_type = p_game_type AND play_date = v_play_date
    AND status IN ('reserved', 'started', 'finalized');

  IF v_count >= p_daily_cap THEN
    RETURN QUERY SELECT false, 'daily-cap-reached', NULL::text, v_canonical, NULL::text,
      v_count, 0, NULL::timestamptz, v_next_reset;
    RETURN;
  END IF;

  v_session_id := gen_random_uuid()::text;
  v_expires_at := now() + make_interval(secs => p_init_window_seconds);

  INSERT INTO hub_skill_game_play_reservations (
    session_id, canonical_id, hub_user_id, game_type, play_date,
    status, idempotency_key, expires_at
  ) VALUES (
    v_session_id, v_canonical, p_hub_user_id, p_game_type, v_play_date,
    'reserved', p_idempotency_key, v_expires_at
  );

  RETURN QUERY SELECT true, NULL::text, v_session_id, v_canonical, 'reserved',
    v_count + 1, greatest(0, p_daily_cap - (v_count + 1)), v_expires_at, v_next_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_hub_skill_game_play(uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_hub_skill_game_play(uuid, text, text, text, integer, integer)
  TO service_role;

-- Read-only status helper — same counting rule as the reservation RPC,
-- without ever inserting a row. Used by GET /games/web2/status.
CREATE OR REPLACE FUNCTION public.hub_skill_game_play_status(
  p_hub_user_id uuid,
  p_email       text,
  p_game_type   text,
  p_daily_cap   integer DEFAULT 5
)
RETURNS TABLE(
  canonical_id     uuid,
  plays_today      integer,
  plays_remaining  integer,
  next_reset_at    timestamptz,
  best_score_today integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical  uuid;
  v_play_date  date;
  v_next_reset timestamptz;
  v_count      integer;
  v_best       integer;
BEGIN
  v_canonical := resolve_partner_quest_canonical(p_hub_user_id, p_email, NULL);
  v_play_date  := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_next_reset := ((v_play_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');

  SELECT count(*) INTO v_count
  FROM hub_skill_game_play_reservations
  WHERE canonical_id = v_canonical AND game_type = p_game_type AND play_date = v_play_date
    AND status IN ('reserved', 'started', 'finalized');

  SELECT max(score) INTO v_best
  FROM skill_game_sessions
  WHERE canonical_id = v_canonical AND game_type = p_game_type
    AND accepted = true
    AND created_at >= (v_play_date::timestamp AT TIME ZONE 'Africa/Nairobi')
    AND created_at <  ((v_play_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');

  RETURN QUERY SELECT v_canonical, v_count, greatest(0, p_daily_cap - v_count), v_next_reset, v_best;
END;
$$;

REVOKE ALL ON FUNCTION public.hub_skill_game_play_status(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_skill_game_play_status(uuid, text, text, integer)
  TO service_role;

-- ── 4. Idempotent action receipts (§10.3) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.skill_game_session_actions (
  session_id    text NOT NULL REFERENCES public.skill_game_server_sessions(session_id),
  action_id     uuid NOT NULL,
  sequence_no   integer NOT NULL,
  action_type   text NOT NULL CHECK (action_type IN ('flip', 'tap')),
  input_hash    text NOT NULL,
  outcome       jsonb NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, action_id),
  UNIQUE (session_id, sequence_no)
);

ALTER TABLE public.skill_game_session_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.skill_game_session_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.skill_game_session_actions TO service_role;

-- ── 5. Service-assertion replay guard (§7.2) ────────────────────────────────
-- Assertions expire within 60s; this table rejects a `jti` seen twice within
-- that window. Expired rows are cheap to accumulate and are pruned lazily by
-- the insert below rather than needing a scheduled job for Slice 2.

CREATE TABLE IF NOT EXISTS public.skill_game_service_assertion_jti (
  jti         text PRIMARY KEY,
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_game_service_assertion_jti_expires
  ON public.skill_game_service_assertion_jti (expires_at);

ALTER TABLE public.skill_game_service_assertion_jti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.skill_game_service_assertion_jti FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.skill_game_service_assertion_jti TO service_role;

-- Atomically records a jti and reports whether it was already seen. Prunes
-- expired rows opportunistically so the table never grows unbounded.
CREATE OR REPLACE FUNCTION public.claim_skill_game_service_assertion_jti(
  p_jti        text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM skill_game_service_assertion_jti WHERE expires_at < now();

  INSERT INTO skill_game_service_assertion_jti (jti, expires_at)
  VALUES (p_jti, p_expires_at)
  ON CONFLICT (jti) DO NOTHING;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_skill_game_service_assertion_jti(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_skill_game_service_assertion_jti(text, timestamptz)
  TO service_role;
