-- Skill game leaderboards — Phase 1 (skill-games-leaderboards-spec.md §4.1, §2.3).
--
-- Adds the persisted elapsed-time fields the leaderboard's tie-break order
-- needs (score -> elapsed_ms -> created_at -> session_id), wires the existing
-- Hub finalization RPC to accept and persist it, and closes the gap flagged
-- by invariant #6: a canonical merge previously moved identity_links,
-- miles_ledger, hub_user_canonicals, and the partner-quest tables, but never
-- the skill-game tables, so a linked member could still show up twice on a
-- leaderboard after linking.

-- ── 1. Persisted elapsed time + finalize timestamp (§4.1) ──────────────────

ALTER TABLE skill_game_sessions
  ADD COLUMN IF NOT EXISTS elapsed_ms integer,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

ALTER TABLE skill_game_sessions
  DROP CONSTRAINT IF EXISTS skill_game_sessions_elapsed_ms_valid;
ALTER TABLE skill_game_sessions
  ADD CONSTRAINT skill_game_sessions_elapsed_ms_valid
  CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0);

CREATE INDEX IF NOT EXISTS idx_skill_game_sessions_leaderboard
  ON skill_game_sessions (game_type, created_at, score DESC, elapsed_ms ASC)
  WHERE accepted = true;

-- ── 2. finalize_hub_skill_game_session gains p_elapsed_ms ───────────────────
-- Different parameter list than the migration-064 original, so PostgREST
-- would otherwise see two overloads side by side. Drop the old signature
-- first so callers resolve to exactly one function.

DROP FUNCTION IF EXISTS public.finalize_hub_skill_game_session(
  text, uuid, integer, boolean, integer, numeric, boolean, text[]
);

CREATE OR REPLACE FUNCTION public.finalize_hub_skill_game_session(
  p_session_id       text,
  p_canonical_id     uuid,
  p_score            integer,
  p_accepted         boolean,
  p_reward_miles     integer,
  p_reward_stable    numeric,
  p_completed        boolean,
  p_anti_abuse_flags text[],
  p_elapsed_ms       integer DEFAULT NULL
)
RETURNS TABLE(
  accepted           boolean,
  score              integer,
  reward_miles       integer,
  reward_stable      numeric,
  delivery_id        uuid,
  delivery_mode      text,
  delivery_status    text,
  destination_wallet text,
  already_finalized  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation hub_skill_game_play_reservations%ROWTYPE;
  v_server      skill_game_server_sessions%ROWTYPE;
  v_result      skill_game_sessions%ROWTYPE;
  v_delivery    skill_game_reward_deliveries%ROWTYPE;
  v_wallet      text;
  v_ledger_id   uuid;
  v_game_label  text;
BEGIN
  -- 1. lock the play reservation and server session
  SELECT * INTO v_reservation
  FROM hub_skill_game_play_reservations
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found for session %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_server
  FROM skill_game_server_sessions
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server session not found for %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. verify they belong to the asserted canonical participant
  IF v_reservation.canonical_id <> p_canonical_id OR v_server.canonical_id <> p_canonical_id THEN
    RAISE EXCEPTION 'session % does not belong to canonical %', p_session_id, p_canonical_id USING ERRCODE = '42501';
  END IF;

  -- 3. return the existing result if already finalized — retries never
  -- recompute a different elapsed_ms, they just see what was persisted.
  IF v_reservation.status = 'finalized' THEN
    SELECT * INTO v_result FROM skill_game_sessions WHERE session_id = p_session_id;
    SELECT * INTO v_delivery FROM skill_game_reward_deliveries WHERE session_id = p_session_id;
    RETURN QUERY SELECT
      v_result.accepted, v_result.score, v_result.reward_miles, v_result.reward_stable,
      v_delivery.id, v_delivery.mode, v_delivery.status, v_delivery.destination_wallet, true;
    RETURN;
  END IF;

  -- 4. write the authoritative result and anti-abuse flags
  INSERT INTO skill_game_sessions (
    session_id, wallet_address, canonical_id, hub_user_id, source_app, game_type,
    score, reward_miles, reward_stable, accepted, anti_abuse_flags,
    elapsed_ms, finalized_at
  ) VALUES (
    p_session_id, NULL, p_canonical_id, v_reservation.hub_user_id, 'hub-page', v_reservation.game_type,
    p_score,
    CASE WHEN p_accepted THEN p_reward_miles ELSE 0 END,
    CASE WHEN p_accepted THEN p_reward_stable ELSE 0 END,
    p_accepted, COALESCE(p_anti_abuse_flags, '{}'),
    p_elapsed_ms, now()
  )
  ON CONFLICT (session_id) DO UPDATE SET
    score = EXCLUDED.score,
    reward_miles = EXCLUDED.reward_miles,
    reward_stable = EXCLUDED.reward_stable,
    accepted = EXCLUDED.accepted,
    anti_abuse_flags = EXCLUDED.anti_abuse_flags,
    elapsed_ms = EXCLUDED.elapsed_ms,
    finalized_at = EXCLUDED.finalized_at
  RETURNING * INTO v_result;

  UPDATE skill_game_server_sessions
  SET finalized = true, completed = p_completed, score = p_score, updated_at = now()
  WHERE session_id = p_session_id AND finalized = false;

  -- 5. mark the reservation finalized
  UPDATE hub_skill_game_play_reservations
  SET status = 'finalized', finalized_at = now()
  WHERE session_id = p_session_id AND status IN ('reserved', 'started');

  -- 6. if reward is zero or the result is rejected, create no delivery
  IF NOT p_accepted OR p_reward_miles <= 0 THEN
    RETURN QUERY SELECT p_accepted, p_score, 0, 0::numeric, NULL::uuid, NULL::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  -- 8. reserve exactly one delivery (idempotent on session_id via unique constraint)
  SELECT * INTO v_delivery FROM skill_game_reward_deliveries WHERE session_id = p_session_id FOR UPDATE;
  IF v_delivery.id IS NULL THEN
    -- 7. resolve the member's current cryptographically verified primary
    -- wallet. Guarded the same way migration 054's backfill guards it: on a
    -- database where migration 051 (verified_wallet_linking.sql) hasn't run
    -- yet, hub_user_wallets.verification_status doesn't exist, and querying
    -- it directly would throw 42703 undefined_column on every rewarded
    -- finish. Treat that state as walletless (v_wallet stays NULL) rather
    -- than failing the whole finalization.
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
      p_reward_miles,
      lower(v_wallet),
      'skill-game-reward:' || p_session_id
    ) RETURNING * INTO v_delivery;

    -- 9. atomically credit the ledger (walletless) — onchain_mint stays
    -- `pending` here; the caller enqueues the actual mint job.
    IF v_delivery.mode = 'offchain_ledger' THEN
      INSERT INTO miles_ledger (
        canonical_id, amount, direction, source_type, source_id, on_chain, note
      ) VALUES (
        p_canonical_id, p_reward_miles, 'credit', 'game', v_delivery.id, false,
        v_game_label || ' reward'
      ) RETURNING id INTO v_ledger_id;

      UPDATE skill_game_reward_deliveries SET
        status = 'completed',
        ledger_entry_id = v_ledger_id,
        external_ref = v_ledger_id::text,
        completed_at = now(),
        updated_at = now()
      WHERE id = v_delivery.id
      RETURNING * INTO v_delivery;
    END IF;
  END IF;

  -- 10. return the persisted result and delivery state
  RETURN QUERY SELECT
    v_result.accepted, v_result.score, v_result.reward_miles, v_result.reward_stable,
    v_delivery.id, v_delivery.mode, v_delivery.status, v_delivery.destination_wallet, false;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_hub_skill_game_session(text, uuid, integer, boolean, integer, numeric, boolean, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_hub_skill_game_session(text, uuid, integer, boolean, integer, numeric, boolean, text[], integer)
  TO service_role;

-- ── 3. Canonical merge must also move skill-game ownership (invariant #6) ──
-- Same function as migration 054, with four more UPDATE statements added
-- alongside the existing identity_links/miles_ledger/hub_user_canonicals
-- moves, inside the same locked transaction.

CREATE OR REPLACE FUNCTION merge_partner_quest_canonicals(
  p_surviving_canonical uuid,
  p_merged_canonical    uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row              api_partner_quest_completions%ROWTYPE;
  v_existing_id      uuid;
  v_loser_delivery   api_partner_quest_reward_deliveries%ROWTYPE;
  v_kept_delivery    api_partner_quest_reward_deliveries%ROWTYPE;
  v_loser_rank       integer;
  v_kept_rank        integer;
BEGIN
  IF p_surviving_canonical = p_merged_canonical THEN
    RETURN p_surviving_canonical;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(p_surviving_canonical::text, p_merged_canonical::text), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(p_surviving_canonical::text, p_merged_canonical::text), 0));

  IF EXISTS (SELECT 1 FROM hub_user_canonicals WHERE canonical_id = p_surviving_canonical)
     AND EXISTS (SELECT 1 FROM hub_user_canonicals WHERE canonical_id = p_merged_canonical)
  THEN
    RAISE EXCEPTION 'cannot automatically merge two Hub accounts' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT * FROM api_partner_quest_completions
    WHERE canonical_id = p_merged_canonical
    FOR UPDATE
  LOOP
    SELECT id INTO v_existing_id
    FROM api_partner_quest_completions
    WHERE canonical_id = p_surviving_canonical
      AND api_partner_quest_id = v_row.api_partner_quest_id
      AND scope_key = v_row.scope_key
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      UPDATE api_partner_quest_completions
      SET canonical_id = p_surviving_canonical
      WHERE id = v_row.id;
    ELSE
      SELECT * INTO v_loser_delivery
      FROM api_partner_quest_reward_deliveries WHERE completion_id = v_row.id FOR UPDATE;
      SELECT * INTO v_kept_delivery
      FROM api_partner_quest_reward_deliveries WHERE completion_id = v_existing_id FOR UPDATE;

      v_loser_rank := CASE v_loser_delivery.status
        WHEN 'completed' THEN 4 WHEN 'processing' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END;
      v_kept_rank := CASE v_kept_delivery.status
        WHEN 'completed' THEN 4 WHEN 'processing' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END;

      INSERT INTO partner_quest_identity_merge_audit (
        surviving_canonical, merged_canonical, conflict_kind,
        kept_completion_id, removed_snapshot
      ) VALUES (
        p_surviving_canonical, p_merged_canonical, 'duplicate_quest_scope',
        v_existing_id, to_jsonb(v_row) || jsonb_build_object('delivery', to_jsonb(v_loser_delivery))
      );

      IF v_loser_rank > v_kept_rank THEN
        UPDATE api_partner_quest_reward_deliveries SET
          mode = v_loser_delivery.mode,
          status = v_loser_delivery.status,
          base_points = v_loser_delivery.base_points,
          awarded_points = v_loser_delivery.awarded_points,
          destination_wallet = v_loser_delivery.destination_wallet,
          external_ref = v_loser_delivery.external_ref,
          ledger_entry_id = v_loser_delivery.ledger_entry_id,
          attempts = v_loser_delivery.attempts,
          last_error = v_loser_delivery.last_error,
          completed_at = v_loser_delivery.completed_at,
          updated_at = now()
        WHERE completion_id = v_existing_id;
      END IF;

      DELETE FROM api_partner_quest_reward_deliveries WHERE completion_id = v_row.id;
      DELETE FROM api_partner_quest_completions WHERE id = v_row.id;
    END IF;
  END LOOP;

  UPDATE identity_links
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  UPDATE miles_ledger
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  UPDATE hub_user_canonicals
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  -- Skill-game ownership (skill-games-leaderboards-spec.md §2.3, invariant #6)
  -- — a session/reservation/delivery keeps its history but moves to the
  -- surviving canonical so a linked member can never occupy two leaderboard
  -- rows. Guarded with to_regclass the same way migration 054 guards
  -- minipoint_mint_jobs, in case this runs against a database where the
  -- skill-games migrations haven't landed yet.
  IF to_regclass('public.skill_game_sessions') IS NOT NULL THEN
    UPDATE skill_game_sessions
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  IF to_regclass('public.skill_game_server_sessions') IS NOT NULL THEN
    UPDATE skill_game_server_sessions
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  IF to_regclass('public.hub_skill_game_play_reservations') IS NOT NULL THEN
    UPDATE hub_skill_game_play_reservations
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  IF to_regclass('public.skill_game_reward_deliveries') IS NOT NULL THEN
    UPDATE skill_game_reward_deliveries
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  INSERT INTO partner_quest_identity_merge_audit (
    surviving_canonical, merged_canonical, conflict_kind
  ) VALUES (p_surviving_canonical, p_merged_canonical, 'canonical_merged');

  RETURN p_surviving_canonical;
END;
$$;

REVOKE ALL ON FUNCTION merge_partner_quest_canonicals(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_partner_quest_canonicals(uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
