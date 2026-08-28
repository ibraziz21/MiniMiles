-- 071_skill_game_mastery_finalize.sql
-- Mastery economy v1 — Slice 2 (economy cutover), atomic finalization
-- (skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md §3.3).
--
-- Adds a SEPARATE finalize RPC and status RPC for the mastery-v1 economy,
-- alongside (not replacing) the existing finalize_hub_skill_game_session /
-- hub_skill_game_play_status from 063/064 — those keep driving the legacy
-- 6/9/12 economy exactly as before. Which one packages/backend calls is a
-- server-controlled dispatch (SKILL_GAME_ECONOMY_VERSION env var), never a
-- client choice, and defaults to legacy until explicitly cut over (§10.1
-- "server-controlled economy version and reward kill switch").
--
-- This is the "one locked transaction" the spec requires in place of a
-- read-then-credit sequence: the day/month mastery rows are locked with
-- SELECT ... FOR UPDATE before the delta is computed, so two concurrent
-- finishes for the same owner/game/day serialize through that lock and the
-- second one sees the first's committed best_tier/base_miles_credited
-- before computing its own delta — the invariant "two simultaneous
-- Moderate finishes must produce only one Mile in total" holds because the
-- second call's desired delta is computed against the already-updated row,
-- not a stale read.

-- ── 1. Tier <-> Miles helpers (mirrors @akiba/skill-games's
--    MASTERY_ECONOMY_V1.milesByTier — packages/skill-games/src/core/
--    masteryEconomy.ts — the two copies must be changed together; there is
--    no way for SQL to import the TS source of truth). ─────────────────────

CREATE OR REPLACE FUNCTION public.mastery_tier_rank(p_tier text)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tier WHEN 'elite' THEN 3 WHEN 'strong' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.mastery_miles_for_tier(p_tier text)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tier WHEN 'elite' THEN 3 WHEN 'strong' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END;
$$;

-- ── 2. Persist mastery fields on the session record (§3.2) ─────────────────
-- Nullable/zero-defaulted so historical 6/9/12 rows remain untouched and
-- valid — "Do not rewrite historical session rewards."

ALTER TABLE public.skill_game_sessions
  ADD COLUMN IF NOT EXISTS economy_version      text,
  ADD COLUMN IF NOT EXISTS tier_achieved         text,
  ADD COLUMN IF NOT EXISTS previous_best_tier    text,
  ADD COLUMN IF NOT EXISTS base_miles_delta      integer,
  ADD COLUMN IF NOT EXISTS campaign_bonus_delta  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cap_limited_miles     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_reason         text,
  ADD COLUMN IF NOT EXISTS campaign_id           uuid;

-- ── 3. Atomic mastery-v1 finalization (§3.3) ────────────────────────────────
--
-- Score/accepted/completed/flags come from the Backend's own server-side
-- scoring (unchanged, §2.1) — this RPC computes tier, delta, monthly-cap
-- limiting and reward_reason itself; the caller must never pass a payable
-- Miles amount as authority. p_campaign_bonus_miles is reserved for Slice 3
-- (§4.2) and defaults to 0 — the ordinary base economy is unaffected by an
-- absent campaign.
CREATE OR REPLACE FUNCTION public.finalize_hub_skill_game_session_mastery_v1(
  p_session_id            text,
  p_canonical_id          uuid,
  p_score                 integer,
  p_accepted              boolean,
  p_completed             boolean,
  p_anti_abuse_flags      text[],
  p_campaign_bonus_miles  integer DEFAULT 0,
  p_campaign_id           uuid DEFAULT NULL
)
RETURNS TABLE(
  accepted              boolean,
  score                 integer,
  economy_version       text,
  tier_achieved         text,
  previous_best_tier    text,
  base_miles_delta      integer,
  campaign_bonus_delta  integer,
  cap_limited_miles     boolean,
  reward_reason         text,
  miles_credited_this_round integer,
  game_miles_today          integer,
  game_miles_this_month     integer,
  delivery_id           uuid,
  delivery_mode         text,
  delivery_status       text,
  destination_wallet    text,
  already_finalized     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation      hub_skill_game_play_reservations%ROWTYPE;
  v_server           skill_game_server_sessions%ROWTYPE;
  v_result           skill_game_sessions%ROWTYPE;
  v_delivery         skill_game_reward_deliveries%ROWTYPE;
  v_day              skill_game_mastery_days%ROWTYPE;
  v_month            skill_game_monthly_caps%ROWTYPE;
  v_owner_key        text;
  v_local_date       date;
  v_local_month      date;
  v_tier_achieved    text;
  v_previous_best_tier text;
  v_best_tier_after  text;
  v_desired_delta    integer;
  v_remaining_allowance integer;
  v_credited_delta   integer;
  v_cap_limited      boolean;
  v_reward_reason    text;
  v_campaign_bonus   integer;
  v_total_credited   integer;
  v_wallet           text;
  v_ledger_id        uuid;
  v_game_label       text;
  v_min_moderate     integer;
  v_min_strong       integer;
  v_min_elite        integer;
  v_economy_version  constant text := 'mastery-v1';
  v_monthly_cap      constant integer := 60;
BEGIN
  -- 1. lock the play reservation and server session (same as the legacy RPC)
  SELECT * INTO v_reservation FROM hub_skill_game_play_reservations WHERE session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found for session %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_server FROM skill_game_server_sessions WHERE session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server session not found for %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.canonical_id <> p_canonical_id OR v_server.canonical_id <> p_canonical_id THEN
    RAISE EXCEPTION 'session % does not belong to canonical %', p_session_id, p_canonical_id USING ERRCODE = '42501';
  END IF;

  -- 2. idempotent replay: return the persisted result, never recompute or re-credit
  IF v_reservation.status = 'finalized' THEN
    SELECT * INTO v_result FROM skill_game_sessions WHERE session_id = p_session_id;
    SELECT * INTO v_delivery FROM skill_game_reward_deliveries WHERE session_id = p_session_id;
    RETURN QUERY SELECT
      v_result.accepted, v_result.score, v_result.economy_version, v_result.tier_achieved,
      v_result.previous_best_tier, v_result.base_miles_delta, v_result.campaign_bonus_delta,
      v_result.cap_limited_miles, v_result.reward_reason, v_result.reward_miles,
      NULL::integer, NULL::integer,
      v_delivery.id, v_delivery.mode, v_delivery.status, v_delivery.destination_wallet, true;
    RETURN;
  END IF;

  v_owner_key   := p_canonical_id::text;
  v_local_date  := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_local_month := date_trunc('month', v_local_date)::date;
  v_campaign_bonus := GREATEST(0, COALESCE(p_campaign_bonus_miles, 0));

  -- 3. score -> tier (§2.1, unchanged scoring; mirrors SCORE_BANDS in
  --    packages/skill-games/src/core/masteryEconomy.ts)
  IF v_reservation.game_type = 'rule_tap' THEN
    v_min_moderate := 10; v_min_strong := 14; v_min_elite := 18;
  ELSE
    v_min_moderate := 200; v_min_strong := 500; v_min_elite := 750;
  END IF;

  v_tier_achieved := CASE
    WHEN NOT p_accepted THEN 'none'
    WHEN p_score >= v_min_elite THEN 'elite'
    WHEN p_score >= v_min_strong THEN 'strong'
    WHEN p_score >= v_min_moderate THEN 'moderate'
    ELSE 'none'
  END;

  -- 4. lock/create the day's mastery row and month's cap row — the
  --    serialization point for concurrent finishes (see header comment).
  INSERT INTO skill_game_mastery_days (owner_key, game_type, local_date, economy_version)
  VALUES (v_owner_key, v_reservation.game_type, v_local_date, v_economy_version)
  ON CONFLICT (owner_key, game_type, local_date, economy_version) DO NOTHING;
  SELECT * INTO v_day FROM skill_game_mastery_days
  WHERE owner_key = v_owner_key AND game_type = v_reservation.game_type
    AND local_date = v_local_date AND economy_version = v_economy_version
  FOR UPDATE;

  INSERT INTO skill_game_monthly_caps (owner_key, local_month, economy_version)
  VALUES (v_owner_key, v_local_month, v_economy_version)
  ON CONFLICT (owner_key, local_month, economy_version) DO NOTHING;
  SELECT * INTO v_month FROM skill_game_monthly_caps
  WHERE owner_key = v_owner_key AND local_month = v_local_month AND economy_version = v_economy_version
  FOR UPDATE;

  -- 5. best score updates independently of reward eligibility (§3.3 step 6).
  --    Captured before step 8's UPDATE ... RETURNING overwrites v_day with
  --    the post-round row — this is the one thing that must survive that.
  v_previous_best_tier := v_day.best_tier;
  v_best_tier_after := CASE
    WHEN mastery_tier_rank(v_tier_achieved) > mastery_tier_rank(v_previous_best_tier) THEN v_tier_achieved
    ELSE v_previous_best_tier
  END;

  -- 6-7. desired entitlement minus already-credited, then limited by the
  --      remaining monthly allowance (§2.2, §2.3)
  v_desired_delta := GREATEST(0, mastery_miles_for_tier(v_best_tier_after) - mastery_miles_for_tier(v_previous_best_tier));
  v_remaining_allowance := GREATEST(0, v_monthly_cap - v_month.base_miles_credited);
  v_credited_delta := LEAST(v_desired_delta, v_remaining_allowance);
  v_cap_limited := v_credited_delta < v_desired_delta;

  -- Partial credit (some Miles still fit under the remaining allowance,
  -- just not the full desired delta) reports "new_tier" — a real
  -- improvement was credited; "monthly_cap" is reserved for crediting
  -- nothing at all (§5.2 "Monthly game Miles complete").
  v_reward_reason := CASE
    WHEN NOT p_accepted THEN 'rejected'
    WHEN v_tier_achieved = 'none' THEN 'below_threshold'
    WHEN v_desired_delta = 0 THEN 'tier_maintained'
    WHEN v_credited_delta = 0 THEN 'monthly_cap'
    ELSE 'new_tier'
  END;

  v_total_credited := v_credited_delta + v_campaign_bonus;

  -- 8. persist the day/month rows. best_score only moves on an accepted
  --    round — "A rejected result never changes mastery" (§2.2) covers
  --    best_score/best_tier together; a flagged score is not trustworthy
  --    enough to surface as the day's best.
  UPDATE skill_game_mastery_days SET
    attempts_started    = attempts_started + 1,
    best_score          = CASE WHEN p_accepted THEN GREATEST(COALESCE(best_score, 0), p_score) ELSE best_score END,
    best_tier           = v_best_tier_after,
    base_miles_entitled = mastery_miles_for_tier(v_best_tier_after),
    base_miles_credited = base_miles_credited + v_credited_delta,
    updated_at          = now()
  WHERE owner_key = v_owner_key AND game_type = v_reservation.game_type
    AND local_date = v_local_date AND economy_version = v_economy_version
  RETURNING * INTO v_day;

  UPDATE skill_game_monthly_caps SET
    base_miles_credited = base_miles_credited + v_credited_delta,
    updated_at           = now()
  WHERE owner_key = v_owner_key AND local_month = v_local_month AND economy_version = v_economy_version
  RETURNING * INTO v_month;

  -- 9. write the authoritative session result
  INSERT INTO skill_game_sessions (
    session_id, wallet_address, canonical_id, hub_user_id, source_app, game_type,
    score, reward_miles, reward_stable, accepted, anti_abuse_flags,
    economy_version, tier_achieved, previous_best_tier, base_miles_delta,
    campaign_bonus_delta, cap_limited_miles, reward_reason, campaign_id
  ) VALUES (
    p_session_id, NULL, p_canonical_id, v_reservation.hub_user_id, 'hub-page', v_reservation.game_type,
    p_score, v_total_credited, 0, p_accepted, COALESCE(p_anti_abuse_flags, '{}'),
    v_economy_version, v_tier_achieved, v_previous_best_tier, v_credited_delta,
    v_campaign_bonus, v_cap_limited, v_reward_reason, p_campaign_id
  )
  ON CONFLICT (session_id) DO UPDATE SET
    score = EXCLUDED.score, reward_miles = EXCLUDED.reward_miles, reward_stable = EXCLUDED.reward_stable,
    accepted = EXCLUDED.accepted, anti_abuse_flags = EXCLUDED.anti_abuse_flags,
    economy_version = EXCLUDED.economy_version, tier_achieved = EXCLUDED.tier_achieved,
    previous_best_tier = EXCLUDED.previous_best_tier, base_miles_delta = EXCLUDED.base_miles_delta,
    campaign_bonus_delta = EXCLUDED.campaign_bonus_delta, cap_limited_miles = EXCLUDED.cap_limited_miles,
    reward_reason = EXCLUDED.reward_reason, campaign_id = EXCLUDED.campaign_id
  RETURNING * INTO v_result;

  UPDATE skill_game_server_sessions
  SET finalized = true, completed = p_completed, score = p_score, updated_at = now()
  WHERE session_id = p_session_id AND finalized = false;

  UPDATE hub_skill_game_play_reservations
  SET status = 'finalized', finalized_at = now()
  WHERE session_id = p_session_id AND status IN ('reserved', 'started');

  -- 10. a zero-delta round creates no delivery, but scoring/ranking already
  --     stands via the skill_game_sessions row written above (§3.3 step 9,
  --     §2.2 "Every accepted attempt may improve ... leaderboard standing
  --     even when it credits no Miles").
  IF v_total_credited <= 0 THEN
    RETURN QUERY SELECT
      p_accepted, p_score, v_economy_version, v_tier_achieved, v_result.previous_best_tier,
      v_credited_delta, v_campaign_bonus, v_cap_limited, v_reward_reason, 0,
      v_day.base_miles_credited, v_month.base_miles_credited,
      NULL::uuid, NULL::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  -- 11. reserve exactly one delivery for the positive total (base delta +
  --     campaign bonus) — identical delivery mechanism to the legacy RPC.
  SELECT * INTO v_delivery FROM skill_game_reward_deliveries WHERE session_id = p_session_id FOR UPDATE;
  IF v_delivery.id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'hub_user_wallets' AND column_name = 'verification_status'
    ) THEN
      SELECT address INTO v_wallet
      FROM hub_user_wallets
      WHERE user_id = v_reservation.hub_user_id AND verification_status = 'verified'
      ORDER BY is_primary DESC NULLS LAST, linked_at ASC
      LIMIT 1;
    END IF;

    v_game_label := CASE v_reservation.game_type WHEN 'rule_tap' THEN 'Rule Tap' WHEN 'memory_flip' THEN 'Memory Flip' ELSE v_reservation.game_type END;

    INSERT INTO skill_game_reward_deliveries (
      session_id, canonical_id, mode, status, points, destination_wallet, idempotency_key
    ) VALUES (
      p_session_id, p_canonical_id,
      CASE WHEN v_wallet IS NOT NULL THEN 'onchain_mint' ELSE 'offchain_ledger' END,
      CASE WHEN v_wallet IS NOT NULL THEN 'pending' ELSE 'processing' END,
      v_total_credited,
      lower(v_wallet),
      'skill-game-reward:' || p_session_id
    ) RETURNING * INTO v_delivery;

    IF v_delivery.mode = 'offchain_ledger' THEN
      INSERT INTO miles_ledger (
        canonical_id, amount, direction, source_type, source_id, on_chain, note
      ) VALUES (
        p_canonical_id, v_total_credited, 'credit', 'game', v_delivery.id, false,
        v_game_label || ' mastery reward'
      ) RETURNING id INTO v_ledger_id;

      UPDATE skill_game_reward_deliveries SET
        status = 'completed', ledger_entry_id = v_ledger_id, external_ref = v_ledger_id::text,
        completed_at = now(), updated_at = now()
      WHERE id = v_delivery.id
      RETURNING * INTO v_delivery;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_result.accepted, v_result.score, v_result.economy_version, v_result.tier_achieved,
    v_result.previous_best_tier, v_result.base_miles_delta, v_result.campaign_bonus_delta,
    v_result.cap_limited_miles, v_result.reward_reason, v_result.reward_miles,
    v_day.base_miles_credited, v_month.base_miles_credited,
    v_delivery.id, v_delivery.mode, v_delivery.status, v_delivery.destination_wallet, false;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_hub_skill_game_session_mastery_v1(text, uuid, integer, boolean, boolean, text[], integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_hub_skill_game_session_mastery_v1(text, uuid, integer, boolean, boolean, text[], integer, uuid)
  TO service_role;

-- ── 4. Mastery status read (§3.4 status response) ───────────────────────────
-- Read-only companion to hub_skill_game_play_status (063) — the daily
-- attempts/plays-remaining cap is already correctly enforced by that
-- existing RPC (DAILY_CAP=5 already matches §2.3's "Five starts per game
-- per Nairobi day"); this only adds the Miles-side totals unique to the
-- mastery economy.
CREATE OR REPLACE FUNCTION public.hub_skill_game_mastery_status(
  p_canonical_id     uuid,
  p_game_type        text,
  p_economy_version  text DEFAULT 'mastery-v1'
)
RETURNS TABLE(
  economy_version           text,
  best_tier_today           text,
  best_score_today          integer,
  game_miles_today          integer,
  game_miles_available_today integer,
  game_miles_this_month     integer,
  monthly_game_miles_cap    integer,
  monthly_game_miles_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_date  date;
  v_local_month date;
  v_day         skill_game_mastery_days%ROWTYPE;
  v_month       skill_game_monthly_caps%ROWTYPE;
  v_monthly_cap constant integer := 60;
BEGIN
  v_local_date  := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_local_month := date_trunc('month', v_local_date)::date;

  SELECT * INTO v_day FROM skill_game_mastery_days
  WHERE owner_key = p_canonical_id::text AND game_type = p_game_type
    AND local_date = v_local_date AND economy_version = p_economy_version;

  SELECT * INTO v_month FROM skill_game_monthly_caps
  WHERE owner_key = p_canonical_id::text AND local_month = v_local_month AND economy_version = p_economy_version;

  RETURN QUERY SELECT
    p_economy_version,
    COALESCE(v_day.best_tier, 'none'),
    v_day.best_score,
    COALESCE(v_day.base_miles_credited, 0),
    GREATEST(0, mastery_miles_for_tier('elite') - COALESCE(v_day.base_miles_credited, 0)),
    COALESCE(v_month.base_miles_credited, 0),
    v_monthly_cap,
    GREATEST(0, v_monthly_cap - COALESCE(v_month.base_miles_credited, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.hub_skill_game_mastery_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_skill_game_mastery_status(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
