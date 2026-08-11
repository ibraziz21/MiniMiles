-- Skill game leaderboards — Phase 5 (skill-games-leaderboards-spec.md §4.4,
-- §4.5, §4.6). Dormant prize-distribution infrastructure only. Both
-- LEADERBOARD_PRIZE_ISSUANCE_ENABLED and LEADERBOARD_PRIZE_PUBLICATION_ENABLED
-- stay false at the application layer in this release (see the settlement
-- worker route added alongside this migration) — nothing here is wired to
-- issue a voucher, enqueue a notification, or render prize copy yet.
--
-- Both recipient kinds issue through the existing, already-hardened
-- issue_voucher_from_program() (003_voucher_programs_phase2.sql), which
-- already supports a walletless caller via p_hub_user_id — it resolves the
-- destination wallet from hub_user_wallets itself and stamps hub_user_id on
-- issued_vouchers. A Hub member with zero linked wallets still fails
-- (NO_LINKED_WALLET) since a voucher ultimately needs a destination address,
-- but that's issue_voucher_from_program's own, already-reviewed constraint,
-- not a gap this migration introduces — it surfaces as a clear failed
-- delivery for manual review, same as any other issuance failure.

-- ── 0. Normalize the ungoverned React SQL (§4.4: "Normalize the currently
-- ungoverned React SQL into a numbered Supabase migration") ────────────────
-- game_weekly_campaigns has only ever existed in packages/react-app/sql/
-- leaderboard_voucher_prizes.sql + leaderboard_voucher_prizes_channel_
-- bridge.sql — not a single numbered migration. Every statement below is
-- IF NOT EXISTS / idempotent, so this is safe whether those ungoverned files
-- have already run in this environment (no-op) or never have (creates the
-- table fresh) — including a fresh install using only supabase/migrations/.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS game_weekly_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid REFERENCES partners(id),
  week_from    date NOT NULL,
  week_to      date NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  game_types   text[] NOT NULL DEFAULT '{rule_tap,memory_flip}',
  tiers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  program_id   uuid REFERENCES voucher_programs(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gwc_active_week
  ON game_weekly_campaigns (active, week_from, week_to);

-- On an environment where the table pre-dates program_id (original
-- leaderboard_voucher_prizes.sql shape: merchant_id NOT NULL, no program_id,
-- tiers NOT NULL with no default), bring it up to the same normalized shape
-- leaderboard_voucher_prizes_channel_bridge.sql already applies elsewhere.
ALTER TABLE game_weekly_campaigns
  ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE game_weekly_campaigns
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES voucher_programs(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'game_weekly_campaigns' AND constraint_name = 'chk_gwc_merchant_or_program'
  ) THEN
    ALTER TABLE game_weekly_campaigns
      ADD CONSTRAINT chk_gwc_merchant_or_program
      CHECK (merchant_id IS NOT NULL OR program_id IS NOT NULL);
  END IF;
END;
$$;

-- issue_voucher_from_program() (called by issue_skill_game_leaderboard_
-- prize_delivery below) writes acquisition_source = 'weekly_leaderboard_
-- challenge' and omits qr_payload/burn_tx_hash entirely — both need to be
-- nullable and the CHECK needs to allow that value, same relaxation
-- leaderboard_voucher_prizes_channel_bridge.sql already applies elsewhere.
-- All idempotent: a no-op if already relaxed/widened.
ALTER TABLE issued_vouchers
  ALTER COLUMN qr_payload DROP NOT NULL;
ALTER TABLE issued_vouchers
  ALTER COLUMN burn_tx_hash DROP NOT NULL;
ALTER TABLE issued_vouchers
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE issued_vouchers
  DROP CONSTRAINT IF EXISTS chk_iv_acquisition_source;
ALTER TABLE issued_vouchers
  ADD CONSTRAINT chk_iv_acquisition_source
  CHECK (acquisition_source = ANY (ARRAY[
    'miles_purchase', 'claw', 'raffle', 'giveaway', 'akiba_grant', 'merchant_grant',
    'weekly_leaderboard_challenge', 'leaderboard_win'
  ]));

-- ── 1. Campaign state (§4.4) ────────────────────────────────────────────────

ALTER TABLE game_weekly_campaigns
  ADD COLUMN IF NOT EXISTS prize_state text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'hidden',
  ADD COLUMN IF NOT EXISTS settlement_version integer NOT NULL DEFAULT 1;

ALTER TABLE game_weekly_campaigns
  DROP CONSTRAINT IF EXISTS game_weekly_campaigns_prize_state;
ALTER TABLE game_weekly_campaigns
  ADD CONSTRAINT game_weekly_campaigns_prize_state
    CHECK (prize_state IN ('draft', 'armed', 'settling', 'settled', 'cancelled'));

ALTER TABLE game_weekly_campaigns
  DROP CONSTRAINT IF EXISTS game_weekly_campaigns_publication_state;
ALTER TABLE game_weekly_campaigns
  ADD CONSTRAINT game_weekly_campaigns_publication_state
    CHECK (publication_state IN ('hidden', 'announced'));

-- ── 2. Canonical settlement + delivery registry (§4.5) ──────────────────────

CREATE TABLE IF NOT EXISTS skill_game_leaderboard_settlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES game_weekly_campaigns(id),
  game_type             text NOT NULL CHECK (game_type IN ('rule_tap', 'memory_flip')),
  week                  text NOT NULL,
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  status                text NOT NULL CHECK (status IN ('dry_run', 'settling', 'settled', 'failed', 'cancelled')),
  standings_snapshot    jsonb NOT NULL,
  snapshot_hash         text NOT NULL,
  started_at            timestamptz,
  completed_at          timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, game_type, week)
);

CREATE TABLE IF NOT EXISTS skill_game_leaderboard_prize_deliveries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id         uuid NOT NULL REFERENCES skill_game_leaderboard_settlements(id),
  canonical_id          uuid NOT NULL,
  rank                  integer NOT NULL CHECK (rank > 0),
  score                 integer NOT NULL,
  winning_session_id    text NOT NULL REFERENCES skill_game_sessions(session_id),
  recipient_kind        text NOT NULL CHECK (recipient_kind IN ('hub_user', 'wallet')),
  hub_user_id           uuid REFERENCES auth.users(id),
  destination_wallet    text,
  voucher_id            uuid REFERENCES issued_vouchers(id),
  status                text NOT NULL CHECK (status IN ('reserved', 'issued', 'failed', 'voided')),
  idempotency_key       text NOT NULL UNIQUE,
  attempts              integer NOT NULL DEFAULT 0,
  last_error            text,
  issued_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (recipient_kind = 'hub_user' AND hub_user_id IS NOT NULL AND destination_wallet IS NULL)
    OR
    (recipient_kind = 'wallet' AND destination_wallet IS NOT NULL AND hub_user_id IS NULL)
  ),
  UNIQUE (settlement_id, rank),
  UNIQUE (settlement_id, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_game_leaderboard_settlements_status
  ON skill_game_leaderboard_settlements (status, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_game_leaderboard_prize_deliveries_status
  ON skill_game_leaderboard_prize_deliveries (status, updated_at);

ALTER TABLE skill_game_leaderboard_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_game_leaderboard_prize_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON skill_game_leaderboard_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON skill_game_leaderboard_prize_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON skill_game_leaderboard_settlements TO service_role;
GRANT SELECT, INSERT, UPDATE ON skill_game_leaderboard_prize_deliveries TO service_role;

DROP TRIGGER IF EXISTS trg_skill_game_leaderboard_prize_deliveries_touch ON skill_game_leaderboard_prize_deliveries;
CREATE OR REPLACE FUNCTION touch_skill_game_leaderboard_prize_deliveries_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_skill_game_leaderboard_prize_deliveries_touch
  BEFORE UPDATE ON skill_game_leaderboard_prize_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION touch_skill_game_leaderboard_prize_deliveries_updated_at();

-- ── 3. Immutable candidate snapshot (§6 steps 1-2) ──────────────────────────
-- The only path exercised while LEADERBOARD_PRIZE_ISSUANCE_ENABLED=false.
-- Same ranking/tie-break/participant-resolution logic as
-- get_skill_game_leaderboard, against fixed historical bounds instead of
-- "now" — a closed week must always re-rank identically. Idempotent: an
-- existing snapshot for (campaign, game, week) is returned untouched, never
-- recomputed, so a rerun can't silently reshuffle a closed week.

CREATE OR REPLACE FUNCTION snapshot_skill_game_leaderboard_week(
  p_campaign_id  uuid,
  p_game_type    text,
  p_week         text,
  p_period_start timestamptz,
  p_period_end   timestamptz
)
RETURNS skill_game_leaderboard_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement skill_game_leaderboard_settlements%ROWTYPE;
  v_snapshot   jsonb;
  v_hash       text;
BEGIN
  IF p_game_type NOT IN ('rule_tap', 'memory_flip') THEN
    RAISE EXCEPTION 'invalid game_type %', p_game_type USING ERRCODE = '22023';
  END IF;
  IF p_period_end > now() THEN
    RAISE EXCEPTION 'refusing to snapshot a still-open period' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || '|' || p_game_type || '|' || p_week, 0));

  SELECT * INTO v_settlement
  FROM skill_game_leaderboard_settlements
  WHERE campaign_id = p_campaign_id AND game_type = p_game_type AND week = p_week
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_settlement;
  END IF;

  WITH candidates AS (
    SELECT
      s.session_id, s.score, s.elapsed_ms, s.created_at, s.anti_abuse_flags,
      COALESCE(s.canonical_id, il.canonical_id) AS resolved_canonical,
      COALESCE(s.canonical_id::text, il.canonical_id::text, 'wallet:' || lower(s.wallet_address)) AS participant_key
    FROM skill_game_sessions s
    LEFT JOIN identity_links il
      ON s.canonical_id IS NULL
     AND s.wallet_address IS NOT NULL
     AND il.identity_type = 'wallet'
     AND il.identity_value = lower(s.wallet_address)
    WHERE s.game_type = p_game_type
      AND s.accepted = true
      AND s.created_at >= p_period_start
      AND s.created_at < p_period_end
  ),
  best AS (
    SELECT c.*, ROW_NUMBER() OVER (
      PARTITION BY participant_key
      ORDER BY score DESC, elapsed_ms ASC NULLS LAST, created_at ASC, session_id ASC
    ) AS rn
    FROM candidates c
  ),
  ranked AS (
    SELECT b.*, ROW_NUMBER() OVER (
      ORDER BY score DESC, elapsed_ms ASC NULLS LAST, created_at ASC, session_id ASC
    ) AS rank
    FROM best b WHERE rn = 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'rank',          rank,
    'participantKey', participant_key,
    'canonicalId',    resolved_canonical,
    'sessionId',      session_id,
    'score',          score,
    'elapsedMs',      elapsed_ms,
    -- Documented no-op placeholder (spec §9 defers the real eligibility/
    -- fraud policy) — the only rule applied today is "no anti-abuse flags".
    'eligible',       (cardinality(anti_abuse_flags) = 0)
  ) ORDER BY rank) INTO v_snapshot
  FROM ranked;

  v_snapshot := COALESCE(v_snapshot, '[]'::jsonb);
  v_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex');

  INSERT INTO skill_game_leaderboard_settlements (
    campaign_id, game_type, week, period_start, period_end,
    status, standings_snapshot, snapshot_hash, started_at, completed_at
  ) VALUES (
    p_campaign_id, p_game_type, p_week, p_period_start, p_period_end,
    'dry_run', v_snapshot, v_hash, now(), now()
  )
  RETURNING * INTO v_settlement;

  RETURN v_settlement;
END;
$$;

REVOKE ALL ON FUNCTION snapshot_skill_game_leaderboard_week(uuid, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION snapshot_skill_game_leaderboard_week(uuid, text, text, timestamptz, timestamptz)
  TO service_role;

-- ── 4. Delivery reservation (§4.5, §6 steps 3-4) ────────────────────────────
-- Never called while LEADERBOARD_PRIZE_ISSUANCE_ENABLED=false — the worker
-- only calls snapshot_skill_game_leaderboard_week in that state. Walks the
-- immutable snapshot in rank order, skips a candidate with no canonical
-- identity or a non-empty anti-abuse flag set, and skips (never re-ranks) a
-- canonical already holding a delivery for this settlement — the
-- UNIQUE(settlement_id, canonical_id) constraint is the actual backstop.
-- If an eligible, not-yet-delivered candidate has no resolvable recipient at
-- all, this halts with an exception rather than silently moving to the next
-- rank (§6: "must stop and surface an operational incident").

CREATE OR REPLACE FUNCTION reserve_skill_game_leaderboard_delivery(
  p_settlement_id uuid
)
RETURNS SETOF skill_game_leaderboard_prize_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement skill_game_leaderboard_settlements%ROWTYPE;
  v_row        jsonb;
  v_canonical  uuid;
  v_eligible   boolean;
  v_session_id text;
  v_score      integer;
  v_snapshot_rank integer;
  v_hub_user_id uuid;
  v_wallet     text;
BEGIN
  SELECT * INTO v_settlement FROM skill_game_leaderboard_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found: %', p_settlement_id USING ERRCODE = 'P0002';
  END IF;
  IF v_settlement.status NOT IN ('dry_run', 'settling') THEN
    RAISE EXCEPTION 'settlement % is not open for reservation (status=%)', p_settlement_id, v_settlement.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE skill_game_leaderboard_settlements
  SET status = 'settling'
  WHERE id = p_settlement_id AND status = 'dry_run';

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(v_settlement.standings_snapshot)
    ORDER BY (value->>'rank')::int
  LOOP
    v_canonical := NULLIF(v_row->>'canonicalId', '')::uuid;
    v_eligible := COALESCE((v_row->>'eligible')::boolean, false);
    IF v_canonical IS NULL OR NOT v_eligible THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM skill_game_leaderboard_prize_deliveries
      WHERE settlement_id = p_settlement_id AND canonical_id = v_canonical
    ) THEN
      CONTINUE;
    END IF;

    v_session_id := v_row->>'sessionId';
    v_score := (v_row->>'score')::int;
    v_snapshot_rank := (v_row->>'rank')::int;

    v_hub_user_id := NULL;
    v_wallet := NULL;

    SELECT hub_user_id INTO v_hub_user_id
    FROM skill_game_sessions
    WHERE session_id = v_session_id AND canonical_id = v_canonical AND source_app = 'hub-page';

    IF v_hub_user_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'hub_user_wallets' AND column_name = 'verification_status'
      ) THEN
        SELECT huw.address INTO v_wallet
        FROM hub_user_wallets huw
        JOIN hub_user_canonicals huc ON huc.hub_user_id = huw.user_id
        WHERE huc.canonical_id = v_canonical AND huw.verification_status = 'verified'
        ORDER BY huw.is_primary DESC NULLS LAST, huw.linked_at ASC
        LIMIT 1;
      END IF;
      IF v_wallet IS NULL THEN
        SELECT identity_value INTO v_wallet
        FROM identity_links
        WHERE canonical_id = v_canonical AND identity_type = 'wallet'
        LIMIT 1;
      END IF;
    END IF;

    IF v_hub_user_id IS NULL AND v_wallet IS NULL THEN
      RAISE EXCEPTION 'no permitted recipient for canonical % (settlement %, snapshot rank %) — operational review required',
        v_canonical, p_settlement_id, v_snapshot_rank USING ERRCODE = 'P0001';
    END IF;

    -- rank is the candidate's real snapshot rank, not a re-numbered delivery
    -- sequence — a skipped ineligible/duplicate candidate above it must not
    -- shift it, or the delivery's rank stops matching the standings it
    -- actually won.
    INSERT INTO skill_game_leaderboard_prize_deliveries (
      settlement_id, canonical_id, rank, score, winning_session_id,
      recipient_kind, hub_user_id, destination_wallet, status, idempotency_key
    ) VALUES (
      p_settlement_id, v_canonical, v_snapshot_rank,
      v_score, v_session_id,
      CASE WHEN v_hub_user_id IS NOT NULL THEN 'hub_user' ELSE 'wallet' END,
      v_hub_user_id,
      CASE WHEN v_hub_user_id IS NULL THEN lower(v_wallet) ELSE NULL END,
      'reserved',
      'skill-game-leaderboard-prize:' || p_settlement_id::text || ':' || v_canonical::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  RETURN QUERY SELECT * FROM skill_game_leaderboard_prize_deliveries WHERE settlement_id = p_settlement_id ORDER BY rank;
END;
$$;

REVOKE ALL ON FUNCTION reserve_skill_game_leaderboard_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_skill_game_leaderboard_delivery(uuid) TO service_role;

-- ── 5. Issuance (§6 step 5) ──────────────────────────────────────────────────
-- Both recipient kinds issue through the existing, already-hardened
-- issue_voucher_from_program() — a hub_user delivery passes p_hub_user_id
-- and no address; a wallet delivery passes the address and no hub_user_id.
-- That function's every failure path is a RAISE EXCEPTION (PROGRAM_NOT_
-- ACTIVE, NO_LINKED_WALLET, CHANNEL_CAP_EXCEEDED, etc.) rather than a
-- returned ok=false row, so this catches broadly and records the message.

CREATE OR REPLACE FUNCTION issue_skill_game_leaderboard_prize_delivery(
  p_delivery_id uuid,
  p_code        text
)
RETURNS skill_game_leaderboard_prize_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery   skill_game_leaderboard_prize_deliveries%ROWTYPE;
  v_settlement skill_game_leaderboard_settlements%ROWTYPE;
  v_campaign   game_weekly_campaigns%ROWTYPE;
  v_voucher_id uuid;
  v_source_ref text;
BEGIN
  SELECT * INTO v_delivery FROM skill_game_leaderboard_prize_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery not found: %', p_delivery_id USING ERRCODE = 'P0002';
  END IF;
  IF v_delivery.status = 'issued' THEN
    RETURN v_delivery;
  END IF;
  IF v_delivery.status = 'voided' THEN
    RAISE EXCEPTION 'delivery % is voided' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_settlement FROM skill_game_leaderboard_settlements WHERE id = v_delivery.settlement_id;
  SELECT * INTO v_campaign FROM game_weekly_campaigns WHERE id = v_settlement.campaign_id;

  IF v_campaign.prize_state NOT IN ('armed', 'settling') THEN
    UPDATE skill_game_leaderboard_prize_deliveries SET
      status = 'failed', last_error = 'campaign is not armed (prize_state=' || v_campaign.prize_state || ')',
      attempts = attempts + 1
    WHERE id = p_delivery_id
    RETURNING * INTO v_delivery;
    RETURN v_delivery;
  END IF;

  IF v_campaign.program_id IS NULL THEN
    UPDATE skill_game_leaderboard_prize_deliveries SET
      status = 'failed', last_error = 'campaign has no voucher program_id', attempts = attempts + 1
    WHERE id = p_delivery_id
    RETURNING * INTO v_delivery;
    RETURN v_delivery;
  END IF;

  v_source_ref := 'skill-game-leaderboard:' || v_delivery.id::text;

  BEGIN
    SELECT ivfp.voucher_id INTO v_voucher_id
    FROM issue_voucher_from_program(
      v_campaign.program_id,
      'weekly_leaderboard_challenge',
      v_source_ref,
      v_delivery.destination_wallet,
      v_delivery.hub_user_id,
      p_code,
      jsonb_build_object(
        'settlement_id', v_delivery.settlement_id, 'game_type', v_settlement.game_type,
        'week', v_settlement.week, 'rank', v_delivery.rank, 'score', v_delivery.score
      ),
      'skill_game_leaderboard_settlement'
    ) AS ivfp;
  EXCEPTION WHEN OTHERS THEN
    UPDATE skill_game_leaderboard_prize_deliveries SET
      status = 'failed', last_error = left(SQLERRM, 1000), attempts = attempts + 1
    WHERE id = p_delivery_id
    RETURNING * INTO v_delivery;
    RETURN v_delivery;
  END;

  UPDATE skill_game_leaderboard_prize_deliveries SET
    status = 'issued', voucher_id = v_voucher_id, issued_at = now(), last_error = NULL
  WHERE id = p_delivery_id
  RETURNING * INTO v_delivery;

  RETURN v_delivery;
END;
$$;

REVOKE ALL ON FUNCTION issue_skill_game_leaderboard_prize_delivery(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_skill_game_leaderboard_prize_delivery(uuid, text) TO service_role;

-- Marks a settlement settled once every delivery has reached a terminal
-- state (issued/failed/voided) — called by the worker after the
-- reserve+issue loop, never automatically.
CREATE OR REPLACE FUNCTION complete_skill_game_leaderboard_settlement(
  p_settlement_id uuid
)
RETURNS skill_game_leaderboard_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement skill_game_leaderboard_settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_settlement FROM skill_game_leaderboard_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found: %', p_settlement_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM skill_game_leaderboard_prize_deliveries
    WHERE settlement_id = p_settlement_id AND status = 'reserved'
  ) THEN
    RAISE EXCEPTION 'settlement % still has reserved (not yet terminal) deliveries', p_settlement_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE skill_game_leaderboard_settlements
  SET status = 'settled', completed_at = now()
  WHERE id = p_settlement_id
  RETURNING * INTO v_settlement;

  RETURN v_settlement;
END;
$$;

REVOKE ALL ON FUNCTION complete_skill_game_leaderboard_settlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_skill_game_leaderboard_settlement(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
